<?php
/**
 * Tests the 3-step Kahoot-like question flow on the backend:
 * answering -> revealed (show_mid_leaderboard=false) -> showMidLeaderboard (Top 5, show_mid_leaderboard=true) -> next question (resets show_mid_leaderboard=false)
 *
 * Run: php tests/test_mid_leaderboard_flow.php
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$kernel = $app->make(\Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

config([
    'database.default' => 'sqlite',
    'database.connections.sqlite.database' => ':memory:',
    'broadcasting.default' => 'null',
    'quiz.sync_lead_ms' => 0,
]);

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Event;
use Illuminate\Http\Request;
use App\Models\GameSession;
use App\Models\Player;
use App\Events\MidLeaderboardShown;
use App\Events\AnswerRevealed;
use App\Http\Controllers\SessionController;
use App\Http\Controllers\GameController;

Artisan::call('migrate', ['--force' => true]);

$passed = 0;
$failed = 0;

function ml_assert(bool $cond, string $msg): void {
    global $passed, $failed;
    if ($cond) {
        $passed++;
        echo "  PASS: {$msg}\n";
    } else {
        $failed++;
        echo "  FAIL: {$msg}\n";
    }
}

$testPin = (string) random_int(100000, 999999);
while (GameSession::where('pin', $testPin)->exists()) {
    $testPin = (string) random_int(100000, 999999);
}

$session = GameSession::create([
    'pin' => $testPin,
    'teacher_token_hash' => hash('sha256', 'tok'),
    'teacher_name' => 'Mr. Omar',
    'title' => 'Top 5 Flow Test',
]);

for ($q = 0; $q < 2; $q++) {
    $question = $session->questions()->create([
        'question_text' => "Question {$q}",
        'order' => $q,
        'time_limit' => 20,
    ]);
    $question->choices()->create(['choice_text' => 'Wrong', 'is_correct' => false, 'order' => 0]);
    $question->choices()->create(['choice_text' => 'Right', 'is_correct' => true, 'order' => 1]);
}

// Create 7 players with descending scores
for ($i = 1; $i <= 7; $i++) {
    $p = new Player([
        'name' => "Player {$i}",
        'avatar' => 'ninja',
        'joined_at' => now(),
    ]);
    $p->game_session_id = $session->id;
    $p->score = (8 - $i) * 100;
    $p->streak = 1;
    $p->token_hash = hash('sha256', "ptok_{$i}");
    $p->save();
}

$controller = new SessionController();

// 1. Start game
$controller->start($session->pin);
$s = $session->fresh();
ml_assert($s->status === 'active' && $s->question_state === 'answering', 'Started game in answering state');
ml_assert((bool) $s->show_mid_leaderboard === false, 'show_mid_leaderboard starts false');

// 2. Reject showMidLeaderboard BEFORE reveal
$earlyResp = $controller->showMidLeaderboard($session->pin);
ml_assert($earlyResp->getStatusCode() === 422, 'showMidLeaderboard rejects before question is revealed (422)');

// 3. Reveal Q0 -> show_mid_leaderboard remains false so Question Result displays first
$revResp = $controller->reveal($session->pin);
$revData = json_decode($revResp->getContent(), true);
$s = $session->fresh();
ml_assert($revResp->getStatusCode() === 200 && $s->question_state === 'revealed', 'Q0 revealed successfully');
ml_assert((bool) $s->show_mid_leaderboard === false, 'show_mid_leaderboard stays false right after reveal');

// 4. Teacher clicks Next -> showMidLeaderboard returns Top 5 only and broadcasts MidLeaderboardShown
$captured = null;
Event::listen(MidLeaderboardShown::class, function ($e) use (&$captured) {
    $captured = $e->broadcastWith();
});

$midResp = $controller->showMidLeaderboard($session->pin);
$midData = json_decode($midResp->getContent(), true);
$s = $session->fresh();
ml_assert($midResp->getStatusCode() === 200, 'showMidLeaderboard returns 200');
ml_assert($midData['show_mid_leaderboard'] === true && (bool) $s->show_mid_leaderboard === true, 'show_mid_leaderboard set to true');
ml_assert(count($midData['leaderboard']) === 5, 'showMidLeaderboard caps leaderboard to Top 5 out of 7 players');
ml_assert($midData['leaderboard'][0]['name'] === 'Player 1' && $midData['leaderboard'][4]['name'] === 'Player 5', 'Top 5 ordered #1 through #5');
ml_assert($midData['state_version'] === $revData['state_version'] + 1, 'state_version incremented cleanly');
ml_assert($captured !== null && count($captured['leaderboard']) === 5, 'MidLeaderboardShown event broadcast with Top 5');

// Idempotent call does not increment version again
$midResp2 = $controller->showMidLeaderboard($session->pin);
$midData2 = json_decode($midResp2->getContent(), true);
ml_assert($midData2['state_version'] === $midData['state_version'], 'Repeated showMidLeaderboard call is idempotent');

// Poll includes show_mid_leaderboard = true and answered_count
$pollData = json_decode($controller->poll($session->pin)->getContent(), true);
ml_assert($pollData['show_mid_leaderboard'] === true, 'poll() exposes show_mid_leaderboard=true');
ml_assert(array_key_exists('answered_count', $pollData) && $pollData['answered_count'] === 0, 'poll() exposes answered_count=0 before answers');

$q0 = $session->currentQuestion();
$q0Choice = $q0->choices()->first();
foreach ($session->players as $pl) {
    \App\Models\Answer::create([
        'player_id' => $pl->id,
        'question_id' => $q0->id,
        'choice_id' => $q0Choice->id,
        'is_correct' => (bool) $q0Choice->is_correct,
        'time_taken' => 1.0,
        'points_earned' => $q0Choice->is_correct ? 900 : 0,
        'answered_at' => now(),
    ]);
}
$pollAfterAnswers = json_decode($controller->poll($session->pin)->getContent(), true);
ml_assert($pollAfterAnswers['answered_count'] === 7 && $pollAfterAnswers['player_count'] === 7, 'poll() reflects answered_count=7 matching player_count=7');

// 5. Teacher clicks Next Question -> resets show_mid_leaderboard to false on Q1
$nextReq = Request::create("/api/sessions/{$session->pin}/next", 'POST', ['expected_index' => 0]);
$nextResp = $controller->next($nextReq, $session->pin);
$s = $session->fresh();
ml_assert($nextResp->getStatusCode() === 200 && (int) $s->current_question_index === 1, 'Advanced to Q1');
ml_assert((bool) $s->show_mid_leaderboard === false && $s->question_state === 'answering', 'Q1 resets show_mid_leaderboard=false and question_state=answering');

// 6. Server-side auto-reveal: solo player answering reveals immediately without teacher clicking reveal()
$soloSession = GameSession::create([
    'pin' => GameSession::generatePin(),
    'teacher_token_hash' => hash('sha256', 'solo-tok'),
    'teacher_name' => 'Mr. Solo',
    'title' => 'Solo Auto Reveal Test',
]);
$soloQ0 = $soloSession->questions()->create(['question_text' => 'Solo Q0', 'order' => 0, 'time_limit' => 20]);
$soloRight = $soloQ0->choices()->create(['choice_text' => 'Yes', 'is_correct' => true, 'order' => 0]);
$soloQ0->choices()->create(['choice_text' => 'No', 'is_correct' => false, 'order' => 1]);
$soloQ1 = $soloSession->questions()->create(['question_text' => 'Solo Q1', 'order' => 1, 'time_limit' => 20]);
$soloQ1->choices()->create(['choice_text' => 'Right', 'is_correct' => true, 'order' => 0]);
$soloQ1->choices()->create(['choice_text' => 'Wrong', 'is_correct' => false, 'order' => 1]);

$soloJoin = json_decode($controller->join(Request::create("/api/sessions/{$soloSession->pin}/join", 'POST', [
    'name' => 'SoloHero',
    'avatar' => 'ninja',
]), $soloSession->pin)->getContent(), true);
$controller->start($soloSession->pin);
$soloSession->refresh();
$soloSession->update(['question_started_at' => (int) round(microtime(true) * 1000) - 2000]);

$revealedBroadcast = null;
Event::listen(AnswerRevealed::class, function ($e) use (&$revealedBroadcast) {
    $revealedBroadcast = $e->broadcastWith();
});

$gameCtrl = new GameController();
config(['quiz.reveal_on_answer' => false]);
$soloAnsReq = Request::create("/api/sessions/{$soloSession->pin}/answer", 'POST', [
    'player_id' => $soloJoin['player']['id'],
    'choice_id' => $soloRight->id,
]);
$soloAnsReq->headers->set('X-Player-Token', $soloJoin['player_token']);
$soloAnsResp = $gameCtrl->answer($soloAnsReq, $soloSession->pin);
$soloAnsData = json_decode($soloAnsResp->getContent(), true);
$soloSession->refresh();

ml_assert($soloAnsResp->getStatusCode() === 200 && $soloAnsData['accepted'] === true, 'Solo player answer accepted');
ml_assert(!isset($soloAnsData['is_correct']) && !isset($soloAnsData['correct_choice_id']), 'Solo /answer response still never leaks top-level is_correct or correct_choice_id');
ml_assert(($soloAnsData['question_state'] ?? null) === 'revealed' && ($soloAnsData['all_answered'] ?? false) === true, 'Solo /answer returns question_state=revealed & all_answered=true');
ml_assert(isset($soloAnsData['my_result']) && $soloAnsData['my_result']['is_correct'] === true && $soloAnsData['my_result']['points_earned'] >= 500, 'Solo /answer bundles my_result upon auto-reveal to prevent client round-trip lag');
ml_assert($soloSession->question_state === 'revealed' && (bool) $soloSession->show_mid_leaderboard === false, 'Solo session auto-revealed immediately with show_mid_leaderboard=false');
ml_assert($revealedBroadcast !== null && (int) $revealedBroadcast['correct_choice_id'] === (int) $soloRight->id, 'AnswerRevealed broadcast emitted on solo auto-reveal');

$soloMyResReq = Request::create("/api/sessions/{$soloSession->pin}/my-result?question_id={$soloQ0->id}", 'GET');
$soloMyResReq->headers->set('X-Player-Token', $soloJoin['player_token']);
$soloMyResResp = $gameCtrl->myResult($soloMyResReq, $soloSession->pin);
$soloMyResData = json_decode($soloMyResResp->getContent(), true);
ml_assert($soloMyResResp->getStatusCode() === 200 && $soloMyResData['is_correct'] === true, 'Solo player can immediately fetch my-result after auto-reveal');

// 7. Multi-player Q1: stays answering on 1/2, auto-reveals immediately on 2/2
$p2Join = json_decode($controller->join(Request::create("/api/sessions/{$soloSession->pin}/join", 'POST', [
    'name' => 'SecondPlayer',
    'avatar' => 'robot',
]), $soloSession->pin)->getContent(), true);
$controller->next(Request::create("/api/sessions/{$soloSession->pin}/next", 'POST', ['expected_index' => 0]), $soloSession->pin);
$soloSession->refresh();
$soloSession->update(['question_started_at' => (int) round(microtime(true) * 1000) - 2000]);
$soloQ1Choice = $soloQ1->choices()->where('is_correct', true)->first();

$p1Req = Request::create("/api/sessions/{$soloSession->pin}/answer", 'POST', [
    'player_id' => $soloJoin['player']['id'],
    'choice_id' => $soloQ1Choice->id,
]);
$p1Req->headers->set('X-Player-Token', $soloJoin['player_token']);
$p1Data = json_decode($gameCtrl->answer($p1Req, $soloSession->pin)->getContent(), true);
$soloSession->refresh();
ml_assert($soloSession->question_state === 'answering' && !isset($p1Data['question_state']), '1/2 players answered: stays answering');

$p2Req = Request::create("/api/sessions/{$soloSession->pin}/answer", 'POST', [
    'player_id' => $p2Join['player']['id'],
    'choice_id' => $soloQ1Choice->id,
]);
$p2Req->headers->set('X-Player-Token', $p2Join['player_token']);
$p2Data = json_decode($gameCtrl->answer($p2Req, $soloSession->pin)->getContent(), true);
$soloSession->refresh();
ml_assert($soloSession->question_state === 'revealed' && ($p2Data['question_state'] ?? null) === 'revealed', '2/2 players answered: auto-reveals immediately');

// 8. Expired timer auto-reveals on poll() even if no one answered
$expSession = GameSession::create([
    'pin' => GameSession::generatePin(),
    'teacher_token_hash' => hash('sha256', 'exp-tok'),
    'teacher_name' => 'Mr. Exp',
    'title' => 'Expiry Auto Reveal',
]);
$expQ = $expSession->questions()->create(['question_text' => 'Exp Q0', 'order' => 0, 'time_limit' => 10]);
$expRight = $expQ->choices()->create(['choice_text' => 'A', 'is_correct' => true, 'order' => 0]);
$expQ->choices()->create(['choice_text' => 'B', 'is_correct' => false, 'order' => 1]);
$controller->start($expSession->pin);
$expSession->refresh();
$expSession->update(['question_started_at' => (int) round(microtime(true) * 1000) - 20000]);
$expPoll = json_decode($controller->poll($expSession->pin)->getContent(), true);
ml_assert($expPoll['question_state'] === 'revealed' && (int) ($expPoll['current_question']['correct_choice_id'] ?? 0) === (int) $expRight->id, 'Expired question auto-reveals on poll()');

echo "\nSummary: {$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
