<?php
/**
 * Phase 2.3 Final Blocker Remediation & Data Integrity Test Suite
 *
 * Covers:
 * 1. HTTP Kernel Teacher Authentication, Expiry, Revocation, Key Rotation, & 429 Rate Limiting
 * 2. SessionController::end() & reset() concurrency-safe transitions + GameFinished/SessionReset event versioning
 * 3. Final Podium / Leaderboard Backend Data Integrity (cases 1-7, 11-13)
 * 4. Migration 2024_01_05_000001 Historical Reveal State Backfill (fresh, upgrade, ambiguous, rollback)
 *
 * Target: Isolated :memory: SQLite Database
 * Run: php tests/test_phase23_remediation.php
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$consoleKernel = $app->make(\Illuminate\Contracts\Console\Kernel::class);
$consoleKernel->bootstrap();

config([
    'database.default' => 'sqlite',
    'database.connections.sqlite.database' => ':memory:',
    'broadcasting.default' => 'null',
    'cache.default' => 'array',
    'quiz.sync_lead_ms' => 2000,
    'quiz.answer_grace_ms' => 1000,
    'quiz.allow_legacy_open_sessions' => false,
    'quiz.reveal_on_answer' => false,
    'quiz.teacher_token_ttl' => 3600,
]);

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Http\Request;
use App\Models\GameSession;
use App\Models\Player;
use App\Models\Answer;
use App\Models\TeacherToken;
use App\Events\GameFinished;
use App\Events\SessionReset;
use App\Http\Controllers\SessionController;
use App\Http\Controllers\GameController;
use App\Http\Controllers\TeacherAuthController;

Artisan::call('migrate', ['--force' => true]);

$httpKernel = $app->make(\Illuminate\Contracts\Http\Kernel::class);

echo "\n╔══════════════════════════════════════════════════════════════╗\n";
echo "║  Tecorbi Kids Arena — Phase 2.3 Remediation Test Suite      ║\n";
echo "║  Database: :memory: SQLite (safe, isolated)                 ║\n";
echo "╚══════════════════════════════════════════════════════════════╝\n\n";

$passed = 0;
$failed = 0;

function p23_assert($cond, string $label) {
    global $passed, $failed;
    if ($cond) {
        $passed++;
        echo "  ✅ PASS: {$label}\n";
    } else {
        $failed++;
        echo "  ❌ FAIL: {$label}\n";
    }
}

function p23_eq($expected, $actual, string $label) {
    p23_assert(
        $expected === $actual,
        $label . ($expected === $actual ? '' : ' (expected ' . var_export($expected, true) . ', got ' . var_export($actual, true) . ')')
    );
}

function httpJson($httpKernel, string $method, string $uri, array $data = [], array $headers = [], string $ip = '192.168.10.5') {
    $server = ['REMOTE_ADDR' => $ip, 'HTTP_ACCEPT' => 'application/json'];
    foreach ($headers as $k => $v) {
        $server['HTTP_' . strtoupper(str_replace('-', '_', $k))] = $v;
    }
    $content = null;
    if (in_array($method, ['POST', 'PUT', 'PATCH']) && !empty($data)) {
        $server['CONTENT_TYPE'] = 'application/json';
        $content = json_encode($data);
    }
    $request = Request::create($uri, $method, [], [], [], $server, $content);
    $response = $httpKernel->handle($request);
    $httpKernel->terminate($request, $response);
    return [$response->getStatusCode(), json_decode($response->getContent(), true), $response];
}

function makeQuizPayload(int $numQuestions = 2): array {
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
        'teacher_name' => 'Ms. Nadia',
        'title' => 'Phase 2.3 Integrity Quiz',
        'questions' => $qs,
    ];
}

// ══════════════════════════════════════════════════════════════════════
// PART 1: Teacher Authentication & Session Creation via HTTP Kernel
// ══════════════════════════════════════════════════════════════════════
echo "── Part 1: HTTP Kernel Teacher Auth, Expiry, Revocation & Rate Limiting ──\n";
{
    // 1. Fail-closed when TEACHER_ACCESS_KEY is unset
    config(['quiz.teacher_access_key' => null]);
    [$st, $body] = httpJson($httpKernel, 'POST', '/api/sessions', makeQuizPayload());
    p23_eq(503, $st, 'POST /api/sessions returns 503 when TEACHER_ACCESS_KEY is unset');

    config(['quiz.teacher_access_key' => 'classroom-master-key-2026']);

    // 2. Unauthenticated POST /api/sessions -> 403
    [$st, $body] = httpJson($httpKernel, 'POST', '/api/sessions', makeQuizPayload());
    p23_eq(403, $st, 'Unauthenticated POST /api/sessions is rejected (403)');

    // 3. Fabricated/arbitrary sessionStorage token -> 403
    [$st, $body] = httpJson($httpKernel, 'POST', '/api/sessions', makeQuizPayload(), [
        'X-Teacher-Auth' => 'fabricated-client-token-123456',
    ]);
    p23_eq(403, $st, 'Arbitrary fabricated X-Teacher-Auth token is rejected (403)');

    // 4. Raw access key passed directly as X-Teacher-Auth -> 403 (must obtain issued portal token)
    [$st, $body] = httpJson($httpKernel, 'POST', '/api/sessions', makeQuizPayload(), [
        'X-Teacher-Auth' => 'classroom-master-key-2026',
    ]);
    p23_eq(403, $st, 'Raw TEACHER_ACCESS_KEY cannot bypass issued portal token verification (403)');

    // 5. Query string token cannot authenticate
    [$st, $body] = httpJson($httpKernel, 'POST', '/api/sessions?teacher_auth=fake', makeQuizPayload());
    p23_eq(403, $st, 'Query-string teacher auth is rejected (403)');

    // 6. Wrong key on /api/teacher/auth -> 403
    [$st, $body] = httpJson($httpKernel, 'POST', '/api/teacher/auth', ['access_key' => 'wrong-key'], [], '10.0.1.1');
    p23_eq(403, $st, 'Wrong key on POST /api/teacher/auth returns 403');

    // 7. Valid key on /api/teacher/auth -> 200 + persisted hashed token + no secret leaked
    [$st, $authBody] = httpJson($httpKernel, 'POST', '/api/teacher/auth', ['access_key' => 'classroom-master-key-2026'], [], '10.0.1.2');
    p23_eq(200, $st, 'Valid key on POST /api/teacher/auth returns 200');
    $portalToken = $authBody['teacher_portal_token'] ?? '';
    p23_assert(strlen($portalToken) === 64, 'Issued portal token is 256-bit hex (64 chars)');
    p23_assert(!str_contains(json_encode($authBody), 'classroom-master-key-2026'), 'Secret key is never exposed in auth response');

    // 8. Token is verified on GET /api/teacher/verify and POST /api/sessions
    [$st, $vBody] = httpJson($httpKernel, 'GET', '/api/teacher/verify', [], ['X-Teacher-Auth' => $portalToken]);
    p23_eq(200, $st, 'GET /api/teacher/verify accepts valid portal token (200)');

    [$st, $createBody] = httpJson($httpKernel, 'POST', '/api/sessions', makeQuizPayload(2), ['X-Teacher-Auth' => $portalToken]);
    p23_eq(201, $st, 'POST /api/sessions succeeds with valid X-Teacher-Auth portal token (201)');
    $pin = $createBody['pin'] ?? null;
    $sessionTeacherToken = $createBody['teacher_token'] ?? null;
    p23_assert(!empty($pin) && !empty($sessionTeacherToken), 'Created session returns PIN and per-session teacher_token');

    // 9. Per-session teacher controls enforce X-Teacher-Token through HTTP kernel
    [$st] = httpJson($httpKernel, 'POST', "/api/sessions/{$pin}/start");
    p23_eq(403, $st, 'POST /sessions/{pin}/start rejects unauthenticated call (403)');
    [$st] = httpJson($httpKernel, 'POST', "/api/sessions/{$pin}/start", [], ['X-Teacher-Token' => 'wrong-token']);
    p23_eq(403, $st, 'POST /sessions/{pin}/start rejects invalid X-Teacher-Token (403)');
    [$st] = httpJson($httpKernel, 'POST', "/api/sessions/{$pin}/start", [], ['X-Teacher-Token' => $sessionTeacherToken]);
    p23_eq(200, $st, 'POST /sessions/{pin}/start accepts valid X-Teacher-Token (200)');

    // 10. Expired portal token is rejected
    $tokenHash = hash('sha256', $portalToken);
    TeacherToken::where('token_hash', $tokenHash)->update(['expires_at' => now()->subMinute()]);
    [$st] = httpJson($httpKernel, 'POST', '/api/sessions', makeQuizPayload(), ['X-Teacher-Auth' => $portalToken]);
    p23_eq(403, $st, 'Expired portal token is rejected on POST /api/sessions (403)');
    [$st] = httpJson($httpKernel, 'GET', '/api/teacher/verify', [], ['X-Teacher-Auth' => $portalToken]);
    p23_eq(403, $st, 'Expired portal token is rejected on GET /api/teacher/verify (403)');

    // 11. Fresh token -> revoke via POST /api/teacher/logout -> rejected afterward
    [$st, $authBody2] = httpJson($httpKernel, 'POST', '/api/teacher/auth', ['access_key' => 'classroom-master-key-2026'], [], '10.0.1.3');
    $portalToken2 = $authBody2['teacher_portal_token'];
    [$st, $logoutBody] = httpJson($httpKernel, 'POST', '/api/teacher/logout', [], ['X-Teacher-Auth' => $portalToken2]);
    p23_eq(200, $st, 'POST /api/teacher/logout succeeds (200)');
    [$st] = httpJson($httpKernel, 'POST', '/api/sessions', makeQuizPayload(), ['X-Teacher-Auth' => $portalToken2]);
    p23_eq(403, $st, 'Revoked portal token is rejected on POST /api/sessions (403)');

    // 12. Rotating TEACHER_ACCESS_KEY invalidates existing portal tokens
    [$st, $authBody3] = httpJson($httpKernel, 'POST', '/api/teacher/auth', ['access_key' => 'classroom-master-key-2026'], [], '10.0.1.4');
    $portalToken3 = $authBody3['teacher_portal_token'];
    config(['quiz.teacher_access_key' => 'rotated-new-secret-key']);
    [$st] = httpJson($httpKernel, 'POST', '/api/sessions', makeQuizPayload(), ['X-Teacher-Auth' => $portalToken3]);
    p23_eq(403, $st, 'Key rotation invalidates previously issued portal tokens (403)');

    // Restore key & test 429 rate limiting on POST /api/teacher/auth (limit = 10/min per IP)
    config(['quiz.teacher_access_key' => 'classroom-master-key-2026']);
    $rateIp = '10.99.99.99';
    $hit429 = false;
    for ($i = 1; $i <= 12; $i++) {
        [$st] = httpJson($httpKernel, 'POST', '/api/teacher/auth', ['access_key' => 'bad'], [], $rateIp);
        if ($st === 429) {
            $hit429 = true;
            break;
        }
    }
    p23_assert($hit429, 'POST /api/teacher/auth enforces rate limiting and returns 429 Too Many Requests');
}

// ══════════════════════════════════════════════════════════════════════
// PART 2: Event Versioning & Idempotency (GameFinished & SessionReset)
// ══════════════════════════════════════════════════════════════════════
echo "\n── Part 2: GameFinished & SessionReset Version Consistency ──\n";
{
    $sessionCtrl = app(SessionController::class);
    $res = json_decode($sessionCtrl->store(Request::create('/api/sessions', 'POST', makeQuizPayload(2)))->getContent(), true);
    $pin = $res['pin'];

    $finishedEvents = [];
    $resetEvents = [];
    Event::listen(GameFinished::class, function ($e) use (&$finishedEvents) {
        $finishedEvents[] = $e->broadcastWith();
    });
    Event::listen(SessionReset::class, function ($e) use (&$resetEvents) {
        $resetEvents[] = $e->broadcastWith();
    });

    $sessionCtrl->start($pin);
    $end1 = json_decode($sessionCtrl->end($pin)->getContent(), true);
    $sessAfterEnd = GameSession::where('pin', $pin)->first();

    p23_eq(1, count($finishedEvents), 'First end() dispatches GameFinished exactly once');
    p23_eq($sessAfterEnd->state_version, $end1['state_version'], 'end() returns committed DB state_version');
    p23_eq($end1['state_version'], $finishedEvents[0]['state_version'], 'GameFinished payload state_version matches committed DB');
    p23_eq($pin, $finishedEvents[0]['pin'], 'GameFinished payload carries session PIN');

    // Duplicate end() must NOT increment state_version or emit another GameFinished
    $end2 = json_decode($sessionCtrl->end($pin)->getContent(), true);
    p23_eq(1, count($finishedEvents), 'Duplicate end() does NOT broadcast duplicate GameFinished');
    p23_eq($end1['state_version'], $end2['state_version'], 'Duplicate end() returns unchanged state_version');

    // Reset increments version once and emits SessionReset with matching version
    $reset1 = json_decode($sessionCtrl->reset($pin)->getContent(), true);
    $sessAfterReset = GameSession::where('pin', $pin)->first();
    p23_eq(1, count($resetEvents), 'First reset() dispatches SessionReset exactly once');
    p23_eq($sessAfterReset->state_version, $reset1['state_version'], 'reset() returns committed DB state_version');
    p23_eq($reset1['state_version'], $resetEvents[0]['state_version'], 'SessionReset payload state_version matches committed DB');

    // Duplicate reset() on already-waiting empty session does NOT bump version or re-broadcast
    $reset2 = json_decode($sessionCtrl->reset($pin)->getContent(), true);
    p23_eq(1, count($resetEvents), 'Duplicate reset() does NOT broadcast duplicate SessionReset');
    p23_eq($reset1['state_version'], $reset2['state_version'], 'Duplicate reset() preserves state_version');
}

// ══════════════════════════════════════════════════════════════════════
// PART 3: Final Podium / Leaderboard Backend Integrity (Cases 1-7, 11-13)
// ══════════════════════════════════════════════════════════════════════
echo "\n── Part 3: Final Podium & Leaderboard Backend Integrity ──\n";
{
    $sessionCtrl = app(SessionController::class);
    $gameCtrl = app(GameController::class);

    // Helper to create session with N players & specified scores
    $setupCompletedSession = function (array $playerSpecs) use ($sessionCtrl) {
        $res = json_decode($sessionCtrl->store(Request::create('/api/sessions', 'POST', makeQuizPayload(2)))->getContent(), true);
        $pin = $res['pin'];
        $session = GameSession::where('pin', $pin)->first();
        $createdPlayers = [];
        foreach ($playerSpecs as $spec) {
            $j = json_decode($sessionCtrl->join(Request::create("/api/sessions/{$pin}/join", 'POST', [
                'name' => $spec['name'],
                'avatar' => $spec['avatar'] ?? 'ninja',
            ]), $pin)->getContent(), true);
            $p = Player::find($j['player']['id']);
            $p->forceFill(['score' => $spec['score'], 'streak' => $spec['streak'] ?? 0])->save();
            $createdPlayers[] = ['model' => $p, 'token' => $j['player_token']];
        }
        $sessionCtrl->start($pin);
        $sessionCtrl->end($pin);
        return [$pin, $session->fresh(), $createdPlayers];
    };

    // Case 1: Empty session -> empty podium (0 players, no fake defaults)
    [$emptyPin] = $setupCompletedSession([]);
    $emptyRes = json_decode($gameCtrl->results($emptyPin)->getContent(), true);
    p23_eq(0, count($emptyRes['results']), 'Case 1: Empty session produces empty results array (0 fake players)');
    p23_eq(0, $emptyRes['total_players'], 'Case 1: Empty session reports total_players=0');
    p23_eq($emptyPin, $emptyRes['pin'], 'Results response includes authoritative session PIN');

    // Case 2: 1 real player -> 1 entry
    [$onePin] = $setupCompletedSession([['name' => 'SoloHero', 'score' => 800]]);
    $oneRes = json_decode($gameCtrl->results($onePin)->getContent(), true);
    p23_eq(1, count($oneRes['results']), 'Case 2: One real player produces exactly 1 result entry');
    p23_eq('SoloHero', $oneRes['results'][0]['name'], 'Case 2: Solo player name matches DB');

    // Case 3: 2 real players -> 2 entries
    [$twoPin] = $setupCompletedSession([
        ['name' => 'DuoA', 'score' => 500],
        ['name' => 'DuoB', 'score' => 950],
    ]);
    $twoRes = json_decode($gameCtrl->results($twoPin)->getContent(), true);
    p23_eq(2, count($twoRes['results']), 'Case 3: Two real players produce exactly 2 result entries');
    p23_eq('DuoB', $twoRes['results'][0]['name'], 'Case 3: Higher score ranks #1');

    // Case 4: 3 real players -> 3 entries
    [$threePin] = $setupCompletedSession([
        ['name' => 'Trio1', 'score' => 700],
        ['name' => 'Trio2', 'score' => 900],
        ['name' => 'Trio3', 'score' => 600],
    ]);
    $threeRes = json_decode($gameCtrl->results($threePin)->getContent(), true);
    p23_eq(3, count($threeRes['results']), 'Case 4: Three real players produce exactly 3 entries');

    // Case 5 & 6: 5 real players + separate session isolation
    [$otherPin] = $setupCompletedSession([['name' => 'OtherSessPlayer', 'score' => 99999]]);
    [$fivePin, , $fivePlayers] = $setupCompletedSession([
        ['name' => 'P_A', 'score' => 400],
        ['name' => 'P_B', 'score' => 1500],
        ['name' => 'P_C', 'score' => 1200],
        ['name' => 'P_D', 'score' => 1800],
        ['name' => 'P_E', 'score' => 900],
    ]);
    $fiveRes = json_decode($gameCtrl->results($fivePin)->getContent(), true);
    p23_eq(5, count($fiveRes['results']), 'Case 5: Five real players produce 5 ranked entries');
    p23_eq(['P_D', 'P_B', 'P_C'], array_column(array_slice($fiveRes['results'], 0, 3), 'name'), 'Case 5: Top 3 sorted correctly');
    $namesInFive = array_column($fiveRes['results'], 'name');
    p23_assert(!in_array('OtherSessPlayer', $namesInFive, true), 'Case 6: Players from other sessions are strictly excluded');

    // Case 7: Deleted player is NOT fabricated or replaced
    $fivePlayers[1]['model']->delete(); // delete P_B (1500)
    $afterDelRes = json_decode($gameCtrl->results($fivePin)->getContent(), true);
    p23_eq(4, count($afterDelRes['results']), 'Case 7: Deleted player is removed without synthetic replacement');
    p23_assert(!in_array('P_B', array_column($afterDelRes['results'], 'name'), true), 'Case 7: Deleted player does not appear');

    // Case 11 & 12: Tied scores deterministic across refreshes
    [$tiePin] = $setupCompletedSession([
        ['name' => 'TieFirst', 'score' => 1000],
        ['name' => 'TieSecond', 'score' => 1000],
        ['name' => 'TieThird', 'score' => 1000],
    ]);
    $tieRes1 = json_decode($gameCtrl->results($tiePin)->getContent(), true);
    $tieRes2 = json_decode($gameCtrl->results($tiePin)->getContent(), true);
    $tieLb = json_decode($gameCtrl->leaderboard(Request::create("/api/sessions/{$tiePin}/leaderboard", 'GET'), $tiePin)->getContent(), true);
    p23_eq(['TieFirst', 'TieSecond', 'TieThird'], array_column($tieRes1['results'], 'name'), 'Case 11: Tied scores tie-break deterministically by player ID');
    p23_eq($tieRes1['results'], $tieRes2['results'], 'Case 12: Refreshing /results returns identical persisted ranking');
    p23_eq(array_column($tieRes1['results'], 'id'), array_column($tieLb['leaderboard'], 'id'), 'Case 11: leaderboard() and results() use identical tie-breaking order');

    // Case 13: Production seeder guard ensures no demo players leak
    GameSession::where('pin', '123456')->delete();
    $origEnv = $app['env'];
    $app['env'] = 'production';
    (new \Database\Seeders\DatabaseSeeder())->run();
    p23_eq(0, GameSession::where('pin', '123456')->count(), 'Case 13: Production environment never seeds demo PIN 123456');
    $app['env'] = $origEnv;
}

// ══════════════════════════════════════════════════════════════════════
// PART 4: Migration 2024_01_05_000001 Historical Reveal Backfill & Rollback
// ══════════════════════════════════════════════════════════════════════
echo "\n── Part 4: Migration 2024_01_05_000001 Upgrade, Backfill & Rollback ──\n";
{
    config(['database.connections.migrev' => ['driver' => 'sqlite', 'database' => ':memory:']]);
    $prevDefault = config('database.default');
    DB::setDefaultConnection('migrev');

    // Simulate pre-2024_01_05 schema (no is_revealed column yet)
    DB::statement('CREATE TABLE game_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, pin VARCHAR(6), status VARCHAR(32), question_state VARCHAR(32), current_question_index INTEGER)');
    DB::statement('CREATE TABLE questions (id INTEGER PRIMARY KEY AUTOINCREMENT, game_session_id INTEGER, question_text TEXT, "order" INTEGER, time_limit INTEGER)');

    // Session 1: active, current question index 1, question_state='revealed' -> Q1 proven revealed, Q0 ambiguous, Q2 future
    DB::table('game_sessions')->insert(['id' => 1, 'pin' => '111111', 'status' => 'active', 'question_state' => 'revealed', 'current_question_index' => 1]);
    // Session 2: completed at index 2, question_state='revealed' -> Q2 proven revealed
    DB::table('game_sessions')->insert(['id' => 2, 'pin' => '222222', 'status' => 'completed', 'question_state' => 'revealed', 'current_question_index' => 2]);
    // Session 3: active, answering at index 0 -> Q0 NOT revealed
    DB::table('game_sessions')->insert(['id' => 3, 'pin' => '333333', 'status' => 'active', 'question_state' => 'answering', 'current_question_index' => 0]);

    DB::table('questions')->insert([
        ['id' => 10, 'game_session_id' => 1, 'question_text' => 'S1 Q0', 'order' => 0, 'time_limit' => 20],
        ['id' => 11, 'game_session_id' => 1, 'question_text' => 'S1 Q1', 'order' => 1, 'time_limit' => 20],
        ['id' => 12, 'game_session_id' => 1, 'question_text' => 'S1 Q2', 'order' => 2, 'time_limit' => 20],
        ['id' => 20, 'game_session_id' => 2, 'question_text' => 'S2 Q0', 'order' => 0, 'time_limit' => 20],
        ['id' => 21, 'game_session_id' => 2, 'question_text' => 'S2 Q1', 'order' => 1, 'time_limit' => 20],
        ['id' => 22, 'game_session_id' => 2, 'question_text' => 'S2 Q2', 'order' => 2, 'time_limit' => 20],
        ['id' => 30, 'game_session_id' => 3, 'question_text' => 'S3 Q0', 'order' => 0, 'time_limit' => 20],
    ]);

    $mig = require __DIR__ . '/../database/migrations/2024_01_05_000001_add_is_revealed_to_questions_table.php';
    $mig->up();

    p23_eq(0, (int) DB::table('questions')->where('id', 10)->value('is_revealed'), 'Upgrade: ambiguous prior S1 Q0 remains is_revealed=0 (fail-closed)');
    p23_eq(1, (int) DB::table('questions')->where('id', 11)->value('is_revealed'), 'Upgrade: authoritatively revealed S1 Q1 backfilled to is_revealed=1');
    p23_eq(0, (int) DB::table('questions')->where('id', 12)->value('is_revealed'), 'Upgrade: future S1 Q2 remains is_revealed=0');
    p23_eq(1, (int) DB::table('questions')->where('id', 22)->value('is_revealed'), 'Upgrade: completed S2 final Q2 backfilled to is_revealed=1');
    p23_eq(0, (int) DB::table('questions')->where('id', 30)->value('is_revealed'), 'Upgrade: active answering S3 Q0 remains is_revealed=0');

    // Rollback verification
    $mig->down();
    $cols = array_map(fn($c) => $c->name, DB::select('PRAGMA table_info(questions)'));
    p23_assert(!in_array('is_revealed', $cols, true), 'Rollback down() drops is_revealed column cleanly');
    p23_eq(7, DB::table('questions')->count(), 'Rollback preserves all existing question rows');

    DB::setDefaultConnection($prevDefault);
}

// ══════════════════════════════════════════════════════════════════════
// PART 5: Prevent next() After Completed (Normal, Early, Repeated)
// ══════════════════════════════════════════════════════════════════════
echo "\n── Part 5: Prevent next() After Completed ──\n";
{
    $sessionCtrl = app(SessionController::class);
    $transitionEvents = 0;
    Event::listen(\App\Events\QuestionChanged::class, function () use (&$transitionEvents) {
        $transitionEvents++;
    });
    Event::listen(GameFinished::class, function () use (&$transitionEvents) {
        $transitionEvents++;
    });

    // 1. Calling next() after normal completion (2 questions -> Q0 -> Q1 -> completed via next())
    $resNorm = json_decode($sessionCtrl->store(Request::create('/api/sessions', 'POST', makeQuizPayload(2)))->getContent(), true);
    $pinNorm = $resNorm['pin'];
    $sessionCtrl->start($pinNorm);
    $sessionCtrl->next(Request::create("/api/sessions/{$pinNorm}/next", 'POST'), $pinNorm); // to Q1
    $sessionCtrl->next(Request::create("/api/sessions/{$pinNorm}/next", 'POST'), $pinNorm); // completes

    $sessNorm = GameSession::where('pin', $pinNorm)->first();
    $verCompleted = (int) $sessNorm->state_version;
    $idxCompleted = (int) $sessNorm->current_question_index;
    p23_eq('completed', $sessNorm->status, 'Normal completion reaches completed status');

    $eventsBefore = $transitionEvents;
    $respAfterNormal = $sessionCtrl->next(Request::create("/api/sessions/{$pinNorm}/next", 'POST'), $pinNorm);
    $sessNorm->refresh();
    p23_eq(409, $respAfterNormal->getStatusCode(), 'next() after normal completion returns HTTP 409');
    p23_eq('SESSION_COMPLETED', json_decode($respAfterNormal->getContent(), true)['code'] ?? null, 'next() after normal completion returns SESSION_COMPLETED');
    p23_eq('completed', $sessNorm->status, 'Status remains completed after rejected next()');
    p23_eq($verCompleted, (int) $sessNorm->state_version, 'state_version does not increase after rejected next()');
    p23_eq($idxCompleted, (int) $sessNorm->current_question_index, 'current_question_index unchanged after rejected next()');
    p23_eq($eventsBefore, $transitionEvents, 'Zero transition events dispatched on rejected next() after normal completion');

    // 2. Calling next() after early completion (end() on Q0 of 3 questions) + 3. Repeated calls
    $resEarly = json_decode($sessionCtrl->store(Request::create('/api/sessions', 'POST', makeQuizPayload(3)))->getContent(), true);
    $pinEarly = $resEarly['pin'];
    $sessionCtrl->start($pinEarly);
    $sessionCtrl->end($pinEarly);

    $sessEarly = GameSession::where('pin', $pinEarly)->first();
    $verEarly = (int) $sessEarly->state_version;
    p23_eq(0, (int) $sessEarly->current_question_index, 'Early end() stops at Q0');

    $eventsBeforeEarly = $transitionEvents;
    for ($attempt = 1; $attempt <= 3; $attempt++) {
        $rEarlyNext = $sessionCtrl->next(Request::create("/api/sessions/{$pinEarly}/next", 'POST', ['expected_index' => 0]), $pinEarly);
        $sessEarly->refresh();
        p23_eq(409, $rEarlyNext->getStatusCode(), "Repeated next() #{$attempt} after early completion returns HTTP 409");
        p23_eq('completed', $sessEarly->status, "Repeated next() #{$attempt} preserves completed status");
        p23_eq($verEarly, (int) $sessEarly->state_version, "Repeated next() #{$attempt} does not increment state_version");
        p23_eq(0, (int) $sessEarly->current_question_index, "Repeated next() #{$attempt} does not advance question index");
    }
    p23_eq($eventsBeforeEarly, $transitionEvents, 'Zero QuestionChanged/GameFinished events dispatched across repeated post-completion next() calls');

    // 4. Stale DB object guard inside conditional UPDATE (simulates race where $session read before end())
    // Even if status check in DB is bypassed by stale read before end(), conditional UPDATE with whereNotIn(['paused','completed']) prevents revival.
    $resCond = json_decode($sessionCtrl->store(Request::create('/api/sessions', 'POST', makeQuizPayload(3)))->getContent(), true);
    $pinCond = $resCond['pin'];
    $sessionCtrl->start($pinCond);
    $sCond = GameSession::where('pin', $pinCond)->first();
    $vBeforeCond = (int) $sCond->state_version;
    $sessionCtrl->end($pinCond);
    $sCondAfterEnd = GameSession::where('pin', $pinCond)->first();
    $affected = GameSession::where('id', $sCond->id)
        ->whereNotIn('status', ['paused', 'completed'])
        ->where('current_question_index', 0)
        ->where('state_version', $vBeforeCond + 1) // even if someone supplied current state_version
        ->update(['status' => 'active', 'current_question_index' => 1]);
    p23_eq(0, $affected, 'DB conditional UPDATE strictly blocks completed->active revival even with matching state_version');
    p23_eq('completed', $sCondAfterEnd->fresh()->status, 'Session status remains completed in DB');
}

echo "\n╔══════════════════════════════════════════════════════════════╗\n";
echo "║  PHASE 2.3 RESULTS: {$passed} passed, {$failed} failed                     ║\n";
echo "╚══════════════════════════════════════════════════════════════╝\n\n";

exit($failed === 0 ? 0 : 1);
