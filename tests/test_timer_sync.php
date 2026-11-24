<?php
/**
 * Tecorbi Kids Arena — Server-Authoritative Timer Feature Tests
 * 
 * Standalone test runner (no PHPUnit required).
 * Uses in-memory SQLite (:memory:) — does NOT touch database/database.sqlite.
 * 
 * Run: php tests/test_timer_sync.php
 */

// ── Bootstrap Laravel ──
$_ENV['DB_CONNECTION'] = 'sqlite';
$_ENV['DB_DATABASE'] = ':memory:';
$_ENV['BROADCAST_CONNECTION'] = 'null';
putenv('DB_CONNECTION=sqlite');
putenv('DB_DATABASE=:memory:');
putenv('BROADCAST_CONNECTION=null');

require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$kernel = $app->make(\Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

// Force in-memory SQLite for safety
config([
    'database.default' => 'sqlite',
    'database.connections.sqlite.database' => ':memory:',
    'database.connections.sqlite.busy_timeout' => 5000,
    'broadcasting.default' => 'null',
]);

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Artisan;
use App\Models\GameSession;
use App\Models\Question;
use App\Models\Choice;
use App\Models\Player;
use App\Models\Answer;

// ── Run migrations in memory ──
Artisan::call('migrate', ['--force' => true]);
config(['quiz.reveal_on_answer' => true]);

// ── Test Framework ──
$passed = 0;
$failed = 0;
$errors = [];

function assert_true($condition, string $label) {
    global $passed, $failed, $errors;
    if ($condition) {
        $passed++;
        echo "  ✅ PASS: {$label}\n";
    } else {
        $failed++;
        $errors[] = $label;
        echo "  ❌ FAIL: {$label}\n";
    }
}

function assert_eq($expected, $actual, string $label) {
    global $passed, $failed, $errors;
    if ($expected === $actual) {
        $passed++;
        echo "  ✅ PASS: {$label}\n";
    } else {
        $failed++;
        $errors[] = "{$label} (expected " . json_encode($expected) . ", got " . json_encode($actual) . ")";
        echo "  ❌ FAIL: {$label} (expected " . json_encode($expected) . ", got " . json_encode($actual) . ")\n";
    }
}

/** Create a fresh session with one 20s question and return [session, question, correctChoice, wrongChoice] */
function createTestSession(): array {
    $session = GameSession::create([
        'pin' => GameSession::generatePin(),
        'teacher_name' => 'Test Teacher',
        'title' => 'Test Quiz',
    ]);
    $question = $session->questions()->create([
        'question_text' => 'What is 2+2?',
        'question_text_ar' => 'ما هو ٢+٢؟',
        'order' => 0,
        'time_limit' => 20,
    ]);
    $correct = $question->choices()->create([
        'choice_text' => '4', 'choice_text_ar' => '٤', 'is_correct' => true, 'order' => 0,
    ]);
    $wrong = $question->choices()->create([
        'choice_text' => '5', 'choice_text_ar' => '٥', 'is_correct' => false, 'order' => 1,
    ]);
    return [$session, $question, $correct, $wrong];
}

/** Helper to create an authenticated test player */
function createTestPlayer(GameSession $session, string $name = 'Test Student', string $avatar = 'robot'): array {
    $token = bin2hex(random_bytes(16));
    $player = $session->players()->create([
        'name' => $name,
        'avatar' => $avatar,
        'token_hash' => hash('sha256', $token),
        'joined_at' => now(),
    ]);
    return [$player, $token];
}

/** Create a session with multiple questions */
function createMultiQuestionSession(): array {
    $session = GameSession::create([
        'pin' => GameSession::generatePin(),
        'teacher_name' => 'Test Teacher',
        'title' => 'Multi Q Quiz',
    ]);
    $questions = [];
    for ($i = 0; $i < 3; $i++) {
        $q = $session->questions()->create([
            'question_text' => "Question {$i}",
            'order' => $i,
            'time_limit' => 20,
        ]);
        $q->choices()->create(['choice_text' => 'Right', 'is_correct' => true, 'order' => 0]);
        $q->choices()->create(['choice_text' => 'Wrong', 'is_correct' => false, 'order' => 1]);
        $questions[] = $q;
    }
    return [$session, $questions];
}

function nowMs(): int {
    return (int) round(microtime(true) * 1000);
}

echo "\n╔══════════════════════════════════════════════════════════════╗\n";
echo "║  Tecorbi Kids Arena — Server-Authoritative Timer Tests     ║\n";
echo "║  Database: :memory: SQLite (safe, no production writes)    ║\n";
echo "╚══════════════════════════════════════════════════════════════╝\n\n";

// ═══════════════════════════════════════════════════════════════════
// TEST 1: start() sets question_started_at and bumps state_version
// ═══════════════════════════════════════════════════════════════════
echo "── Test 1: start() sets question_started_at = nowMs + sync_lead_ms, bumps state_version ──\n";
{
    [$session, $question, $correct, $wrong] = createTestSession();
    $leadMs = config('quiz.sync_lead_ms', 2000);
    $beforeMs = nowMs();

    // Call start endpoint via controller
    $request = \Illuminate\Http\Request::create("/api/sessions/{$session->pin}/start", 'POST');
    $controller = new \App\Http\Controllers\SessionController();
    $response = $controller->start($session->pin);
    $data = json_decode($response->getContent(), true);

    $afterMs = nowMs();
    $session->refresh();

    assert_eq('active', $session->status, 'Session status is active');
    assert_eq(0, $session->current_question_index, 'Current question index is 0');
    assert_eq('answering', $session->question_state, 'Question state is answering');
    assert_true($session->state_version >= 1, 'state_version bumped >= 1');
    assert_true($session->question_started_at !== null, 'question_started_at is set');
    assert_true(
        $session->question_started_at >= $beforeMs + $leadMs - 50 &&
        $session->question_started_at <= $afterMs + $leadMs + 50,
        "question_started_at ≈ nowMs + {$leadMs}ms"
    );
    assert_true(isset($data['server_now_ms']), 'Response includes server_now_ms');
    assert_true(isset($data['question_started_at']), 'Response includes question_started_at');
    assert_true(isset($data['state_version']), 'Response includes state_version');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 2: next() advances question and sets timing; idempotency
// ═══════════════════════════════════════════════════════════════════
echo "\n── Test 2: next() advances question, sets timing; double-click idempotent ──\n";
{
    [$session, $questions] = createMultiQuestionSession();
    $controller = new \App\Http\Controllers\SessionController();

    // Start the game
    $controller->start($session->pin);
    $session->refresh();
    $versionAfterStart = $session->state_version;

    // First next() — should go to question index 1
    $request = new \Illuminate\Http\Request();
    $request->merge(['expected_index' => 0]);
    // Inject request into app context
    app()->instance('request', $request);
    $response = $controller->next($request, $session->pin);
    $data = json_decode($response->getContent(), true);
    $session->refresh();

    assert_eq(1, $session->current_question_index, 'After next(): current_question_index is 1');
    assert_true($session->question_started_at !== null, 'After next(): question_started_at is set');
    assert_true($session->state_version > $versionAfterStart, 'After next(): state_version bumped');

    $versionAfterNext = $session->state_version;
    $startedAtAfterNext = $session->question_started_at;

    // Double-click: same expected_index (now 0, but current is 1) → idempotent, no skip
    $request2 = new \Illuminate\Http\Request();
    $request2->merge(['expected_index' => 0]);
    app()->instance('request', $request2);
    $response2 = $controller->next($request2, $session->pin);
    $data2 = json_decode($response2->getContent(), true);
    $session->refresh();

    assert_eq(1, $session->current_question_index, 'Double-click with wrong expected_index: still at 1');
    assert_eq($startedAtAfterNext, $session->question_started_at, 'Double-click: question_started_at unchanged');

    // Rapid double-click within 800ms (correct expected_index but too fast)
    $session->update(['question_started_at' => nowMs()]); // simulate just started
    $session->refresh();
    $request3 = new \Illuminate\Http\Request();
    $request3->merge(['expected_index' => 1]);
    app()->instance('request', $request3);
    $response3 = $controller->next($request3, $session->pin);
    $session->refresh();

    assert_eq(1, $session->current_question_index, 'Rapid click within 800ms: index still 1 (not skipped)');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 3: poll() and state() expose additive fields consistently
// ═══════════════════════════════════════════════════════════════════
echo "\n── Test 3: poll() and state() expose server_now_ms, question_started_at, state_version ──\n";
{
    [$session, $question, $correct, $wrong] = createTestSession();
    $controller = new \App\Http\Controllers\SessionController();
    $controller->start($session->pin);

    $pollResp = json_decode($controller->poll($session->pin)->getContent(), true);
    $stateResp = json_decode($controller->state($session->pin)->getContent(), true);

    assert_true(isset($pollResp['server_now_ms']), 'poll() has server_now_ms');
    assert_true(isset($pollResp['question_started_at']), 'poll() has question_started_at');
    assert_true(isset($pollResp['state_version']), 'poll() has state_version');
    assert_true(isset($pollResp['current_question']), 'poll() has current_question');
    assert_true(isset($pollResp['leaderboard']), 'poll() has leaderboard');

    assert_true(isset($stateResp['server_now_ms']), 'state() has server_now_ms');
    assert_true(isset($stateResp['question_started_at']), 'state() has question_started_at');
    assert_true(isset($stateResp['state_version']), 'state() has state_version');

    assert_eq($pollResp['question_started_at'], $stateResp['question_started_at'], 'poll and state question_started_at match');
    assert_eq($pollResp['state_version'], $stateResp['state_version'], 'poll and state state_version match');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 4: answer() accepted in valid window, score uses server time
// ═══════════════════════════════════════════════════════════════════
echo "\n── Test 4: answer() accepted during active window, score computed from server time_taken ──\n";
{
    [$session, $question, $correct, $wrong] = createTestSession();
    $controller = new \App\Http\Controllers\SessionController();
    $gameController = new \App\Http\Controllers\GameController();

    // Start the session, then wait past lead time
    $controller->start($session->pin);
    $session->refresh();
    // Simulate: shift question_started_at to 3s ago so we're in the answering window
    $session->update(['question_started_at' => nowMs() - 3000]);

    [$player, $token] = createTestPlayer($session, 'Test Student', 'robot');

    $request = \Illuminate\Http\Request::create("/api/sessions/{$session->pin}/answer", 'POST', [
        'player_id' => $player->id,
        'choice_id' => $correct->id,
        'player_token' => $token,
        'time_taken' => 999, // should be IGNORED
    ]);
    $request->headers->set('X-Player-Token', $token);
    $response = $gameController->answer($request, $session->pin);
    $data = json_decode($response->getContent(), true);

    assert_true($response->getStatusCode() === 200, 'Answer accepted (HTTP 200)');
    assert_true($data['is_correct'] === true, 'is_correct is true');
    assert_true($data['points_earned'] > 0, 'Points earned > 0');
    assert_true($data['points_earned'] >= 500 && $data['points_earned'] <= 1000, 'Score within Kahoot range [500,1000]');

    // Verify server computed time_taken, not the client's 999
    $answer = Answer::where('player_id', $player->id)->where('question_id', $question->id)->first();
    assert_true($answer !== null, 'Answer record exists in DB');
    assert_true($answer->time_taken < 10, 'Server time_taken < 10s (not client 999)');
    assert_true($answer->time_taken >= 2.5, 'Server time_taken >= 2.5s (we waited ~3s)');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 5: answer() boundary timing (before, exactly at, after start)
// ═══════════════════════════════════════════════════════════════════
echo "\n── Test 5: answer() rejected before start, accepted at and after start ──\n";
{
    [$session, $question, $correct, $wrong] = createTestSession();
    $controller = new \App\Http\Controllers\SessionController();
    $gameController = new \App\Http\Controllers\GameController();

    $controller->start($session->pin);
    $session->refresh();

    // Case A: 100ms before start timestamp (TOO_EARLY)
    $session->update(['question_started_at' => nowMs() + 100]);
    [$playerA, $tokenA] = createTestPlayer($session, 'Early 100ms', 'ninja');
    $reqA = \Illuminate\Http\Request::create("/api/sessions/{$session->pin}/answer", 'POST', [
        'player_id' => $playerA->id,
        'choice_id' => $correct->id,
        'player_token' => $tokenA,
    ]);
    $reqA->headers->set('X-Player-Token', $tokenA);
    $respA = $gameController->answer($reqA, $session->pin);
    $dataA = json_decode($respA->getContent(), true);

    assert_eq(422, $respA->getStatusCode(), 'Answer 100ms before start: HTTP 422');
    assert_eq('TOO_EARLY', $dataA['code'] ?? null, 'TOO_EARLY error code returned');
    assert_eq(0, (int) $playerA->fresh()->score, 'Early answer player has 0 score');
    assert_eq(0, Answer::where('player_id', $playerA->id)->count(), 'No answer record stored for early submission');

    // Case B: Exactly at start timestamp (nowMs === startedAt)
    $nowExact = nowMs();
    $session->update(['question_started_at' => $nowExact]);
    [$playerB, $tokenB] = createTestPlayer($session, 'Exact Start', 'robot');
    $reqB = \Illuminate\Http\Request::create("/api/sessions/{$session->pin}/answer", 'POST', [
        'player_id' => $playerB->id,
        'choice_id' => $correct->id,
        'player_token' => $tokenB,
    ]);
    $reqB->headers->set('X-Player-Token', $tokenB);
    $respB = $gameController->answer($reqB, $session->pin);
    $dataB = json_decode($respB->getContent(), true);

    assert_eq(200, $respB->getStatusCode(), 'Answer exactly at start: HTTP 200');
    assert_true($dataB['is_correct'] === true, 'Answer exactly at start is marked correct');
    assert_eq(1000, (int) $dataB['points_earned'], 'Answer at start receives full 1000 points');

    // Case C: After start timestamp (normal answering window)
    $session->update(['question_started_at' => nowMs() - 2000]);
    [$playerC, $tokenC] = createTestPlayer($session, 'Normal 2s', 'wizard');
    $reqC = \Illuminate\Http\Request::create("/api/sessions/{$session->pin}/answer", 'POST', [
        'player_id' => $playerC->id,
        'choice_id' => $correct->id,
        'player_token' => $tokenC,
    ]);
    $reqC->headers->set('X-Player-Token', $tokenC);
    $respC = $gameController->answer($reqC, $session->pin);
    $dataC = json_decode($respC->getContent(), true);

    assert_eq(200, $respC->getStatusCode(), 'Answer 2s after start: HTTP 200');
    assert_true($dataC['points_earned'] >= 500 && $dataC['points_earned'] <= 1000, 'Points within range');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 6: answer() rejected after deadline + grace (TIME_EXPIRED)
// ═══════════════════════════════════════════════════════════════════
echo "\n── Test 6: answer() rejected after deadline + grace (TIME_EXPIRED) ──\n";
{
    [$session, $question, $correct, $wrong] = createTestSession();
    $controller = new \App\Http\Controllers\SessionController();
    $gameController = new \App\Http\Controllers\GameController();

    $controller->start($session->pin);
    $session->refresh();
    // Set question_started_at to 30s ago (time_limit=20s, grace=1s, so deadline was 9s ago)
    $session->update(['question_started_at' => nowMs() - 30000]);

    [$player, $token] = createTestPlayer($session, 'Late Larry', 'dragon');

    $request = \Illuminate\Http\Request::create("/api/sessions/{$session->pin}/answer", 'POST', [
        'player_id' => $player->id,
        'choice_id' => $correct->id,
        'player_token' => $token,
    ]);
    $request->headers->set('X-Player-Token', $token);
    $response = $gameController->answer($request, $session->pin);
    $data = json_decode($response->getContent(), true);

    assert_eq(422, $response->getStatusCode(), 'TIME_EXPIRED: HTTP 422');
    assert_eq('TIME_EXPIRED', $data['code'] ?? null, 'TIME_EXPIRED error code returned');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 7: Client-supplied time_taken is ignored
// ═══════════════════════════════════════════════════════════════════
echo "\n── Test 7: Client time_taken is ignored; server computes its own ──\n";
{
    [$session, $question, $correct, $wrong] = createTestSession();
    $controller = new \App\Http\Controllers\SessionController();
    $gameController = new \App\Http\Controllers\GameController();

    $controller->start($session->pin);
    $session->refresh();
    // 5s ago
    $session->update(['question_started_at' => nowMs() - 5000]);

    [$player, $token] = createTestPlayer($session, 'Trickster', 'wizard');

    // Client claims time_taken = 0.001 (cheating — impossibly fast)
    $request = \Illuminate\Http\Request::create("/api/sessions/{$session->pin}/answer", 'POST', [
        'player_id' => $player->id,
        'choice_id' => $correct->id,
        'player_token' => $token,
        'time_taken' => 0.001,
    ]);
    $request->headers->set('X-Player-Token', $token);
    $response = $gameController->answer($request, $session->pin);
    $data = json_decode($response->getContent(), true);

    $answer = Answer::where('player_id', $player->id)->where('question_id', $question->id)->first();
    assert_true($answer->time_taken >= 4.5, 'Server time_taken >= 4.5s (not client 0.001)');
    assert_true($answer->time_taken <= 6.0, 'Server time_taken <= 6.0s');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 8: Duplicate answer returns 422 without double-scoring
// ═══════════════════════════════════════════════════════════════════
echo "\n── Test 8: Duplicate answer returns 422, no double-scoring ──\n";
{
    [$session, $question, $correct, $wrong] = createTestSession();
    $controller = new \App\Http\Controllers\SessionController();
    $gameController = new \App\Http\Controllers\GameController();

    $controller->start($session->pin);
    $session->refresh();
    $session->update(['question_started_at' => nowMs() - 2000]);

    [$player, $token] = createTestPlayer($session, 'Double Click', 'cat');

    $request1 = \Illuminate\Http\Request::create("/api/sessions/{$session->pin}/answer", 'POST', [
        'player_id' => $player->id,
        'choice_id' => $correct->id,
        'player_token' => $token,
    ]);
    $request1->headers->set('X-Player-Token', $token);
    $response1 = $gameController->answer($request1, $session->pin);
    assert_eq(200, $response1->getStatusCode(), 'First answer: HTTP 200');

    $scoreAfterFirst = $player->fresh()->score;

    // Second attempt
    $request2 = \Illuminate\Http\Request::create("/api/sessions/{$session->pin}/answer", 'POST', [
        'player_id' => $player->id,
        'choice_id' => $wrong->id,
        'player_token' => $token,
    ]);
    $request2->headers->set('X-Player-Token', $token);
    $response2 = $gameController->answer($request2, $session->pin);
    assert_true(in_array($response2->getStatusCode(), [409, 422]), 'Duplicate answer: HTTP 409 or 422');

    $scoreAfterSecond = $player->fresh()->score;
    assert_eq($scoreAfterFirst, $scoreAfterSecond, 'Score unchanged after duplicate answer (no double-scoring)');

    $answerCount = Answer::where('player_id', $player->id)->where('question_id', $question->id)->count();
    assert_eq(1, $answerCount, 'Only 1 answer record in DB');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 9: Late join — remaining time is correct
// ═══════════════════════════════════════════════════════════════════
echo "\n── Test 9: Late join: request 5s after start on 20s question → ~15s remaining ──\n";
{
    [$session, $question, $correct, $wrong] = createTestSession();
    $controller = new \App\Http\Controllers\SessionController();

    $controller->start($session->pin);
    $session->refresh();
    // Simulate 5s elapsed since question started
    $questionStartedAt = nowMs() - 5000;
    $session->update(['question_started_at' => $questionStartedAt]);

    // Student polls
    $stateResp = json_decode($controller->state($session->pin)->getContent(), true);

    $serverNow = $stateResp['server_now_ms'];
    $startedAt = $stateResp['question_started_at'];
    $timeLimit = $stateResp['current_question']['time_limit']; // 20

    $elapsedS = ($serverNow - $startedAt) / 1000;
    $remainingS = $timeLimit - $elapsedS;

    assert_true($remainingS >= 14.0 && $remainingS <= 16.0, "Late join remaining ≈ 15s (got {$remainingS}s)");
    assert_eq(20, $timeLimit, 'time_limit is 20');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 10: pause() stores remaining time, resume() preserves it, idempotency & lead period
// ═══════════════════════════════════════════════════════════════════
echo "\n── Test 10: pause() and resume() idempotency, remaining time preservation, lead period ──\n";
{
    [$session, $question, $correct, $wrong] = createTestSession();
    $controller = new \App\Http\Controllers\SessionController();

    $controller->start($session->pin);
    $session->refresh();
    // Simulate 8s elapsed (should have ~12s remaining on 20s question)
    $session->update(['question_started_at' => nowMs() - 8000]);

    // First Pause
    $pauseResp1 = json_decode($controller->pause($session->pin)->getContent(), true);
    $session->refresh();

    assert_eq('paused', $session->status, 'After first pause: status is paused');
    assert_true($session->question_paused_remaining_ms !== null, 'After first pause: remaining_ms set');
    $remainingMs1 = $session->question_paused_remaining_ms;
    assert_true(
        $remainingMs1 >= 11000 && $remainingMs1 <= 13000,
        "First pause remaining ≈ 12000ms (got {$remainingMs1}ms)"
    );

    // Duplicate Pause 1 second later: MUST NOT recalculate or destroy remaining time!
    usleep(100000); // 100ms
    $pauseResp2 = json_decode($controller->pause($session->pin)->getContent(), true);
    $session->refresh();
    assert_eq('paused', $session->status, 'After duplicate pause: status is still paused');
    assert_eq($remainingMs1, $session->question_paused_remaining_ms, 'Duplicate pause: remaining_ms strictly identical (not reduced)');

    // Resume
    usleep(200000); // 200ms
    $resumeResp1 = json_decode($controller->resume($session->pin)->getContent(), true);
    $session->refresh();

    assert_eq('active', $session->status, 'After first resume: status is active');
    assert_true($session->question_paused_remaining_ms === null, 'After first resume: paused_remaining_ms cleared');
    $startedAtAfterResume1 = $session->question_started_at;

    // Check that the new started_at preserves the remaining time
    $newElapsedMs = nowMs() - $session->question_started_at;
    $newRemainingMs = 20000 - $newElapsedMs;
    assert_true(
        $newRemainingMs >= 10500 && $newRemainingMs <= 13500,
        "After resume: remaining ≈ 12s (got " . round($newRemainingMs/1000, 1) . "s)"
    );

    // Duplicate Resume: MUST NOT restart or extend the timer!
    $resumeResp2 = json_decode($controller->resume($session->pin)->getContent(), true);
    $session->refresh();
    assert_eq('active', $session->status, 'After duplicate resume: status is still active');
    assert_eq($startedAtAfterResume1, $session->question_started_at, 'Duplicate resume: question_started_at unchanged (timer not extended)');

    // ── Pause during 2-second synchronization lead period ──
    $leadMs = config('quiz.sync_lead_ms', 2000);
    // Set question_started_at to 1500ms in the future (inside lead period)
    $futureStart = nowMs() + 1500;
    $session->update([
        'status' => 'active',
        'question_started_at' => $futureStart,
        'question_paused_remaining_ms' => null,
    ]);

    $pauseLeadResp = json_decode($controller->pause($session->pin)->getContent(), true);
    $session->refresh();
    assert_eq('paused', $session->status, 'Pause during lead period: status is paused');
    assert_true($session->question_paused_remaining_ms > 20000, 'Pause during lead period: preserved lead flag (> 20000ms)');

    // Resume from lead period: question must resume with synchronization lead period!
    $resumeLeadResp = json_decode($controller->resume($session->pin)->getContent(), true);
    $session->refresh();
    assert_eq('active', $session->status, 'Resume from lead period: status is active');
    assert_true($session->question_started_at > nowMs(), 'Resume from lead period: question_started_at is in future (lead period active)');
    assert_true(
        $session->question_started_at <= nowMs() + $leadMs + 100 &&
        $session->question_started_at >= nowMs() + $leadMs - 200,
        "Resume from lead period: started_at ≈ nowMs + {$leadMs}ms"
    );
}

// ═══════════════════════════════════════════════════════════════════
// TEST 11: players() includes server_now_ms
// ═══════════════════════════════════════════════════════════════════
echo "\n── Test 11: players() response includes server_now_ms ──\n";
{
    [$session, $question, $correct, $wrong] = createTestSession();
    $controller = new \App\Http\Controllers\SessionController();

    $resp = json_decode($controller->players($session->pin)->getContent(), true);
    assert_true(isset($resp['server_now_ms']), 'players() has server_now_ms');
    assert_true($resp['server_now_ms'] > 1700000000000, 'server_now_ms is a valid epoch ms timestamp');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 12: reveal() does not reopen answering; config values
// ═══════════════════════════════════════════════════════════════════
echo "\n── Test 12: reveal() sets question_state to revealed; config values ──\n";
{
    [$session, $question, $correct, $wrong] = createTestSession();
    $controller = new \App\Http\Controllers\SessionController();

    $controller->start($session->pin);
    $controller->reveal($session->pin);
    $session->refresh();

    assert_eq('revealed', $session->question_state, 'After reveal: question_state is revealed');

    // Verify config values
    assert_eq(2000, config('quiz.sync_lead_ms'), 'config sync_lead_ms default is 2000');
    assert_eq(1000, config('quiz.answer_grace_ms'), 'config answer_grace_ms default is 1000');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 13: end() and reset() clear timing fields
// ═══════════════════════════════════════════════════════════════════
echo "\n── Test 13: end() and reset() clear timing fields ──\n";
{
    [$session, $question, $correct, $wrong] = createTestSession();
    $controller = new \App\Http\Controllers\SessionController();

    $controller->start($session->pin);
    $session->refresh();
    assert_true($session->question_started_at !== null, 'After start: started_at is set');

    $controller->end($session->pin);
    $session->refresh();
    assert_eq('completed', $session->status, 'After end: status is completed');
    assert_true($session->question_started_at === null, 'After end: question_started_at is null');
    assert_true($session->question_paused_remaining_ms === null, 'After end: paused_remaining_ms is null');

    // Reset
    $controller->reset($session->pin);
    $session->refresh();
    assert_eq('waiting', $session->status, 'After reset: status is waiting');
    assert_true($session->question_started_at === null, 'After reset: question_started_at is null');
    assert_eq(0, $session->current_question_index, 'After reset: current_question_index is 0');
}

// ═══════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════
echo "\n╔══════════════════════════════════════════════════════════════╗\n";
echo "║  RESULTS: {$passed} passed, {$failed} failed                            ║\n";
echo "╚══════════════════════════════════════════════════════════════╝\n";

if ($failed > 0) {
    echo "\nFailed tests:\n";
    foreach ($errors as $e) {
        echo "  • {$e}\n";
    }
    exit(1);
}

echo "\n🎉 All tests passed!\n";
exit(0);
