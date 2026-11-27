<?php
/**
 * Phase 2.2 Critical Remediation & Reliability Hardening Test Suite
 *
 * Covers:
 * 1. Event payloads & versions (GameStarted, AnswerRevealed, reveal idempotency, reset)
 * 2. Header-only player token transport (me, answer, myResult, leaderboard)
 * 3. Student reconnection GET /sessions/{pin}/me across all lifecycle states
 * 4. myResult() fail-closed edge cases (null question, future, skipped historical, revealed historical)
 * 5. POST /teacher/auth endpoint & config validation
 * 6. Migration 2024_01_04_000001 non-destructive deduplication (preserves players & answers)
 * 7. DatabaseSeeder production environment guard
 * 8. Rate limiter deduplication & header-only keying
 *
 * Target: Isolated :memory: SQLite Database
 * Run: php tests/test_phase22_remediation.php
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$kernel = $app->make(\Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

config([
    'database.default' => 'sqlite',
    'database.connections.sqlite.database' => ':memory:',
    'broadcasting.default' => 'null',
    'quiz.sync_lead_ms' => 2000,
    'quiz.answer_grace_ms' => 1000,
    'quiz.allow_legacy_open_sessions' => false,
    'quiz.reveal_on_answer' => false,
]);

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Http\Request;
use App\Models\GameSession;
use App\Models\Player;
use App\Models\Answer;
use App\Events\GameStarted;
use App\Events\AnswerRevealed;
use App\Http\Controllers\SessionController;
use App\Http\Controllers\GameController;
use App\Http\Controllers\TeacherAuthController;

Artisan::call('migrate', ['--force' => true]);

echo "\n╔══════════════════════════════════════════════════════════════╗\n";
echo "║  Tecorbi Kids Arena — Phase 2.2 Remediation Test Suite      ║\n";
echo "║  Database: :memory: SQLite (safe, isolated)                 ║\n";
echo "╚══════════════════════════════════════════════════════════════╝\n\n";

$passed = 0;
$failed = 0;

function p22_assert($cond, string $label) {
    global $passed, $failed;
    if ($cond) {
        $passed++;
        echo "  ✅ PASS: {$label}\n";
    } else {
        $failed++;
        echo "  ❌ FAIL: {$label}\n";
    }
}

function p22_eq($expected, $actual, string $label) {
    p22_assert($expected === $actual, $label . ($expected === $actual ? '' : ' (expected ' . var_export($expected, true) . ', got ' . var_export($actual, true) . ')'));
}

$sessionCtrl = app(SessionController::class);
$gameCtrl = app(GameController::class);
$authCtrl = app(TeacherAuthController::class);

function makeSessionPayload(int $numQuestions = 3): array {
    $qs = [];
    for ($i = 1; $i <= $numQuestions; $i++) {
        $qs[] = [
            'question_text' => "Question {$i}",
            'question_text_ar' => "سؤال {$i}",
            'time_limit' => 20,
            'choices' => [
                ['choice_text' => "Wrong {$i}", 'is_correct' => false],
                ['choice_text' => "Right {$i}", 'is_correct' => true],
            ],
        ];
    }
    return [
        'teacher_name' => 'Ms. Hoda',
        'title' => 'Phase 2.2 Test Quiz',
        'questions' => $qs,
    ];
}

// ── Part 1: Event Payloads, state_version & question_id ──
echo "── Part 1: Event Payloads, state_version & question_id ──\n";
{
    $req = Request::create('/api/sessions', 'POST', makeSessionPayload(3));
    $res = json_decode($sessionCtrl->store($req)->getContent(), true);
    $pin = $res['pin'];

    $capturedEvents = [];
    Event::listen(GameStarted::class, function ($e) use (&$capturedEvents) {
        $capturedEvents['GameStarted'] = $e->broadcastWith();
    });
    Event::listen(AnswerRevealed::class, function ($e) use (&$capturedEvents) {
        $capturedEvents['AnswerRevealed'] = $e->broadcastWith();
    });

    $startData = json_decode($sessionCtrl->start($pin)->getContent(), true);
    p22_assert(isset($capturedEvents['GameStarted']), 'GameStarted event dispatched');
    p22_eq($startData['state_version'], $capturedEvents['GameStarted']['state_version'], 'GameStarted state_version matches API response');
    p22_eq($startData['question_started_at'], $capturedEvents['GameStarted']['question_started_at'], 'GameStarted question_started_at matches API response');

    $session = GameSession::where('pin', $pin)->first();
    $q0 = $session->currentQuestion();

    $revealResp = $sessionCtrl->reveal($pin);
    $revealData = json_decode($revealResp->getContent(), true);
    p22_eq(200, $revealResp->getStatusCode(), 'reveal() succeeds');
    p22_assert(isset($capturedEvents['AnswerRevealed']), 'AnswerRevealed event dispatched');
    p22_eq($q0->id, $capturedEvents['AnswerRevealed']['question_id'], 'AnswerRevealed includes current question_id');
    p22_eq($revealData['state_version'], $capturedEvents['AnswerRevealed']['state_version'], 'AnswerRevealed state_version matches API response');
    p22_assert((bool) $q0->fresh()->is_revealed === true, 'Q0 marked is_revealed=true on reveal');

    // Idempotent second reveal
    $revealResp2 = json_decode($sessionCtrl->reveal($pin)->getContent(), true);
    p22_eq($revealData['state_version'], $revealResp2['state_version'], 'Duplicate reveal is idempotent (same state_version)');

    // Reset clears is_revealed
    $sessionCtrl->reset($pin);
    p22_assert((bool) $q0->fresh()->is_revealed === false, 'reset() clears question is_revealed flag');
}

// ── Part 2: Header-only Player Token Transport ──
echo "\n── Part 2: Header-only Player Token Transport ──\n";
{
    $res = json_decode($sessionCtrl->store(Request::create('/api/sessions', 'POST', makeSessionPayload(2)))->getContent(), true);
    $pin = $res['pin'];
    $join1 = json_decode($sessionCtrl->join(Request::create("/api/sessions/{$pin}/join", 'POST', [
        'name' => 'StudentOne',
        'avatar' => 'astronaut',
    ]), $pin)->getContent(), true);
    $p1 = $join1['player'];
    $token1 = $join1['player_token'];

    $sessionCtrl->start($pin);
    $session = GameSession::where('pin', $pin)->first();
    $session->update(['question_started_at' => (int) round(microtime(true) * 1000) - 2000]);
    $q0 = $session->currentQuestion();
    $rightChoice = $q0->choices()->where('is_correct', true)->first();

    // Query token on GET /me MUST fail (401)
    $meQueryReq = Request::create("/api/sessions/{$pin}/me?player_token={$token1}", 'GET');
    p22_eq(401, $sessionCtrl->me($meQueryReq, $pin)->getStatusCode(), 'GET /me rejects player_token in query string');

    // Bearer token on GET /me MUST fail (401)
    $meBearerReq = Request::create("/api/sessions/{$pin}/me", 'GET');
    $meBearerReq->headers->set('Authorization', "Bearer {$token1}");
    p22_eq(401, $sessionCtrl->me($meBearerReq, $pin)->getStatusCode(), 'GET /me rejects Authorization Bearer token');

    // Body token on POST /answer MUST fail (403)
    $ansBodyReq = Request::create("/api/sessions/{$pin}/answer", 'POST', [
        'player_id' => $p1['id'],
        'choice_id' => $rightChoice->id,
        'player_token' => $token1,
    ]);
    p22_eq(403, $gameCtrl->answer($ansBodyReq, $pin)->getStatusCode(), 'POST /answer rejects player_token in body');

    // Query token on GET /my-result MUST fail (403)
    $sessionCtrl->reveal($pin);
    $mrQueryReq = Request::create("/api/sessions/{$pin}/my-result?player_token={$token1}", 'GET');
    p22_eq(403, $gameCtrl->myResult($mrQueryReq, $pin)->getStatusCode(), 'GET /my-result rejects player_token in query');

    // Header token on GET /my-result MUST succeed (200)
    $mrHeaderReq = Request::create("/api/sessions/{$pin}/my-result", 'GET');
    $mrHeaderReq->headers->set('X-Player-Token', $token1);
    p22_eq(200, $gameCtrl->myResult($mrHeaderReq, $pin)->getStatusCode(), 'GET /my-result accepts X-Player-Token header');

    // Query token on GET /leaderboard must NOT populate my_rank
    $lbQueryReq = Request::create("/api/sessions/{$pin}/leaderboard?player_token={$token1}", 'GET');
    $lbQueryData = json_decode($gameCtrl->leaderboard($lbQueryReq, $pin)->getContent(), true);
    p22_assert($lbQueryData['my_rank'] === null, 'GET /leaderboard ignores query player_token');

    // Header token on GET /leaderboard populates my_rank
    $lbHeaderReq = Request::create("/api/sessions/{$pin}/leaderboard", 'GET');
    $lbHeaderReq->headers->set('X-Player-Token', $token1);
    $lbHeaderData = json_decode($gameCtrl->leaderboard($lbHeaderReq, $pin)->getContent(), true);
    p22_eq(1, $lbHeaderData['my_rank'], 'GET /leaderboard accepts X-Player-Token header');
}

// ── Part 3: Student Reconnection GET /sessions/{pin}/me across ALL states ──
echo "\n── Part 3: Student Reconnection GET /me Across All States ──\n";
{
    $res = json_decode($sessionCtrl->store(Request::create('/api/sessions', 'POST', makeSessionPayload(2)))->getContent(), true);
    $pin = $res['pin'];

    $jA = json_decode($sessionCtrl->join(Request::create("/api/sessions/{$pin}/join", 'POST', [
        'name' => 'ReconnA',
        'avatar' => 'ninja',
    ]), $pin)->getContent(), true);
    $jB = json_decode($sessionCtrl->join(Request::create("/api/sessions/{$pin}/join", 'POST', [
        'name' => 'ReconnB',
        'avatar' => 'robot',
    ]), $pin)->getContent(), true);
    $jC = json_decode($sessionCtrl->join(Request::create("/api/sessions/{$pin}/join", 'POST', [
        'name' => 'ReconnC',
        'avatar' => 'wizard',
    ]), $pin)->getContent(), true);

    $tokenA = $jA['player_token'];
    $idA = $jA['player']['id'];
    $tokenB = $jB['player_token'];
    $idB = $jB['player']['id'];

    $callMe = function (string $tok, string $targetPin) use ($sessionCtrl) {
        $r = Request::create("/api/sessions/{$targetPin}/me", 'GET');
        $r->headers->set('X-Player-Token', $tok);
        return $sessionCtrl->me($r, $targetPin);
    };

    // State 1: waiting
    $meWait = json_decode($callMe($tokenA, $pin)->getContent(), true);
    p22_eq('waiting', $meWait['session']['status'], 'me() in waiting status');
    p22_eq(false, $meWait['answered'], 'me() in waiting shows answered=false');

    // State 2: active unanswered
    $sessionCtrl->start($pin);
    $session = GameSession::where('pin', $pin)->first();
    $session->update(['question_started_at' => (int) round(microtime(true) * 1000) - 1000]);
    $q0 = $session->currentQuestion();
    $rightChoice = $q0->choices()->where('is_correct', true)->first();
    $wrongChoice = $q0->choices()->where('is_correct', false)->first();

    $meActiveUnanswered = json_decode($callMe($tokenA, $pin)->getContent(), true);
    p22_eq('active', $meActiveUnanswered['session']['status'], 'me() in active unanswered status');
    p22_eq(false, $meActiveUnanswered['answered'], 'me() active unanswered has answered=false');

    // State 3: active answered (must hide correctness & points before reveal!)
    $ansReqA = Request::create("/api/sessions/{$pin}/answer", 'POST', [
        'player_id' => $idA,
        'choice_id' => $rightChoice->id,
    ]);
    $ansReqA->headers->set('X-Player-Token', $tokenA);
    $gameCtrl->answer($ansReqA, $pin);

    $ansReqB = Request::create("/api/sessions/{$pin}/answer", 'POST', [
        'player_id' => $idB,
        'choice_id' => $wrongChoice->id,
    ]);
    $ansReqB->headers->set('X-Player-Token', $tokenB);
    $gameCtrl->answer($ansReqB, $pin);

    $meActiveAnswered = json_decode($callMe($tokenA, $pin)->getContent(), true);
    p22_eq(true, $meActiveAnswered['answered'], 'me() active answered has answered=true');
    p22_eq($rightChoice->id, $meActiveAnswered['answer']['choice_id'], 'me() active answered preserves choice_id');
    p22_eq($q0->id, $meActiveAnswered['answer']['question_id'], 'me() active answered includes question_id');
    p22_assert(!isset($meActiveAnswered['answer']['is_correct']), 'me() does NOT leak is_correct before reveal');
    p22_assert($meActiveAnswered['session']['current_question']['correct_choice_id'] === null, 'me() does NOT leak correct_choice_id before reveal');

    // State 4: paused
    $sessionCtrl->pause($pin);
    $mePaused = json_decode($callMe($tokenA, $pin)->getContent(), true);
    p22_eq('paused', $mePaused['session']['status'], 'me() in paused status');
    p22_assert($mePaused['session']['question_paused_remaining_ms'] !== null, 'me() in paused includes remaining ms');

    // Resume then State 5 & 6: revealed (correct vs wrong)
    $sessionCtrl->resume($pin);
    $sessionCtrl->reveal($pin);
    $meRevA = json_decode($callMe($tokenA, $pin)->getContent(), true);
    p22_eq('revealed', $meRevA['session']['question_state'], 'me() in revealed state');
    p22_eq(true, $meRevA['answer']['is_correct'], 'me() revealed correct player has is_correct=true');
    p22_assert($meRevA['answer']['points_earned'] > 0, 'me() revealed correct player has points_earned > 0');
    p22_eq($rightChoice->id, $meRevA['session']['current_question']['correct_choice_id'], 'me() revealed exposes correct_choice_id');

    $meRevB = json_decode($callMe($tokenB, $pin)->getContent(), true);
    p22_eq(false, $meRevB['answer']['is_correct'], 'me() revealed wrong player has is_correct=false');
    p22_eq(0, $meRevB['answer']['points_earned'], 'me() revealed wrong player has points_earned=0');

    // State 7: completed
    $sessionCtrl->end($pin);
    $meCompleted = json_decode($callMe($tokenA, $pin)->getContent(), true);
    p22_eq('completed', $meCompleted['session']['status'], 'me() in completed status');

    // State 8 & 9: invalid token & deleted player
    p22_eq(403, $callMe('invalid-token-xyz', $pin)->getStatusCode(), 'me() with invalid token returns 403');
    Player::where('id', $idB)->delete();
    p22_eq(403, $callMe($tokenB, $pin)->getStatusCode(), 'me() with deleted player returns 403');
}

// ── Part 4: myResult() Fail-Closed Edge Cases ──
echo "\n── Part 4: myResult() Fail-Closed Edge Cases ──\n";
{
    $res = json_decode($sessionCtrl->store(Request::create('/api/sessions', 'POST', makeSessionPayload(3)))->getContent(), true);
    $pin = $res['pin'];
    $otherRes = json_decode($sessionCtrl->store(Request::create('/api/sessions', 'POST', makeSessionPayload(1)))->getContent(), true);
    $otherSession = GameSession::where('pin', $otherRes['pin'])->first();
    $otherQuestion = $otherSession->questions()->first();

    $j = json_decode($sessionCtrl->join(Request::create("/api/sessions/{$pin}/join", 'POST', [
        'name' => 'EdgeStudent',
        'avatar' => 'wizard',
    ]), $pin)->getContent(), true);
    $tok = $j['player_token'];

    $sessionCtrl->start($pin);
    $session = GameSession::where('pin', $pin)->first();
    $allQs = $session->questions()->orderBy('order')->get();
    $q0 = $allQs[0];
    $q1 = $allQs[1];
    $q2 = $allQs[2];

    $callMyResult = function (?int $qid = null) use ($gameCtrl, $pin, $tok) {
        $url = "/api/sessions/{$pin}/my-result" . ($qid ? "?question_id={$qid}" : '');
        $r = Request::create($url, 'GET');
        $r->headers->set('X-Player-Token', $tok);
        return $gameCtrl->myResult($r, $pin);
    };

    // Advance from Q0 WITHOUT revealing Q0!
    $sessionCtrl->next(Request::create("/api/sessions/{$pin}/next", 'POST'), $pin);

    // Skipping Q0 without revealing MUST deny myResult?question_id=Q0
    $skippedResp = $callMyResult($q0->id);
    p22_eq(409, $skippedResp->getStatusCode(), 'myResult rejects unrevealed skipped historical Q0 (409)');

    // Future Q2 MUST return 409
    $futureResp = $callMyResult($q2->id);
    p22_eq(409, $futureResp->getStatusCode(), 'myResult rejects future Q2 (409)');

    // Cross-session question ID MUST return 422 NO_QUESTION
    $crossResp = $callMyResult($otherQuestion->id);
    p22_eq(422, $crossResp->getStatusCode(), 'myResult rejects cross-session question_id (422)');

    // Reveal Q1, then advance to Q2 -> historical Q1 IS revealed so returns 200
    $sessionCtrl->reveal($pin);
    $sessionCtrl->next(Request::create("/api/sessions/{$pin}/next", 'POST'), $pin);
    $revHistResp = $callMyResult($q1->id);
    p22_eq(200, $revHistResp->getStatusCode(), 'myResult allows revealed historical Q1 (200)');

    // Null current question (out-of-bounds index) -> 422 NO_QUESTION fail closed
    $session->update(['current_question_index' => 99]);
    $nullQResp = $callMyResult($q1->id);
    p22_eq(422, $nullQResp->getStatusCode(), 'myResult fails closed with 422 when currentQuestion is null');
}

// ── Part 5: POST /teacher/auth Endpoint ──
echo "\n── Part 5: POST /teacher/auth Endpoint ──\n";
{
    config(['quiz.teacher_access_key' => null]);
    $rUnconf = Request::create('/api/teacher/auth', 'POST', ['access_key' => '1234']);
    p22_eq(503, $authCtrl->auth($rUnconf)->getStatusCode(), 'teacher/auth returns 503 when TEACHER_ACCESS_KEY is unset');

    config(['quiz.teacher_access_key' => 'super-secret-classroom-key']);
    $rWrong = Request::create('/api/teacher/auth', 'POST', ['access_key' => '1234']);
    p22_eq(403, $authCtrl->auth($rWrong)->getStatusCode(), 'teacher/auth rejects wrong key (403)');

    $rOk = Request::create('/api/teacher/auth', 'POST', ['access_key' => 'super-secret-classroom-key']);
    $okResp = $authCtrl->auth($rOk);
    $okData = json_decode($okResp->getContent(), true);
    p22_eq(200, $okResp->getStatusCode(), 'teacher/auth accepts matching key (200)');
    p22_assert($okData['authenticated'] === true && strlen($okData['teacher_portal_token']) >= 32, 'teacher/auth returns high-entropy teacher_portal_token');
}

// ── Part 6: Migration Non-Destructive Deduplication ──
echo "\n── Part 6: Migration 2024_01_04_000001 Data-Loss Prevention ──\n";
{
    // Test directly using an isolated secondary sqlite :memory: connection
    config(['database.connections.migtest' => ['driver' => 'sqlite', 'database' => ':memory:']]);
    $prevDefault = config('database.default');
    DB::setDefaultConnection('migtest');

    DB::statement('CREATE TABLE players (id INTEGER PRIMARY KEY AUTOINCREMENT, game_session_id INTEGER, name VARCHAR(255), avatar VARCHAR(255), score INTEGER DEFAULT 0, streak INTEGER DEFAULT 0, token_hash VARCHAR(64), joined_at DATETIME, created_at DATETIME, updated_at DATETIME)');
    DB::statement('CREATE TABLE answers (id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER, question_id INTEGER, choice_id INTEGER, is_correct INTEGER, time_taken REAL, points_earned INTEGER, answered_at DATETIME)');

    DB::table('players')->insert([
        ['id' => 1, 'game_session_id' => 10, 'name' => 'Omar', 'avatar' => 'ninja', 'score' => 900],
        ['id' => 2, 'game_session_id' => 10, 'name' => 'Omar', 'avatar' => 'robot', 'score' => 850],
        ['id' => 3, 'game_session_id' => 10, 'name' => 'Omar', 'avatar' => 'wizard', 'score' => 800],
    ]);
    DB::table('answers')->insert([
        ['player_id' => 1, 'question_id' => 1, 'choice_id' => 1, 'is_correct' => 1, 'time_taken' => 1.0, 'points_earned' => 900],
        ['player_id' => 2, 'question_id' => 1, 'choice_id' => 1, 'is_correct' => 1, 'time_taken' => 2.0, 'points_earned' => 850],
        ['player_id' => 3, 'question_id' => 1, 'choice_id' => 1, 'is_correct' => 1, 'time_taken' => 3.0, 'points_earned' => 800],
    ]);

    $migration = require __DIR__ . '/../database/migrations/2024_01_04_000001_add_unique_index_to_players_table.php';
    $migration->up();

    p22_eq(3, DB::table('players')->count(), 'Migration preserves all 3 duplicate player records (no deletions)');
    p22_eq(3, DB::table('answers')->count(), 'Migration preserves all 3 answer records (no cascade data loss)');
    p22_eq('Omar', DB::table('players')->where('id', 1)->value('name'), 'First duplicate keeps original name');
    p22_eq('Omar_dup_1', DB::table('players')->where('id', 2)->value('name'), 'Second duplicate renamed to Omar_dup_1');
    p22_eq('Omar_dup_2', DB::table('players')->where('id', 3)->value('name'), 'Third duplicate renamed to Omar_dup_2');

    $dupInsertFailed = false;
    try {
        DB::table('players')->insert(['game_session_id' => 10, 'name' => 'Omar', 'avatar' => 'cat']);
    } catch (\Throwable $e) {
        $dupInsertFailed = true;
    }
    p22_assert($dupInsertFailed, 'Unique index prevents new duplicate names');

    $migration->down();
    DB::table('players')->insert(['game_session_id' => 10, 'name' => 'Omar', 'avatar' => 'cat']);
    p22_eq(4, DB::table('players')->count(), 'Migration down() cleanly drops unique index');

    DB::setDefaultConnection($prevDefault);
}

// ── Part 7: DatabaseSeeder Production Environment Guard ──
echo "\n── Part 7: DatabaseSeeder Production Guard ──\n";
{
    GameSession::where('pin', '123456')->delete();
    $origEnv = $app['env'];
    $app['env'] = 'production';
    $seeder = new \Database\Seeders\DatabaseSeeder();
    $seeder->run();
    p22_eq(0, GameSession::where('pin', '123456')->count(), 'DatabaseSeeder skips demo PIN 123456 in production environment');
    $app['env'] = $origEnv;
}

// ── Part 8: Rate Limiter Keying (Header-Only) & api.auth ──
echo "\n── Part 8: Rate Limiter Header-Only Keying ──\n";
{
    $authLimiter = RateLimiter::limiter('api.auth');
    p22_assert(is_callable($authLimiter), 'api.auth rate limiter is registered');

    $ansLimiter = RateLimiter::limiter('api.answer');
    $rBodyOnly = Request::create('/api/sessions/123456/answer', 'POST', ['player_token' => 'spoofed-body-token', 'player_id' => 999]);
    $rBodyOnly->server->set('REMOTE_ADDR', '10.0.0.55');
    $key = $ansLimiter($rBodyOnly)->key;
    p22_assert(!str_contains($key, 'spoofed-body-token') && !str_contains($key, '999'), 'api.answer limiter ignores body player_token and player_id');
    p22_assert(str_contains($key, '10.0.0.55'), 'api.answer limiter falls back to IP when X-Player-Token header absent');
}

echo "\n╔══════════════════════════════════════════════════════════════╗\n";
echo "║  PHASE 2.2 RESULTS: {$passed} passed, {$failed} failed                     ║\n";
echo "╚══════════════════════════════════════════════════════════════╝\n\n";

exit($failed === 0 ? 0 : 1);
