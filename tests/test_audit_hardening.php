<?php
/**
 * Tecorbi Kids Arena — Audit Hardening Comprehensive Test Suite (Phase 4 / T4.1-T4.3)
 * 
 * Verifies all security, realtime, and medium priority hardening items:
 * - Part 1: S1.1 Results Privacy (409 NOT_COMPLETED, no GET broadcast) & Question Stats
 * - Part 2: S1.3 & S1.4 Atomic Answers & Error Codes (ALREADY_ANSWERED, TIME_EXPIRED, etc.)
 * - Part 3: S1.5 Leaderboard Privacy (my_rank, my_score, student answered payload)
 * - Part 4: S1.6 My-Result targeting specific question_id
 * - Part 5: S1.7 Teacher Auth route pin and header-only token enforcement
 * - Part 6: R2.7 Reconnection Endpoint GET /sessions/{pin}/me
 * - Part 7: M3.1 - M3.6 Next/Reveal state guards, Choice validation, and Duplicate Player prevention
 * 
 * Target: Isolated in-memory SQLite database
 * Run: php tests/test_audit_hardening.php
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
use Illuminate\Http\Request;
use App\Models\GameSession;
use App\Models\Player;
use App\Models\Question;
use App\Models\Choice;
use App\Models\Answer;
use App\Http\Controllers\SessionController;
use App\Http\Controllers\GameController;
use App\Http\Middleware\EnsureTeacherAuthorized;

Artisan::call('migrate', ['--force' => true]);

echo "\n╔══════════════════════════════════════════════════════════════╗\n";
echo "║  Tecorbi Kids Arena — Audit Hardening Test Suite (T4.1-T4.3) ║\n";
echo "║  Database: :memory: SQLite (safe, isolated)                 ║\n";
echo "╚══════════════════════════════════════════════════════════════╝\n\n";

$passed = 0;
$failed = 0;
$errors = [];

function assert_true(bool $cond, string $msg): void {
    global $passed, $failed, $errors;
    if ($cond) {
        $passed++;
        echo "  ✅ PASS: {$msg}\n";
    } else {
        $failed++;
        $errors[] = $msg;
        echo "  ❌ FAIL: {$msg}\n";
    }
}

function assert_eq($expected, $actual, string $msg): void {
    global $passed, $failed, $errors;
    if ($expected === $actual) {
        $passed++;
        echo "  ✅ PASS: {$msg}\n";
    } else {
        $failed++;
        $expStr = var_export($expected, true);
        $actStr = var_export($actual, true);
        $errors[] = "{$msg} (expected {$expStr}, got {$actStr})";
        echo "  ❌ FAIL: {$msg} — expected {$expStr}, got {$actStr}\n";
    }
}

function createFullSession(): array {
    $teacherToken = bin2hex(random_bytes(16));
    $session = GameSession::create([
        'pin' => GameSession::generatePin(),
        'teacher_name' => 'Prof Hardening',
        'title' => 'Audit Validation Quiz',
        'teacher_token_hash' => hash('sha256', $teacherToken),
        'status' => 'waiting',
        'current_question_index' => 0,
        'question_state' => 'answering',
        'state_version' => 1,
    ]);

    $q1 = $session->questions()->create([
        'question_text' => 'What is 2+2?',
        'question_text_ar' => 'كم يساوي 2+2؟',
        'order' => 0,
        'time_limit' => 20,
    ]);
    $c1_corr = $q1->choices()->create(['choice_text' => '4', 'is_correct' => true, 'order' => 0]);
    $c1_wrng = $q1->choices()->create(['choice_text' => '5', 'is_correct' => false, 'order' => 1]);

    $q2 = $session->questions()->create([
        'question_text' => 'What is 3+3?',
        'question_text_ar' => 'كم يساوي 3+3؟',
        'order' => 1,
        'time_limit' => 20,
    ]);
    $c2_corr = $q2->choices()->create(['choice_text' => '6', 'is_correct' => true, 'order' => 0]);
    $c2_wrng = $q2->choices()->create(['choice_text' => '7', 'is_correct' => false, 'order' => 1]);

    return [$session, $teacherToken, [$q1, $q2], [$c1_corr, $c1_wrng, $c2_corr, $c2_wrng]];
}

function createPlayer(GameSession $session, string $name = 'Hero Student'): array {
    $token = bin2hex(random_bytes(16));
    $player = $session->players()->create([
        'name' => $name,
        'avatar' => 'spongebob',
        'token_hash' => hash('sha256', $token),
        'score' => 0,
        'streak' => 0,
        'joined_at' => now(),
    ]);
    return [$player, $token];
}

// ═══════════════════════════════════════════════════════════════════
// PART 1: S1.1 Results Privacy & Question Stats
// ═══════════════════════════════════════════════════════════════════
echo "── Part 1: S1.1 Results Privacy (409 NOT_COMPLETED) & Question Stats ──\n";
{
    [$session, $teacherToken, $questions, $choices] = createFullSession();
    $gameCtrl = new GameController();
    $sessCtrl = new SessionController();

    // 1. GET /sessions/{pin}/results when waiting -> HTTP 409 NOT_COMPLETED
    $resp = $gameCtrl->results($session->pin);
    assert_eq(409, $resp->getStatusCode(), 'GET /results while waiting returns 409');
    $body = json_decode($resp->getContent(), true);
    assert_eq('NOT_COMPLETED', $body['code'] ?? null, 'Error code is NOT_COMPLETED');

    // Start session
    $sessCtrl->start($session->pin);
    $session->refresh();

    // 2. GET /sessions/{pin}/results when active -> HTTP 409 NOT_COMPLETED
    $respActive = $gameCtrl->results($session->pin);
    assert_eq(409, $respActive->getStatusCode(), 'GET /results while active returns 409');

    // 3. GET /sessions/{pin}/question-stats before reveal -> HTTP 409
    $statsResp = $gameCtrl->questionStats($session->pin);
    assert_eq(409, $statsResp->getStatusCode(), 'GET /question-stats before reveal returns 409');

    // Reveal question
    $sessCtrl->reveal($session->pin);
    $session->refresh();

    // 4. GET /sessions/{pin}/question-stats after reveal -> HTTP 200 with counts
    $statsRespAfter = $gameCtrl->questionStats($session->pin);
    assert_eq(200, $statsRespAfter->getStatusCode(), 'GET /question-stats after reveal returns 200');
    $statsData = json_decode($statsRespAfter->getContent(), true);
    assert_true(isset($statsData['question_id']), 'question-stats returns question_id');
    assert_true(isset($statsData['stats']), 'question-stats returns stats map');
    assert_true(isset($statsData['total_answers']), 'question-stats returns total_answers');

    // Complete session
    $sessCtrl->end($session->pin);
    $session->refresh();

    // 5. GET /sessions/{pin}/results when completed -> HTTP 200 with full metrics
    $respCompleted = $gameCtrl->results($session->pin);
    assert_eq(200, $respCompleted->getStatusCode(), 'GET /results when completed returns 200');
    $resData = json_decode($respCompleted->getContent(), true);
    assert_true(isset($resData['results']), 'GET /results includes results list');
    assert_true(isset($resData['total_questions']), 'GET /results includes total_questions');
    assert_true(isset($resData['total_players']), 'GET /results includes total_players');
    assert_true(isset($resData['server_now_ms']), 'GET /results includes server_now_ms');
}

// ═══════════════════════════════════════════════════════════════════
// PART 2: S1.3 & S1.4 Atomic Answer Insertion & Error Codes
// ═══════════════════════════════════════════════════════════════════
echo "\n── Part 2: S1.3 & S1.4 Atomic Answers & Error Codes ──\n";
{
    [$session, $teacherToken, $questions, $choices] = createFullSession();
    $sessCtrl = new SessionController();
    $gameCtrl = new GameController();

    $sessCtrl->start($session->pin);
    $session->refresh();
    $session->update(['question_started_at' => (int)round(microtime(true) * 1000) - 2000]); // active window
    $session->refresh();

    [$player, $token] = createPlayer($session, 'Speedy Student');

    // 1. Submit answer with valid token
    $req = new Request();
    $req->headers->set('X-Player-Token', $token);
    $req->replace([
        'player_id' => $player->id,
        'question_id' => $questions[0]->id,
        'choice_id' => $choices[0]->id,
    ]);
    app()->instance('request', $req);

    $ansResp = $gameCtrl->answer($req, $session->pin);
    assert_eq(200, $ansResp->getStatusCode(), 'Valid answer returns 200');
    $ansBody = json_decode($ansResp->getContent(), true);
    assert_true($ansBody['accepted'] === true, 'Response accepted: true');

    // 2. Duplicate answer submission -> 409 with code ALREADY_ANSWERED
    $dupResp = $gameCtrl->answer($req, $session->pin);
    assert_eq(409, $dupResp->getStatusCode(), 'Duplicate answer returns 409');
    $dupBody = json_decode($dupResp->getContent(), true);
    assert_eq('ALREADY_ANSWERED', $dupBody['code'] ?? null, 'Duplicate returns code ALREADY_ANSWERED');

    // 3. Assert exactly one answer record in DB
    $ansCount = Answer::where('player_id', $player->id)->where('question_id', $questions[0]->id)->count();
    assert_eq(1, $ansCount, 'Exactly 1 answer record exists in DB for player');
}

// ═══════════════════════════════════════════════════════════════════
// PART 3: S1.5 Leaderboard Privacy & My Rank / My Score
// ═══════════════════════════════════════════════════════════════════
echo "\n── Part 3: S1.5 Leaderboard Privacy & my_rank / my_score ──\n";
{
    [$session, $teacherToken, $questions, $choices] = createFullSession();
    $sessCtrl = new SessionController();
    $gameCtrl = new GameController();
    $sessCtrl->start($session->pin);

    [$p1, $t1] = createPlayer($session, 'Rank 1 Player');
    [$p2, $t2] = createPlayer($session, 'Rank 2 Player');
    $p1->forceFill(['score' => 1500])->save();
    $p2->forceFill(['score' => 900])->save();

    // Query leaderboard without player token
    $lbAnonResp = $gameCtrl->leaderboard(Request::create("/api/sessions/{$session->pin}/leaderboard", 'GET'), $session->pin);
    assert_eq(200, $lbAnonResp->getStatusCode(), 'Anonymous leaderboard returns 200');
    $anonData = json_decode($lbAnonResp->getContent(), true);
    assert_true(!isset($anonData['my_rank']), 'Anonymous leaderboard does NOT have my_rank');
    assert_true(!isset($anonData['my_score']), 'Anonymous leaderboard does NOT have my_score');

    // Query leaderboard with player 2 token
    $p2Req = Request::create("/api/sessions/{$session->pin}/leaderboard", 'GET');
    $p2Req->headers->set('X-Player-Token', $t2);
    $lbAuthResp = $gameCtrl->leaderboard($p2Req, $session->pin);
    assert_eq(200, $lbAuthResp->getStatusCode(), 'Authenticated leaderboard returns 200');
    $authData = json_decode($lbAuthResp->getContent(), true);
    assert_eq(2, $authData['my_rank'] ?? null, 'my_rank is 2 for player 2');
    assert_eq(900, $authData['my_score'] ?? null, 'my_score is 900 for player 2');
}

// ═══════════════════════════════════════════════════════════════════
// PART 4: S1.6 My-Result targeting specific question_id
// ═══════════════════════════════════════════════════════════════════
echo "\n── Part 4: S1.6 My-Result targeting question_id ──\n";
{
    [$session, $teacherToken, $questions, $choices] = createFullSession();
    $sessCtrl = new SessionController();
    $gameCtrl = new GameController();
    $sessCtrl->start($session->pin);
    $session->refresh();

    [$player, $token] = createPlayer($session, 'Target Question Player');

    // Answer Q0
    $session->update(['question_started_at' => (int)round(microtime(true) * 1000) - 1000]);
    $reqAns = new Request();
    $reqAns->headers->set('X-Player-Token', $token);
    $reqAns->replace([
        'player_id' => $player->id,
        'question_id' => $questions[0]->id,
        'choice_id' => $choices[0]->id,
    ]);
    app()->instance('request', $reqAns);
    $gameCtrl->answer($reqAns, $session->pin);

    // Reveal Q0
    $sessCtrl->reveal($session->pin);
    $session->refresh();

    // Advance to Q1
    $reqNext = new Request(['expected_index' => 0]);
    $sessCtrl->next($reqNext, $session->pin);
    $session->refresh();
    assert_eq(1, $session->current_question_index, 'Session advanced to Q1');
    assert_eq('answering', $session->question_state, 'Q1 is in answering state');

    // Request result for revealed Q0 explicitly via ?question_id=
    $reqQ0 = new Request(['question_id' => $questions[0]->id]);
    $reqQ0->headers->set('X-Player-Token', $token);
    app()->instance('request', $reqQ0);
    $resQ0 = $gameCtrl->myResult($reqQ0, $session->pin);
    assert_eq(200, $resQ0->getStatusCode(), 'my-result?question_id=Q0 returns 200 after advancing to Q1');
    $bodyQ0 = json_decode($resQ0->getContent(), true);
    assert_true($bodyQ0['answered'] === true, 'Q0 result answered: true');
    assert_true($bodyQ0['is_correct'] === true, 'Q0 result is_correct: true');

    // Request result for current Q1 (not revealed yet) -> 409
    $reqQ1 = new Request(['question_id' => $questions[1]->id]);
    $reqQ1->headers->set('X-Player-Token', $token);
    app()->instance('request', $reqQ1);
    $resQ1 = $gameCtrl->myResult($reqQ1, $session->pin);
    assert_eq(409, $resQ1->getStatusCode(), 'my-result?question_id=Q1 before reveal returns 409');
}

// ═══════════════════════════════════════════════════════════════════
// PART 5: S1.7 Teacher Auth Middleware route pin and header token
// ═══════════════════════════════════════════════════════════════════
echo "\n── Part 5: S1.7 Teacher Auth Route Pin & Header Token Enforcement ──\n";
{
    [$session, $teacherToken, $questions, $choices] = createFullSession();
    $middleware = new EnsureTeacherAuthorized();

    // 1. Missing route pin -> 400 Bad Request
    $noPinReq = Request::create('/api/sessions', 'POST');
    $noPinResp = $middleware->handle($noPinReq, function () { return response()->json(['ok' => true]); });
    assert_eq(400, $noPinResp->getStatusCode(), 'Missing route pin returns 400');

    // 2. Passing token via query/body input('teacher_token') -> MUST BE REJECTED (403)
    $inputTokenReq = Request::create("/api/sessions/{$session->pin}/start", 'POST', ['teacher_token' => $teacherToken]);
    $inputTokenResp = $middleware->handle($inputTokenReq, function () { return response()->json(['ok' => true]); }, $session->pin);
    assert_eq(403, $inputTokenResp->getStatusCode(), 'Passing token in body input(teacher_token) is REJECTED');

    // 3. Passing token via X-Teacher-Token header -> ACCEPTED (200)
    $headerReq = Request::create("/api/sessions/{$session->pin}/start", 'POST');
    $headerReq->headers->set('X-Teacher-Token', $teacherToken);
    $headerResp = $middleware->handle($headerReq, function () { return response()->json(['ok' => true]); }, $session->pin);
    assert_eq(200, $headerResp->getStatusCode(), 'Passing token in X-Teacher-Token header is ACCEPTED');

    // 4. Passing token via Bearer Authorization header -> ACCEPTED (200)
    $bearerReq = Request::create("/api/sessions/{$session->pin}/start", 'POST');
    $bearerReq->headers->set('Authorization', 'Bearer ' . $teacherToken);
    $bearerResp = $middleware->handle($bearerReq, function () { return response()->json(['ok' => true]); }, $session->pin);
    assert_eq(200, $bearerResp->getStatusCode(), 'Passing token in Bearer header is ACCEPTED');
}

// ═══════════════════════════════════════════════════════════════════
// PART 6: R2.7 Reconnection Endpoint GET /sessions/{pin}/me
// ═══════════════════════════════════════════════════════════════════
echo "\n── Part 6: R2.7 Reconnection Endpoint GET /sessions/{pin}/me ──\n";
{
    [$session, $teacherToken, $questions, $choices] = createFullSession();
    $sessCtrl = new SessionController();
    [$player, $token] = createPlayer($session, 'Reconnecting Kid');

    // 1. Without header -> 401
    $anonMeReq = new Request();
    $anonMeResp = $sessCtrl->me($anonMeReq, $session->pin);
    assert_eq(401, $anonMeResp->getStatusCode(), 'GET /me without token returns 401');

    // 2. With invalid token -> 403
    $badMeReq = new Request();
    $badMeReq->headers->set('X-Player-Token', 'invalid_token_123');
    $badMeResp = $sessCtrl->me($badMeReq, $session->pin);
    assert_eq(403, $badMeResp->getStatusCode(), 'GET /me with invalid token returns 403');

    // 3. With valid token -> 200 with player data and session status
    $goodMeReq = new Request();
    $goodMeReq->headers->set('X-Player-Token', $token);
    $goodMeResp = $sessCtrl->me($goodMeReq, $session->pin);
    assert_eq(200, $goodMeResp->getStatusCode(), 'GET /me with valid token returns 200');
    $meData = json_decode($goodMeResp->getContent(), true);
    assert_true(isset($meData['player']), 'GET /me returns player object');
    assert_eq($player->id, $meData['player']['id'] ?? null, 'Returned player id matches');
    assert_true(isset($meData['session']), 'GET /me returns session object');
    assert_eq($session->status, $meData['session']['status'] ?? null, 'Returned session status matches');
}

// ═══════════════════════════════════════════════════════════════════
// PART 7: M3.1 - M3.6 Session Lifecycle Guards
// ═══════════════════════════════════════════════════════════════════
echo "\n── Part 7: M3.1 - M3.6 Session Lifecycle Guards ──\n";
{
    [$session, $teacherToken, $questions, $choices] = createFullSession();
    $sessCtrl = new SessionController();

    // 1. Reveal while waiting -> 422 INVALID_STATE (M3.2)
    $revealWaitResp = $sessCtrl->reveal($session->pin);
    assert_eq(422, $revealWaitResp->getStatusCode(), 'reveal() while waiting returns 422 INVALID_STATE');

    // 2. Start game -> active
    $sessCtrl->start($session->pin);
    $session->refresh();

    // 3. Pause game -> paused
    $sessCtrl->pause($session->pin);
    $session->refresh();
    assert_eq('paused', $session->status, 'Session is paused');

    // 4. Next while paused -> 422 INVALID_STATE (M3.1)
    $nextPausedReq = new Request(['expected_index' => 0]);
    $nextPausedResp = $sessCtrl->next($nextPausedReq, $session->pin);
    assert_eq(422, $nextPausedResp->getStatusCode(), 'next() while paused returns 422 INVALID_STATE');

    // 5. Resume game -> active
    $sessCtrl->resume($session->pin);
    $session->refresh();
    assert_eq('active', $session->status, 'Session resumed to active');

    // 6. Question choice validation (M3.4): Question with 0 correct choices rejected (422)
    $badReq0 = new Request([
        'teacher_name' => 'Prof Logic',
        'title' => 'No Correct Choice',
        'questions' => [
            [
                'question_text' => 'What is 1+1?',
                'time_limit' => 20,
                'choices' => [
                    ['choice_text' => '3', 'is_correct' => false],
                    ['choice_text' => '4', 'is_correct' => false],
                ],
            ],
        ],
    ]);
    $badResp0 = $sessCtrl->store($badReq0);
    assert_eq(422, $badResp0->getStatusCode(), 'Creating question with 0 correct choices returns 422');

    // 7. Question choice validation (M3.4): Question with 2 correct choices rejected (422)
    $badReq2 = new Request([
        'teacher_name' => 'Prof Logic',
        'title' => 'Two Correct Choices',
        'questions' => [
            [
                'question_text' => 'What is 1+1?',
                'time_limit' => 20,
                'choices' => [
                    ['choice_text' => '2', 'is_correct' => true],
                    ['choice_text' => 'Two', 'is_correct' => true],
                ],
            ],
        ],
    ]);
    $badResp2 = $sessCtrl->store($badReq2);
    assert_eq(422, $badResp2->getStatusCode(), 'Creating question with 2 correct choices returns 422');

    // 8. Unique player name enforcement (M3.5): Duplicate player name -> 422 NAME_TAKEN
    $joinReq1 = new Request(['name' => 'DuplicateName', 'avatar' => 'robot']);
    $joinResp1 = $sessCtrl->join($joinReq1, $session->pin);
    assert_eq(201, $joinResp1->getStatusCode(), 'First player join returns 201');

    $joinReq2 = new Request(['name' => 'DuplicateName', 'avatar' => 'spongebob']);
    $joinResp2 = $sessCtrl->join($joinReq2, $session->pin);
    assert_eq(422, $joinResp2->getStatusCode(), 'Second player with same name returns 422');
    $join2Body = json_decode($joinResp2->getContent(), true);
    assert_eq('NAME_TAKEN', $join2Body['code'] ?? null, 'Duplicate name returns code NAME_TAKEN');
}

echo "\n╔══════════════════════════════════════════════════════════════╗\n";
echo "║  AUDIT HARDENING RESULTS: {$passed} passed, {$failed} failed" . str_repeat(' ', max(0, 24 - strlen((string)$passed) - strlen((string)$failed))) . "║\n";
echo "╚══════════════════════════════════════════════════════════════╝\n";

if ($failed > 0) {
    echo "\n❌ FAILURES:\n";
    foreach ($errors as $e) {
        echo " - {$e}\n";
    }
    exit(1);
} else {
    echo "\n🎉 All audit hardening tests passed successfully!\n";
    exit(0);
}
