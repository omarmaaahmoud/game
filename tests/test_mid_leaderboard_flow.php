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
use App\Http\Controllers\SessionController;

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

echo "\nSummary: {$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
