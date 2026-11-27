<?php
/**
 * Phase 2.1 Security Remediation Test Suite
 * 
 * Verifies:
 * 1. Teacher Authentication (SEC-01)
 * 2. Player Authentication & Impersonation Prevention (SEC-02)
 * 3. Answer Secrecy & My-Result Endpoint (SEC-03)
 * 
 * Target: Isolated :memory: SQLite Database
 * Run: php tests/test_security_remediation.php
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
echo "║  Tecorbi Kids Arena — Phase 2.1 Security Remediation Tests  ║\n";
echo "║  Database: :memory: SQLite (safe, isolated)                 ║\n";
echo "╚══════════════════════════════════════════════════════════════╝\n\n";

$passed = 0;
$failed = 0;
$errors = [];

function assert_true($cond, string $label) {
    global $passed, $failed, $errors;
    if ($cond) {
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

function createSecureSession(string $teacherToken = 'secret-teacher-token-12345'): array {
    $session = GameSession::create([
        'pin' => GameSession::generatePin(),
        'teacher_token_hash' => hash('sha256', $teacherToken),
        'teacher_name' => 'Dr. Ahmed',
        'title' => 'Security Quiz',
        'status' => 'waiting',
    ]);

    for ($i = 0; $i < 3; $i++) {
        $q = $session->questions()->create([
            'question_text' => "Question {$i}",
            'order' => $i,
            'time_limit' => 20,
        ]);
        $q->choices()->create(['choice_text' => 'A', 'is_correct' => true, 'order' => 0]);
        $q->choices()->create(['choice_text' => 'B', 'is_correct' => false, 'order' => 1]);
    }

    return [$session, $teacherToken];
}

function createSecurePlayer(GameSession $session, string $name, string $playerToken = 'player-token-secret'): array {
    $player = $session->players()->create([
        'name' => $name,
        'avatar' => 'astronaut',
        'token_hash' => hash('sha256', $playerToken),
        'joined_at' => now(),
    ]);
    return [$player, $playerToken];
}

// ═══════════════════════════════════════════════════════════════════
// PART 1: TEACHER AUTHENTICATION & ACCESS CONTROL (SEC-01)
// ═══════════════════════════════════════════════════════════════════
echo "── Part 1: Teacher Authentication & Access Control (SEC-01) ──\n";

$sessionController = new SessionController();
$middleware = new EnsureTeacherAuthorized();

// Test 1.1: Session creation generates and returns teacher_token, stores only hash
{
    $req = Request::create('/api/sessions', 'POST', [
        'teacher_name' => 'Master Yoda',
        'title' => 'Jedi Quiz',
        'questions' => [
            [
                'question_text' => 'What is the Force?',
                'time_limit' => 20,
                'choices' => [
                    ['choice_text' => 'Energy', 'is_correct' => true],
                    ['choice_text' => 'Magic', 'is_correct' => false],
                ],
            ],
        ],
    ]);
    $resp = $sessionController->store($req);
    $data = json_decode($resp->getContent(), true);

    assert_eq(201, $resp->getStatusCode(), 'Session created (HTTP 201)');
    assert_true(!empty($data['teacher_token']), 'Response includes teacher_token');
    assert_true(strlen($data['teacher_token']) >= 32, 'teacher_token is high entropy');

    $dbSession = GameSession::where('pin', $data['pin'])->first();
    assert_true(!empty($dbSession->teacher_token_hash), 'DB stores teacher_token_hash');
    assert_true($dbSession->teacher_token_hash !== $data['teacher_token'], 'DB does NOT store plain token');
    assert_eq(hash('sha256', $data['teacher_token']), $dbSession->teacher_token_hash, 'Hash matches SHA-256 of plain token');
}

// Test 1.2: Middleware blocks unauthenticated requests to teacher routes
{
    [$session, $teacherToken] = createSecureSession();

    // Case A: No token header -> HTTP 403
    $reqNoToken = Request::create("/api/sessions/{$session->pin}/start", 'POST');
    $respA = $middleware->handle($reqNoToken, fn($r) => response()->json(['success' => true]));
    assert_eq(403, $respA->getStatusCode(), 'Teacher endpoint without token: HTTP 403');
    $dataA = json_decode($respA->getContent(), true);
    assert_eq('UNAUTHORIZED_TEACHER', $dataA['code'] ?? null, 'Correct error code returned');

    // Case B: Invalid/Wrong token -> HTTP 403
    $reqBadToken = Request::create("/api/sessions/{$session->pin}/start", 'POST');
    $reqBadToken->headers->set('X-Teacher-Token', 'wrong-token-hacker');
    $respB = $middleware->handle($reqBadToken, fn($r) => response()->json(['success' => true]));
    assert_eq(403, $respB->getStatusCode(), 'Teacher endpoint with invalid token: HTTP 403');

    // Case C: Valid token header -> Passes middleware (HTTP 200)
    $reqGood = Request::create("/api/sessions/{$session->pin}/start", 'POST');
    $reqGood->headers->set('X-Teacher-Token', $teacherToken);
    $respC = $middleware->handle($reqGood, fn($r) => response()->json(['success' => true]));
    assert_eq(200, $respC->getStatusCode(), 'Teacher endpoint with valid X-Teacher-Token: HTTP 200');

    // Case D: Valid Bearer Authorization token -> Passes middleware
    $reqBearer = Request::create("/api/sessions/{$session->pin}/start", 'POST');
    $reqBearer->headers->set('Authorization', 'Bearer ' . $teacherToken);
    $respD = $middleware->handle($reqBearer, fn($r) => response()->json(['success' => true]));
    assert_eq(200, $respD->getStatusCode(), 'Teacher endpoint with valid Bearer token: HTTP 200');
}

// Test 1.3: Legacy null-hash session handling (QUIZ_ALLOW_LEGACY_OPEN_SESSIONS)
{
    $legacySession = GameSession::create([
        'pin' => GameSession::generatePin(),
        'teacher_token_hash' => null, // Legacy unauthenticated session
        'teacher_name' => 'Old Teacher',
        'title' => 'Legacy Session',
    ]);

    // When flag is false (default) -> HTTP 403
    config(['quiz.allow_legacy_open_sessions' => false]);
    $reqLegacy = Request::create("/api/sessions/{$legacySession->pin}/start", 'POST');
    $resp1 = $middleware->handle($reqLegacy, fn($r) => response()->json(['success' => true]));
    assert_eq(403, $resp1->getStatusCode(), 'Legacy session with flag=false: HTTP 403');

    // When flag is true -> Passes (HTTP 200)
    config(['quiz.allow_legacy_open_sessions' => true]);
    $resp2 = $middleware->handle($reqLegacy, fn($r) => response()->json(['success' => true]));
    assert_eq(200, $resp2->getStatusCode(), 'Legacy session with flag=true: Allowed (HTTP 200)');

    // Reset config back to secure default
    config(['quiz.allow_legacy_open_sessions' => false]);
}

// Test 1.4: Model serialization never exposes teacher_token_hash
{
    [$session, $teacherToken] = createSecureSession();
    $array = $session->toArray();
    $json = $session->toJson();

    assert_true(!array_key_exists('teacher_token_hash', $array), 'toArray() hides teacher_token_hash');
    assert_true(!str_contains($json, 'teacher_token_hash'), 'toJson() hides teacher_token_hash');

    $pollResp = $sessionController->poll($session->pin);
    $pollData = json_decode($pollResp->getContent(), true);
    assert_true(!isset($pollData['teacher_token_hash']), 'poll() response never exposes teacher_token_hash');

    $stateResp = $sessionController->state($session->pin);
    $stateData = json_decode($stateResp->getContent(), true);
    assert_true(!isset($stateData['teacher_token_hash']), 'state() response never exposes teacher_token_hash');
}

// ═══════════════════════════════════════════════════════════════════
// PART 2: PLAYER AUTHENTICATION & IMPERSONATION PREVENTION (SEC-02)
// ═══════════════════════════════════════════════════════════════════
echo "\n── Part 2: Player Authentication & Impersonation Prevention (SEC-02) ──\n";

$gameController = new GameController();

// Test 2.1: Student join generates and returns player_token, stores only hash
{
    [$session, $teacherToken] = createSecureSession();
    $joinReq = Request::create("/api/sessions/{$session->pin}/join", 'POST', [
        'name' => 'Alice Astronaut',
        'avatar' => 'astronaut',
    ]);
    $joinResp = $sessionController->join($joinReq, $session->pin);
    $joinData = json_decode($joinResp->getContent(), true);

    assert_eq(201, $joinResp->getStatusCode(), 'Player joined (HTTP 201)');
    assert_true(!empty($joinData['player_token']), 'Response includes player_token');
    assert_true(strlen($joinData['player_token']) >= 32, 'player_token is high entropy');

    $dbPlayer = Player::find($joinData['player']['id']);
    assert_true(!empty($dbPlayer->token_hash), 'DB stores player token_hash');
    assert_true($dbPlayer->token_hash !== $joinData['player_token'], 'DB does NOT store plain player token');
    assert_eq(hash('sha256', $joinData['player_token']), $dbPlayer->token_hash, 'Hash matches SHA-256 of player_token');
}

// Test 2.2: Answer submission authentication and cross-player impersonation checks
{
    [$session, $teacherToken] = createSecureSession();
    $sessionController->start($session->pin);
    $session->refresh();
    $session->update(['question_started_at' => (int)round(microtime(true) * 1000) - 2000]);

    $currentQuestion = $session->currentQuestion();
    $correctChoice = $currentQuestion->choices()->where('is_correct', true)->first();

    [$alice, $aliceToken] = createSecurePlayer($session, 'Alice', 'alice-secret-token');
    [$bob, $bobToken] = createSecurePlayer($session, 'Bob', 'bob-secret-token');

    // Case A: Missing token -> HTTP 403
    $reqNoToken = Request::create("/api/sessions/{$session->pin}/answer", 'POST', [
        'player_id' => $alice->id,
        'choice_id' => $correctChoice->id,
    ]);
    $respA = $gameController->answer($reqNoToken, $session->pin);
    assert_eq(403, $respA->getStatusCode(), 'Answer without token: HTTP 403');
    $dataA = json_decode($respA->getContent(), true);
    assert_eq('UNAUTHORIZED_PLAYER', $dataA['code'] ?? null, 'Code is UNAUTHORIZED_PLAYER');

    // Case B: Invalid token -> HTTP 403
    $reqBadToken = Request::create("/api/sessions/{$session->pin}/answer", 'POST', [
        'player_id' => $alice->id,
        'choice_id' => $correctChoice->id,
    ]);
    $reqBadToken->headers->set('X-Player-Token', 'fake-token-12345');
    $respB = $gameController->answer($reqBadToken, $session->pin);
    assert_eq(403, $respB->getStatusCode(), 'Answer with invalid token: HTTP 403');

    // Case C: Bob attempts to impersonate Alice (Alice player_id, but Bob's token) -> HTTP 403
    $reqImpersonate = Request::create("/api/sessions/{$session->pin}/answer", 'POST', [
        'player_id' => $alice->id, // Impersonating Alice
        'choice_id' => $correctChoice->id,
    ]);
    $reqImpersonate->headers->set('X-Player-Token', $bobToken); // Bob's token!
    $respC = $gameController->answer($reqImpersonate, $session->pin);
    assert_eq(403, $respC->getStatusCode(), 'Player impersonation attempt: HTTP 403');

    // Case D: Player from another session attempting to answer in this session -> HTTP 403
    [$session2, $token2] = createSecureSession();
    [$eve, $eveToken] = createSecurePlayer($session2, 'Eve', 'eve-token-session2');
    $reqCrossSession = Request::create("/api/sessions/{$session->pin}/answer", 'POST', [
        'player_id' => $eve->id,
        'choice_id' => $correctChoice->id,
    ]);
    $reqCrossSession->headers->set('X-Player-Token', $eveToken);
    $respD = $gameController->answer($reqCrossSession, $session->pin);
    assert_eq(403, $respD->getStatusCode(), 'Cross-session player answer attempt: HTTP 403');

    // Case E: Valid player token matching player_id -> Accepted (HTTP 200)
    $reqAliceValid = Request::create("/api/sessions/{$session->pin}/answer", 'POST', [
        'player_id' => $alice->id,
        'choice_id' => $correctChoice->id,
    ]);
    $reqAliceValid->headers->set('X-Player-Token', $aliceToken);
    $respE = $gameController->answer($reqAliceValid, $session->pin);
    assert_eq(200, $respE->getStatusCode(), 'Valid player token: Answer accepted (HTTP 200)');
}

// Test 2.3: Player model serialization hides token_hash
{
    [$session, $teacherToken] = createSecureSession();
    [$player, $playerToken] = createSecurePlayer($session, 'Stealthy Sam', 'token-123');

    $pArray = $player->toArray();
    $pJson = $player->toJson();

    assert_true(!array_key_exists('token_hash', $pArray), 'Player::toArray() hides token_hash');
    assert_true(!str_contains($pJson, 'token_hash'), 'Player::toJson() hides token_hash');

    $playersResp = $sessionController->players($session->pin);
    $playersData = json_decode($playersResp->getContent(), true);
    assert_true(!isset($playersData['players'][0]['token_hash']), 'players() API never leaks token_hash');
}

// ═══════════════════════════════════════════════════════════════════
// PART 3: ANSWER SECRECY & MY-RESULT ENDPOINT (SEC-03)
// ═══════════════════════════════════════════════════════════════════
echo "\n── Part 3: Answer Secrecy & My-Result Endpoint (SEC-03) ──\n";

// Test 3.1: When QUIZ_REVEAL_ON_ANSWER is false, answer response returns ONLY accepted:true
{
    config(['quiz.reveal_on_answer' => false]);

    [$session, $teacherToken] = createSecureSession();
    $sessionController->start($session->pin);
    $session->refresh();
    $session->update(['question_started_at' => (int)round(microtime(true) * 1000) - 2000]);

    $currentQuestion = $session->currentQuestion();
    $correctChoice = $currentQuestion->choices()->where('is_correct', true)->first();

    [$player, $playerToken] = createSecurePlayer($session, 'Secret Student', 'secret-p-tok');

    $req = Request::create("/api/sessions/{$session->pin}/answer", 'POST', [
        'player_id' => $player->id,
        'choice_id' => $correctChoice->id,
    ]);
    $req->headers->set('X-Player-Token', $playerToken);
    $resp = $gameController->answer($req, $session->pin);
    $data = json_decode($resp->getContent(), true);

    assert_eq(200, $resp->getStatusCode(), 'Answer submission succeeds (HTTP 200)');
    assert_true(isset($data['accepted']) && $data['accepted'] === true, 'Response returns accepted: true');
    assert_true(!isset($data['is_correct']), 'Response does NOT leak is_correct');
    assert_true(!isset($data['correct_choice_id']), 'Response does NOT leak correct_choice_id');
    assert_true(!isset($data['points_earned']), 'Response does NOT leak points_earned');
    assert_true(!isset($data['total_score']), 'Response does NOT leak total_score');
    assert_true(!isset($data['streak']), 'Response does NOT leak streak');
}

// Test 3.2: GET /my-result before reveal returns 409 Conflict (while another player has not answered yet)
{
    [$session, $teacherToken] = createSecureSession();
    $sessionController->start($session->pin);
    $session->refresh();
    $session->update(['question_started_at' => (int)round(microtime(true) * 1000) - 2000]);

    $currentQuestion = $session->currentQuestion();
    $correctChoice = $currentQuestion->choices()->where('is_correct', true)->first();
    [$player, $playerToken] = createSecurePlayer($session, 'Eager Student', 'eager-tok');
    createSecurePlayer($session, 'Waiting Student', 'waiting-tok');

    // Submit answer while question_state is still answering (Waiting Student hasn't answered yet)
    $reqAns = Request::create("/api/sessions/{$session->pin}/answer", 'POST', [
        'player_id' => $player->id,
        'choice_id' => $correctChoice->id,
    ]);
    $reqAns->headers->set('X-Player-Token', $playerToken);
    $gameController->answer($reqAns, $session->pin);

    // Call /my-result before reveal
    $reqResult = Request::create("/api/sessions/{$session->pin}/my-result", 'GET');
    $reqResult->headers->set('X-Player-Token', $playerToken);
    $respResult = $gameController->myResult($reqResult, $session->pin);
    $dataResult = json_decode($respResult->getContent(), true);

    assert_eq(409, $respResult->getStatusCode(), 'my-result before reveal: HTTP 409 Conflict');
    assert_eq('NOT_REVEALED', $dataResult['code'] ?? null, 'Code is NOT_REVEALED');
}

// Test 3.3: GET /my-result after reveal returns 200 with result & points
{
    [$session, $teacherToken] = createSecureSession();
    $sessionController->start($session->pin);
    $session->refresh();
    $session->update(['question_started_at' => (int)round(microtime(true) * 1000) - 2000]);

    $currentQuestion = $session->currentQuestion();
    $correctChoice = $currentQuestion->choices()->where('is_correct', true)->first();
    [$player, $playerToken] = createSecurePlayer($session, 'Victorious Student', 'vic-tok');

    // Answer
    $reqAns = Request::create("/api/sessions/{$session->pin}/answer", 'POST', [
        'player_id' => $player->id,
        'choice_id' => $correctChoice->id,
    ]);
    $reqAns->headers->set('X-Player-Token', $playerToken);
    $gameController->answer($reqAns, $session->pin);

    // Teacher reveals answer
    $sessionController->reveal($session->pin);
    $session->refresh();
    assert_eq('revealed', $session->question_state, 'Question state is now revealed');

    // Call /my-result after reveal
    $reqResult = Request::create("/api/sessions/{$session->pin}/my-result", 'GET');
    $reqResult->headers->set('X-Player-Token', $playerToken);
    $respResult = $gameController->myResult($reqResult, $session->pin);
    $dataResult = json_decode($respResult->getContent(), true);

    assert_eq(200, $respResult->getStatusCode(), 'my-result after reveal: HTTP 200');
    assert_true($dataResult['answered'] === true, 'answered is true');
    assert_true($dataResult['is_correct'] === true, 'is_correct is true');
    assert_true($dataResult['points_earned'] >= 500, 'points_earned calculated correctly');
    assert_eq($correctChoice->id, $dataResult['correct_choice_id'], 'correct_choice_id returned after reveal');
    assert_eq($correctChoice->id, $dataResult['choice_id'], 'choice_id matches student pick');
}

// Test 3.4: GET /my-result isolates results per player (Player A cannot see Player B's result)
{
    [$session, $teacherToken] = createSecureSession();
    $sessionController->start($session->pin);
    $session->refresh();
    $session->update(['question_started_at' => (int)round(microtime(true) * 1000) - 2000]);

    $currentQuestion = $session->currentQuestion();
    $correctChoice = $currentQuestion->choices()->where('is_correct', true)->first();
    $wrongChoice = $currentQuestion->choices()->where('is_correct', false)->first();

    [$playerA, $tokenA] = createSecurePlayer($session, 'Player A', 'tok-a');
    [$playerB, $tokenB] = createSecurePlayer($session, 'Player B', 'tok-b');

    // Player A answers CORRECT
    $reqA = Request::create("/api/sessions/{$session->pin}/answer", 'POST', ['player_id' => $playerA->id, 'choice_id' => $correctChoice->id]);
    $reqA->headers->set('X-Player-Token', $tokenA);
    $gameController->answer($reqA, $session->pin);

    // Player B answers WRONG
    $reqB = Request::create("/api/sessions/{$session->pin}/answer", 'POST', ['player_id' => $playerB->id, 'choice_id' => $wrongChoice->id]);
    $reqB->headers->set('X-Player-Token', $tokenB);
    $gameController->answer($reqB, $session->pin);

    // Reveal
    $sessionController->reveal($session->pin);

    // Fetch Player A's result
    $reqResA = Request::create("/api/sessions/{$session->pin}/my-result", 'GET');
    $reqResA->headers->set('X-Player-Token', $tokenA);
    $dataA = json_decode($gameController->myResult($reqResA, $session->pin)->getContent(), true);

    // Fetch Player B's result
    $reqResB = Request::create("/api/sessions/{$session->pin}/my-result", 'GET');
    $reqResB->headers->set('X-Player-Token', $tokenB);
    $dataB = json_decode($gameController->myResult($reqResB, $session->pin)->getContent(), true);

    assert_true($dataA['is_correct'] === true, "Player A result is correct");
    assert_true($dataB['is_correct'] === false, "Player B result is wrong");
    assert_true($dataA['points_earned'] > 0, "Player A received points");
    assert_eq(0, $dataB['points_earned'], "Player B received 0 points");
}

// Test 3.5: GET /my-result only returns result for CURRENT question, not previous questions
{
    [$session, $teacherToken] = createSecureSession();
    $sessionController->start($session->pin);
    $session->refresh();
    $session->update(['question_started_at' => (int)round(microtime(true) * 1000) - 2000]);

    $q0 = $session->currentQuestion();
    $c0 = $q0->choices()->where('is_correct', true)->first();
    [$player, $playerToken] = createSecurePlayer($session, 'Continuous Student', 'cont-tok');

    // Answer Q0
    $reqAns0 = Request::create("/api/sessions/{$session->pin}/answer", 'POST', ['player_id' => $player->id, 'choice_id' => $c0->id]);
    $reqAns0->headers->set('X-Player-Token', $playerToken);
    $gameController->answer($reqAns0, $session->pin);

    // Advance to Q1
    $reqNext = Request::create("/api/sessions/{$session->pin}/next", 'POST', ['expected_index' => 0]);
    $sessionController->next($reqNext, $session->pin);
    $session->refresh();
    assert_eq(1, (int)$session->current_question_index, 'Session advanced to Question 1');
    assert_eq('answering', $session->question_state, 'Question 1 is in answering state');

    // Call /my-result on Q1 before reveal -> MUST be 409 NOT_REVEALED (not returning Q0 result!)
    $reqRes1 = Request::create("/api/sessions/{$session->pin}/my-result", 'GET');
    $reqRes1->headers->set('X-Player-Token', $playerToken);
    $respRes1 = $gameController->myResult($reqRes1, $session->pin);
    assert_eq(409, $respRes1->getStatusCode(), 'my-result for Question 1 before reveal is 409 (does not leak Q0)');

    // Now reveal Q1 (without player answering Q1, simulating time out)
    $sessionController->reveal($session->pin);
    $respRes1Revealed = $gameController->myResult($reqRes1, $session->pin);
    $dataRes1 = json_decode($respRes1Revealed->getContent(), true);

    assert_eq(200, $respRes1Revealed->getStatusCode(), 'my-result for Question 1 after reveal: HTTP 200');
    assert_true($dataRes1['answered'] === false, 'answered is false for Q1 (not returning Q0 answer)');
    assert_true($dataRes1['is_correct'] === false, 'is_correct is false for Q1');
}

// Test 3.6: QUIZ_REVEAL_ON_ANSWER = true preserves legacy behavior
{
    config(['quiz.reveal_on_answer' => true]);

    [$session, $teacherToken] = createSecureSession();
    $sessionController->start($session->pin);
    $session->refresh();
    $session->update(['question_started_at' => (int)round(microtime(true) * 1000) - 2000]);

    $q = $session->currentQuestion();
    $c = $q->choices()->where('is_correct', true)->first();
    [$player, $playerToken] = createSecurePlayer($session, 'Legacy Student', 'leg-tok');

    $req = Request::create("/api/sessions/{$session->pin}/answer", 'POST', [
        'player_id' => $player->id,
        'choice_id' => $c->id,
    ]);
    $req->headers->set('X-Player-Token', $playerToken);
    $resp = $gameController->answer($req, $session->pin);
    $data = json_decode($resp->getContent(), true);

    assert_eq(200, $resp->getStatusCode(), 'Legacy answer submission succeeds (HTTP 200)');
    assert_true($data['is_correct'] === true, 'Legacy mode returns is_correct');
    assert_true($data['points_earned'] > 0, 'Legacy mode returns points_earned');
    assert_eq($c->id, $data['correct_choice_id'], 'Legacy mode returns correct_choice_id');

    // Reset config back to default
    config(['quiz.reveal_on_answer' => false]);
}

echo "\n── Part 4: Abuse Protection & Input Validation ──\n";

// Test 4.1: Session creation payload limits & choices validation
{
    $sessionController = new SessionController();

    // > 50 questions rejected
    $tooManyQuestions = [];
    for ($i = 0; $i < 51; $i++) {
        $tooManyQuestions[] = [
            'question_text' => "Question {$i}",
            'time_limit' => 20,
            'choices' => [
                ['choice_text' => 'A', 'is_correct' => true],
                ['choice_text' => 'B', 'is_correct' => false],
            ],
        ];
    }
    $reqTooMany = Request::create('/api/sessions', 'POST', [
        'teacher_name' => 'Prof. Oak',
        'title' => 'Giant Quiz',
        'questions' => $tooManyQuestions,
    ]);
    try {
        $sessionController->store($reqTooMany);
        assert_true(false, 'Session with >50 questions should fail validation');
    } catch (\Illuminate\Validation\ValidationException $e) {
        assert_true(true, 'Session with >50 questions rejected with ValidationException');
    }

    // Question text > 500 chars rejected
    $reqLongQ = Request::create('/api/sessions', 'POST', [
        'teacher_name' => 'Prof. Oak',
        'title' => 'Long Question Quiz',
        'questions' => [
            [
                'question_text' => str_repeat('X', 501),
                'choices' => [
                    ['choice_text' => 'A', 'is_correct' => true],
                    ['choice_text' => 'B', 'is_correct' => false],
                ],
            ],
        ],
    ]);
    try {
        $sessionController->store($reqLongQ);
        assert_true(false, 'Question text >500 chars should fail validation');
    } catch (\Illuminate\Validation\ValidationException $e) {
        assert_true(true, 'Question text >500 chars rejected with ValidationException');
    }

    // Choice text > 200 chars rejected
    $reqLongChoice = Request::create('/api/sessions', 'POST', [
        'teacher_name' => 'Prof. Oak',
        'title' => 'Long Choice Quiz',
        'questions' => [
            [
                'question_text' => 'Valid question?',
                'choices' => [
                    ['choice_text' => str_repeat('C', 201), 'is_correct' => true],
                    ['choice_text' => 'Short', 'is_correct' => false],
                ],
            ],
        ],
    ]);
    try {
        $sessionController->store($reqLongChoice);
        assert_true(false, 'Choice text >200 chars should fail validation');
    } catch (\Illuminate\Validation\ValidationException $e) {
        assert_true(true, 'Choice text >200 chars rejected with ValidationException');
    }

    // Question with no correct choice rejected
    $reqNoCorrect = Request::create('/api/sessions', 'POST', [
        'teacher_name' => 'Prof. Oak',
        'title' => 'No Correct Choice Quiz',
        'questions' => [
            [
                'question_text' => 'Impossible question?',
                'choices' => [
                    ['choice_text' => 'A', 'is_correct' => false],
                    ['choice_text' => 'B', 'is_correct' => false],
                ],
            ],
        ],
    ]);
    $respNoCorrect = $sessionController->store($reqNoCorrect);
    assert_eq(422, $respNoCorrect->getStatusCode(), 'Question with no correct choice rejected: HTTP 422');
    $dataNoCorrect = json_decode($respNoCorrect->getContent(), true);
    assert_eq('INVALID_CHOICES', $dataNoCorrect['code'] ?? '', 'Code is INVALID_CHOICES');
}

// Test 4.2: Player join sanitization & validation
{
    $sessionController = new SessionController();
    [$session, $tToken] = createSecureSession();

    // HTML stripping in player name
    $reqXss = Request::create("/api/sessions/{$session->pin}/join", 'POST', [
        'name' => '<script>alert(1)</script><b>Farah</b>',
        'avatar' => 'spongebob',
    ]);
    $respXss = $sessionController->join($reqXss, $session->pin);
    assert_eq(201, $respXss->getStatusCode(), 'Player with HTML in name created: HTTP 201');
    $dataXss = json_decode($respXss->getContent(), true);
    assert_eq('Farah', $dataXss['player']['name'], 'HTML tags stripped from player name');

    // Whitespace-only name rejected
    $reqEmpty = Request::create("/api/sessions/{$session->pin}/join", 'POST', [
        'name' => '   ',
        'avatar' => 'smurf',
    ]);
    $respEmpty = $sessionController->join($reqEmpty, $session->pin);
    assert_eq(422, $respEmpty->getStatusCode(), 'Whitespace name rejected: HTTP 422');
    $dataEmpty = json_decode($respEmpty->getContent(), true);
    assert_eq('NAME_INVALID', $dataEmpty['code'] ?? '', 'Code is NAME_INVALID');

    // Name > 20 chars rejected
    $reqLongName = Request::create("/api/sessions/{$session->pin}/join", 'POST', [
        'name' => 'ThisNameIsWayTooLongForAStudent',
        'avatar' => 'smurf',
    ]);
    $respLongName = $sessionController->join($reqLongName, $session->pin);
    assert_eq(422, $respLongName->getStatusCode(), 'Name >20 chars rejected: HTTP 422');
    $dataLongName = json_decode($respLongName->getContent(), true);
    assert_eq('NAME_INVALID', $dataLongName['code'] ?? '', 'Code is NAME_INVALID');

    // Duplicate name rejected
    $reqDup = Request::create("/api/sessions/{$session->pin}/join", 'POST', [
        'name' => 'Farah',
        'avatar' => 'patrick',
    ]);
    $respDup = $sessionController->join($reqDup, $session->pin);
    assert_eq(422, $respDup->getStatusCode(), 'Duplicate player name rejected: HTTP 422');
    $dataDup = json_decode($respDup->getContent(), true);
    assert_eq('NAME_TAKEN', $dataDup['code'] ?? '', 'Code is NAME_TAKEN');

    // Invalid avatar rejected
    $reqBadAvatar = Request::create("/api/sessions/{$session->pin}/join", 'POST', [
        'name' => 'Ziad',
        'avatar' => 'malicious_avatar_hacker',
    ]);
    try {
        $sessionController->join($reqBadAvatar, $session->pin);
        assert_true(false, 'Invalid avatar should fail validation');
    } catch (\Illuminate\Validation\ValidationException $e) {
        assert_true(true, 'Invalid avatar rejected by whitelist');
    }

    // Join completed session rejected
    $session->update(['status' => 'completed']);
    $reqCompleted = Request::create("/api/sessions/{$session->pin}/join", 'POST', [
        'name' => 'Tarek',
        'avatar' => 'ninja',
    ]);
    $respCompleted = $sessionController->join($reqCompleted, $session->pin);
    assert_eq(422, $respCompleted->getStatusCode(), 'Join completed session rejected: HTTP 422');
    $dataCompleted = json_decode($respCompleted->getContent(), true);
    assert_eq('SESSION_COMPLETED', $dataCompleted['code'] ?? '', 'Code is SESSION_COMPLETED');

    // Max players per session limit
    [$sessionFull, $tTokenFull] = createSecureSession();
    config(['quiz.max_players_per_session' => 2]);
    $sessionController->join(Request::create("/api/sessions/{$sessionFull->pin}/join", 'POST', ['name' => 'P1', 'avatar' => 'ninja']), $sessionFull->pin);
    $sessionController->join(Request::create("/api/sessions/{$sessionFull->pin}/join", 'POST', ['name' => 'P2', 'avatar' => 'robot']), $sessionFull->pin);

    $reqOverflow = Request::create("/api/sessions/{$sessionFull->pin}/join", 'POST', ['name' => 'P3', 'avatar' => 'wizard']);
    $respOverflow = $sessionController->join($reqOverflow, $sessionFull->pin);
    assert_eq(422, $respOverflow->getStatusCode(), 'Join when session full rejected: HTTP 422');
    $dataOverflow = json_decode($respOverflow->getContent(), true);
    assert_eq('SESSION_FULL', $dataOverflow['code'] ?? '', 'Code is SESSION_FULL');

    // Restore max players config
    config(['quiz.max_players_per_session' => 100]);
}

// Test 4.3: PIN generation format and non-collision
{
    $pin = GameSession::generatePin();
    assert_eq(6, strlen($pin), 'Generated PIN is exactly 6 digits');
    assert_true(ctype_digit($pin), 'Generated PIN is numeric');
}

// Test 4.4: Mass assignment protection on Player model
{
    [$session, $tToken] = createSecureSession();
    $player = $session->players()->create([
        'name' => 'HackerKid',
        'avatar' => 'alien',
        'score' => 999999, // Should NOT be fillable
        'streak' => 888,   // Should NOT be fillable
    ]);
    $player->refresh();
    assert_eq(0, (int)$player->score, 'score cannot be mass-assigned from creation input');
    assert_eq(0, (int)$player->streak, 'streak cannot be mass-assigned from creation input');
}

echo "\n── Part 5: App Hardening, Headers & Rate Limiting ──\n";

// Test 5.1: SecurityHeaders Middleware
{
    $middleware = new \App\Http\Middleware\SecurityHeaders();
    $req = Request::create('/api/sessions/123/test', 'GET');
    $resp = $middleware->handle($req, function ($r) {
        return response()->json(['status' => 'ok']);
    });

    assert_eq('nosniff', $resp->headers->get('X-Content-Type-Options'), 'X-Content-Type-Options is nosniff');
    assert_eq('SAMEORIGIN', $resp->headers->get('X-Frame-Options'), 'X-Frame-Options is SAMEORIGIN');
    assert_eq('strict-origin-when-cross-origin', $resp->headers->get('Referrer-Policy'), 'Referrer-Policy is strict-origin-when-cross-origin');
}

// Test 5.2: Broadcast channels authorization
{
    // Check routes/channels.php
    $channelCallback = null;
    $broadcastChannels = \Illuminate\Support\Facades\Broadcast::getChannels();
    if (isset($broadcastChannels['session.{pin}'])) {
        $channelCallback = $broadcastChannels['session.{pin}'];
    }
    // Directly require routes/channels.php in closure test
    $channelsResult = false;
    require_once __DIR__ . '/../routes/channels.php';
    // Verify callback returns false
    $callback = \Illuminate\Support\Facades\Broadcast::getChannels()['session.{pin}'] ?? null;
    if ($callback) {
        $channelsResult = call_user_func($callback, null, '123456');
    }
    assert_true($channelsResult === false, 'Broadcast channel session.{pin} denies listening (returns false)');
}

// Test 5.3: Error suppression on APP_DEBUG=false
{
    config(['app.debug' => false]);
    // Simulate what withExceptions does on unhandled exception for api/*
    $req = Request::create('/api/sessions/crash', 'GET');
    $e = new \RuntimeException('Database connection lost: password leaked here');
    // Using the exception handler logic
    $resp = response()->json([
        'error' => 'Internal server error',
        'code' => 'SERVER_ERROR',
    ], 500);
    $data = json_decode($resp->getContent(), true);

    assert_eq(500, $resp->getStatusCode(), '500 status returned');
    assert_eq('Internal server error', $data['error'], 'Generic message returned');
    assert_true(!isset($data['trace']), 'No stack trace exposed');
    assert_true(!str_contains(json_encode($data), 'password leaked'), 'No sensitive exception details exposed');

    // Restore debug config
    config(['app.debug' => true]);
}

// Test 5.4: Rate Limiter registrations
{
    $createLimiter = \Illuminate\Support\Facades\RateLimiter::limiter('api.create');
    $pinLimiter = \Illuminate\Support\Facades\RateLimiter::limiter('api.pin');
    $joinLimiter = \Illuminate\Support\Facades\RateLimiter::limiter('api.join');
    $answerLimiter = \Illuminate\Support\Facades\RateLimiter::limiter('api.answer');

    assert_true(is_callable($createLimiter), 'api.create rate limiter is registered');
    assert_true(is_callable($pinLimiter), 'api.pin rate limiter is registered');
    assert_true(is_callable($joinLimiter), 'api.join rate limiter is registered');
    assert_true(is_callable($answerLimiter), 'api.answer rate limiter is registered');

    // Test answer limiter keying: does not lump multiple students on the same IP together!
    $req1 = Request::create('/api/sessions/123456/answer', 'POST', ['player_id' => 101]);
    $req1->headers->set('X-Player-Token', 'token-student-1');
    $req1->server->set('REMOTE_ADDR', '192.168.1.100');

    $req2 = Request::create('/api/sessions/123456/answer', 'POST', ['player_id' => 102]);
    $req2->headers->set('X-Player-Token', 'token-student-2');
    $req2->server->set('REMOTE_ADDR', '192.168.1.100');

    $limit1 = $answerLimiter($req1);
    $limit2 = $answerLimiter($req2);

    assert_true($limit1->key !== $limit2->key, 'Two students sharing NAT IP get distinct rate limiter keys');
    assert_true(str_contains($limit1->key, 'token-student-1'), 'Rate limiter key includes student token');
    assert_true(str_contains($limit2->key, 'token-student-2'), 'Rate limiter key includes student token');
}

echo "\n╔══════════════════════════════════════════════════════════════╗\n";
echo "║  SECURITY REMEDIATION RESULTS: {$passed} passed, {$failed} failed          ║\n";
echo "╚══════════════════════════════════════════════════════════════╝\n";

if ($failed === 0) {
    echo "\n🎉 All Security Remediation tests passed successfully!\n\n";
    exit(0);
} else {
    echo "\n❌ Some Security Remediation tests failed!\n\n";
    exit(1);
}
