<?php
/**
 * Genuine Multi-Process Concurrency Test for SQLite (Extended Phase 2.3)
 *
 * Spawns parallel OS processes (PHP CLI) against an isolated temporary SQLite WAL database:
 * 1. Concurrent next(expected_index=0) calls (4 processes)
 * 2. Concurrent pause() calls (4 processes)
 * 3. Concurrent end() calls (4 processes) -> exactly +1 state_version, status='completed'
 * 4. Concurrent reset() calls (4 processes) -> exactly +1 state_version, status='waiting', 0 players/answers
 * 5. end() racing simultaneously with next() and reveal() -> strictly +1 per winning transition, consistent final state
 * 6. reset() racing simultaneously with join() and answer() -> ZERO orphaned answers, zero SQLITE_BUSY crashes
 *
 * Run: php tests/test_concurrency_multiprocess.php
 */

$tempDb = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'quiz_concurrency_test_' . uniqid() . '.sqlite';
touch($tempDb);

echo "\n╔══════════════════════════════════════════════════════════════╗\n";
echo "║  Tecorbi Kids Arena — Multi-Process Concurrency Test        ║\n";
echo "║  Target: Temporary SQLite file (isolated from production)  ║\n";
echo "╚══════════════════════════════════════════════════════════════╝\n\n";

putenv("DB_CONNECTION=sqlite");
putenv("DB_DATABASE={$tempDb}");
putenv("BROADCAST_CONNECTION=null");

require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$kernel = $app->make(\Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

config([
    'database.default' => 'sqlite',
    'database.connections.sqlite.database' => $tempDb,
    'database.connections.sqlite.busy_timeout' => 5000,
    'database.connections.sqlite.journal_mode' => 'WAL',
    'database.connections.sqlite.synchronous' => 'NORMAL',
    'broadcasting.default' => 'null',
]);

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use App\Models\GameSession;
use App\Models\Player;
use App\Models\Answer;

Artisan::call('migrate', ['--force' => true]);

$rootDir = realpath(__DIR__ . '/..');
$workerScript = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'tecorbi_worker_concurrency_' . uniqid() . '.php';
$escapedRootDir = var_export($rootDir, true);
$workerCode = <<<PHP
<?php
\$rootDir = {$escapedRootDir};
\$tempDb = \$argv[1];
\$pin = \$argv[2];
\$action = \$argv[3];
\$arg4 = \$argv[4] ?? null;
\$arg5 = \$argv[5] ?? null;
\$arg6 = \$argv[6] ?? null;

putenv("DB_CONNECTION=sqlite");
putenv("DB_DATABASE={\$tempDb}");
putenv("DB_BUSY_TIMEOUT=5000");
putenv("DB_JOURNAL_MODE=WAL");
putenv("DB_SYNCHRONOUS=NORMAL");
putenv("BROADCAST_CONNECTION=null");

require \$rootDir . '/vendor/autoload.php';
\$app = require \$rootDir . '/bootstrap/app.php';
\$kernel = \$app->make(\Illuminate\Contracts\Console\Kernel::class);
\$kernel->bootstrap();

config([
    'database.default' => 'sqlite',
    'database.connections.sqlite.database' => \$tempDb,
    'database.connections.sqlite.busy_timeout' => 5000,
    'database.connections.sqlite.journal_mode' => 'WAL',
    'database.connections.sqlite.synchronous' => 'NORMAL',
    'broadcasting.default' => 'null',
]);

\Illuminate\Support\Facades\DB::connection()->getPdo()->exec('PRAGMA busy_timeout = 5000;');
\Illuminate\Support\Facades\DB::connection()->getPdo()->exec('PRAGMA journal_mode = WAL;');

\$controller = new \App\Http\Controllers\SessionController();
\$gameController = new \App\Http\Controllers\GameController();

if (\$action === 'next') {
    \$req = new \Illuminate\Http\Request();
    \$req->merge(['expected_index' => (int) (\$arg4 ?? 0)]);
    app()->instance('request', \$req);
    \$resp = \$controller->next(\$req, \$pin);
    echo json_encode(['status_code' => \$resp->getStatusCode(), 'body' => json_decode(\$resp->getContent(), true)]);
} elseif (\$action === 'pause') {
    \$resp = \$controller->pause(\$pin);
    echo json_encode(['status_code' => \$resp->getStatusCode(), 'body' => json_decode(\$resp->getContent(), true)]);
} elseif (\$action === 'end') {
    \$resp = \$controller->end(\$pin);
    echo json_encode(['status_code' => \$resp->getStatusCode(), 'body' => json_decode(\$resp->getContent(), true)]);
} elseif (\$action === 'reset') {
    \$resp = \$controller->reset(\$pin);
    echo json_encode(['status_code' => \$resp->getStatusCode(), 'body' => json_decode(\$resp->getContent(), true)]);
} elseif (\$action === 'reveal') {
    \$resp = \$controller->reveal(\$pin);
    echo json_encode(['status_code' => \$resp->getStatusCode(), 'body' => json_decode(\$resp->getContent(), true)]);
} elseif (\$action === 'join') {
    \$req = \Illuminate\Http\Request::create("/api/sessions/{\$pin}/join", 'POST', [
        'name' => \$arg4 ?: ('Joiner_' . uniqid()),
        'avatar' => 'ninja',
    ]);
    \$resp = \$controller->join(\$req, \$pin);
    echo json_encode(['status_code' => \$resp->getStatusCode(), 'body' => json_decode(\$resp->getContent(), true)]);
} elseif (\$action === 'answer') {
    \$playerId = (int) \$arg4;
    \$choiceId = (int) \$arg5;
    \$token = (string) \$arg6;
    \$req = \Illuminate\Http\Request::create("/api/sessions/{\$pin}/answer", 'POST', [
        'player_id' => \$playerId,
        'choice_id' => \$choiceId,
    ]);
    \$req->headers->set('X-Player-Token', \$token);
    \$resp = \$gameController->answer(\$req, \$pin);
    echo json_encode(['status_code' => \$resp->getStatusCode(), 'body' => json_decode(\$resp->getContent(), true)]);
}
PHP;

file_put_contents($workerScript, $workerCode);

function runParallelCommands(array $commands, string $rootDir): array {
    $procs = [];
    $outFiles = [];
    $errFiles = [];
    foreach ($commands as $i => $cmd) {
        $outFiles[$i] = sys_get_temp_dir() . DIRECTORY_SEPARATOR . "worker_out_{$i}_" . uniqid() . ".json";
        $errFiles[$i] = sys_get_temp_dir() . DIRECTORY_SEPARATOR . "worker_err_{$i}_" . uniqid() . ".log";
        $desc = [
            0 => ['file', 'NUL', 'r'],
            1 => ['file', $outFiles[$i], 'w'],
            2 => ['file', $errFiles[$i], 'w'],
        ];
        $procs[$i] = proc_open($cmd, $desc, $pipes, $rootDir);
    }
    $results = [];
    foreach ($commands as $i => $_) {
        proc_close($procs[$i]);
        $content = file_exists($outFiles[$i]) ? file_get_contents($outFiles[$i]) : '';
        $err = file_exists($errFiles[$i]) ? file_get_contents($errFiles[$i]) : '';
        @unlink($outFiles[$i]);
        @unlink($errFiles[$i]);
        if (!empty($err)) {
            echo "  [Worker {$i} STDERR]: {$err}\n";
        }
        $results[$i] = json_decode($content, true);
    }
    return $results;
}

function createConcurrencySession(string $pin): GameSession {
    $session = GameSession::create([
        'pin' => $pin,
        'teacher_name' => 'Concurrency Teacher',
        'title' => 'Concurrency Quiz',
    ]);
    for ($i = 0; $i < 5; $i++) {
        $q = $session->questions()->create(['question_text' => "Q{$i}", 'order' => $i, 'time_limit' => 20]);
        $q->choices()->create(['choice_text' => 'A', 'is_correct' => true, 'order' => 0]);
        $q->choices()->create(['choice_text' => 'B', 'is_correct' => false, 'order' => 1]);
    }
    return $session;
}

$passed = 0;
$failed = 0;
$controller = new \App\Http\Controllers\SessionController();

// ── Test 1: 4 Parallel Workers calling next(expected_index=0) ──
echo "── Concurrency Test 1: 4 Parallel OS Processes calling next() simultaneously ──\n";
$pin1 = '777881';
$s1 = createConcurrencySession($pin1);
$controller->start($pin1);
$outputs = runParallelCommands(array_fill(0, 4, "php \"{$workerScript}\" \"{$tempDb}\" \"{$pin1}\" next 0"), $rootDir);
$s1->refresh();
if ((int) $s1->current_question_index === 1) {
    $passed++;
    echo "  ✅ PASS: 4 concurrent next(expected_index=0) advanced question EXACTLY ONCE (final index = 1)\n";
} else {
    $failed++;
    echo "  ❌ FAIL: 4 concurrent next(expected_index=0) advanced to index {$s1->current_question_index}\n";
}
$allValid = !in_array(false, array_map(fn($r) => isset($r['body']['current_question_index']), $outputs), true);
if ($allValid) {
    $passed++;
    echo "  ✅ PASS: All 4 concurrent next() workers received clean JSON state responses\n";
} else {
    $failed++;
    echo "  ❌ FAIL: Some next() worker returned invalid response\n";
}

// ── Test 2: 4 Parallel Workers calling pause() simultaneously ──
echo "\n── Concurrency Test 2: 4 Parallel OS Processes calling pause() simultaneously ──\n";
$s1->update(['question_started_at' => (int) round(microtime(true) * 1000) - 5000]);
runParallelCommands(array_fill(0, 4, "php \"{$workerScript}\" \"{$tempDb}\" \"{$pin1}\" pause"), $rootDir);
$s1->refresh();
if ($s1->status === 'paused') {
    $passed++;
    echo "  ✅ PASS: Session status is safely 'paused' after 4 concurrent pause calls\n";
} else {
    $failed++;
    echo "  ❌ FAIL: Session status is not paused\n";
}
$rem = $s1->question_paused_remaining_ms;
if ($rem >= 13500 && $rem <= 16500) {
    $passed++;
    echo "  ✅ PASS: Remaining time preserved safely ({$rem}ms ≈ 15000ms) under concurrent pause calls\n";
} else {
    $failed++;
    echo "  ❌ FAIL: Remaining time corrupted ({$rem}ms)\n";
}

// ── Test 3: 4 Parallel Workers calling end() simultaneously ──
echo "\n── Concurrency Test 3: 4 Parallel OS Processes calling end() simultaneously ──\n";
$pin3 = '777883';
$s3 = createConcurrencySession($pin3);
$controller->start($pin3);
$s3->refresh();
$verBeforeEnd = (int) $s3->state_version;
$endOutputs = runParallelCommands(array_fill(0, 4, "php \"{$workerScript}\" \"{$tempDb}\" \"{$pin3}\" end"), $rootDir);
$s3->refresh();
if ($s3->status === 'completed' && (int) $s3->state_version === $verBeforeEnd + 1) {
    $passed++;
    echo "  ✅ PASS: 4 concurrent end() calls transitioned ONCE (version {$verBeforeEnd} -> {$s3->state_version})\n";
} else {
    $failed++;
    echo "  ❌ FAIL: end() concurrency corrupted status={$s3->status} version={$s3->state_version} (expected " . ($verBeforeEnd + 1) . ")\n";
}
$endAllClean = !in_array(false, array_map(fn($r) => ($r['status_code'] ?? 0) !== 503 && ($r['body']['status'] ?? null) === 'completed', $endOutputs), true);
if ($endAllClean) {
    $passed++;
    echo "  ✅ PASS: All 4 end() workers returned authoritative completed state without 503/errors\n";
} else {
    $failed++;
    echo "  ❌ FAIL: Some end() worker failed: " . json_encode($endOutputs) . "\n";
}

// ── Test 4: 4 Parallel Workers calling reset() simultaneously ──
echo "\n── Concurrency Test 4: 4 Parallel OS Processes calling reset() simultaneously ──\n";
$pin4 = '777884';
$s4 = createConcurrencySession($pin4);
$j4 = json_decode($controller->join(\Illuminate\Http\Request::create("/api/sessions/{$pin4}/join", 'POST', [
    'name' => 'ResetVictim',
    'avatar' => 'wizard',
]), $pin4)->getContent(), true);
$controller->start($pin4);
$s4->refresh();
$verBeforeReset = (int) $s4->state_version;
$resetOutputs = runParallelCommands(array_fill(0, 4, "php \"{$workerScript}\" \"{$tempDb}\" \"{$pin4}\" reset"), $rootDir);
$s4->refresh();
if (
    $s4->status === 'waiting' &&
    (int) $s4->state_version === $verBeforeReset + 1 &&
    $s4->players()->count() === 0
) {
    $passed++;
    echo "  ✅ PASS: 4 concurrent reset() calls transitioned ONCE (version {$verBeforeReset} -> {$s4->state_version}, 0 players)\n";
} else {
    $failed++;
    echo "  ❌ FAIL: reset() concurrency failed (status={$s4->status}, v={$s4->state_version}, players=" . $s4->players()->count() . ")\n";
}

// ── Test 5: end() racing simultaneously with next() and reveal() ──
echo "\n── Concurrency Test 5: end() racing with next() and reveal() ──\n";
$pin5 = '777885';
$s5 = createConcurrencySession($pin5);
$controller->start($pin5);
$s5->refresh();
$verBeforeRace5 = (int) $s5->state_version;
$race5Outputs = runParallelCommands([
    "php \"{$workerScript}\" \"{$tempDb}\" \"{$pin5}\" end",
    "php \"{$workerScript}\" \"{$tempDb}\" \"{$pin5}\" next 0",
    "php \"{$workerScript}\" \"{$tempDb}\" \"{$pin5}\" reveal",
], $rootDir);
$s5->refresh();
$no503Race5 = !in_array(false, array_map(fn($r) => isset($r['status_code']) && $r['status_code'] !== 503 && $r['status_code'] < 500, $race5Outputs), true);
if ($no503Race5 && (int) $s5->state_version === $verBeforeRace5 + 1) {
    $passed++;
    echo "  ✅ PASS: end() vs next() vs reveal() race had single atomic winner (version {$verBeforeRace5} -> {$s5->state_version}, status={$s5->status})\n";
} else {
    $failed++;
    echo "  ❌ FAIL: end() vs next() vs reveal() race failed (v={$s5->state_version}, outputs=" . json_encode($race5Outputs) . ")\n";
}

// ── Test 6: reset() racing simultaneously with join() and answer() ──
echo "\n── Concurrency Test 6: reset() racing with join() and answer() ──\n";
$pin6 = '777886';
$s6 = createConcurrencySession($pin6);
$j6 = json_decode($controller->join(\Illuminate\Http\Request::create("/api/sessions/{$pin6}/join", 'POST', [
    'name' => 'PreResetPlayer',
    'avatar' => 'robot',
]), $pin6)->getContent(), true);
$controller->start($pin6);
$s6->refresh();
$s6->update(['question_started_at' => (int) round(microtime(true) * 1000) - 2000]);
$q6 = $s6->currentQuestion();
$c6 = $q6->choices()->first();

$race6Outputs = runParallelCommands([
    "php \"{$workerScript}\" \"{$tempDb}\" \"{$pin6}\" reset",
    "php \"{$workerScript}\" \"{$tempDb}\" \"{$pin6}\" answer {$j6['player']['id']} {$c6->id} {$j6['player_token']}",
    "php \"{$workerScript}\" \"{$tempDb}\" \"{$pin6}\" join ConcurrentJoinerA",
    "php \"{$workerScript}\" \"{$tempDb}\" \"{$pin6}\" join ConcurrentJoinerB",
], $rootDir);
$s6->refresh();

// Check invariant: ZERO orphaned answers (answers pointing to deleted players)
$existingPlayerIds = DB::table('players')->where('game_session_id', $s6->id)->pluck('id')->toArray();
$sessionQuestionIds = $s6->questions()->pluck('id')->toArray();
$orphanAnswers = DB::table('answers')
    ->whereIn('question_id', $sessionQuestionIds)
    ->whereNotIn('player_id', empty($existingPlayerIds) ? [-1] : $existingPlayerIds)
    ->count();
$noServerErrRace6 = !in_array(false, array_map(fn($r) => isset($r['status_code']) && $r['status_code'] < 500, $race6Outputs), true);

if ($orphanAnswers === 0 && $noServerErrRace6 && $s6->status === 'waiting') {
    $passed++;
    echo "  ✅ PASS: reset() vs join() vs answer() preserved DB integrity (0 orphaned answers, status=waiting, players=" . count($existingPlayerIds) . ")\n";
} else {
    $failed++;
    echo "  ❌ FAIL: reset() race left orphans={$orphanAnswers}, status={$s6->status}, outputs=" . json_encode($race6Outputs) . "\n";
}

// ── Test 7: Concurrent end() and next(), then verifying completed cannot be revived ──
echo "\n── Concurrency Test 7: Concurrent end() and next() + post-completion guard ──\n";
$pin7 = '777887';
$s7 = createConcurrencySession($pin7);
$controller->start($pin7);
$s7->refresh();
$verBeforeRace7 = (int) $s7->state_version;
$race7Outputs = runParallelCommands([
    "php \"{$workerScript}\" \"{$tempDb}\" \"{$pin7}\" end",
    "php \"{$workerScript}\" \"{$tempDb}\" \"{$pin7}\" next 0",
    "php \"{$workerScript}\" \"{$tempDb}\" \"{$pin7}\" next 0",
], $rootDir);
$s7->refresh();
$no503Race7 = !in_array(false, array_map(fn($r) => isset($r['status_code']) && $r['status_code'] !== 503 && $r['status_code'] < 500, $race7Outputs), true);
if ($no503Race7 && (int) $s7->state_version === $verBeforeRace7 + 1) {
    $passed++;
    echo "  ✅ PASS: Concurrent end() + next() had single atomic transition (version {$verBeforeRace7} -> {$s7->state_version}, status={$s7->status})\n";
} else {
    $failed++;
    echo "  ❌ FAIL: Concurrent end() + next() failed (v={$s7->state_version}, outputs=" . json_encode($race7Outputs) . ")\n";
}

// Ensure session is completed (if next() won first, end() it now) and fire parallel next() workers against completed session
if ($s7->status !== 'completed') {
    $controller->end($pin7);
    $s7->refresh();
}
$verAtComplete7 = (int) $s7->state_version;
$idxAtComplete7 = (int) $s7->current_question_index;
$postCompleteNext = runParallelCommands(array_fill(0, 3, "php \"{$workerScript}\" \"{$tempDb}\" \"{$pin7}\" next {$idxAtComplete7}"), $rootDir);
$s7->refresh();
$allRejected409 = !in_array(false, array_map(fn($r) => ($r['status_code'] ?? 0) === 409 && ($r['body']['code'] ?? null) === 'SESSION_COMPLETED', $postCompleteNext), true);
if ($allRejected409 && $s7->status === 'completed' && (int) $s7->state_version === $verAtComplete7 && (int) $s7->current_question_index === $idxAtComplete7) {
    $passed++;
    echo "  ✅ PASS: Parallel next() on completed session all rejected (409), status=completed & version={$verAtComplete7} unchanged\n";
} else {
    $failed++;
    echo "  ❌ FAIL: Post-completion parallel next() mutated state (status={$s7->status}, v={$s7->state_version}/{$verAtComplete7}, outputs=" . json_encode($postCompleteNext) . ")\n";
}

// Cleanup temporary files
@unlink($workerScript);
@unlink($tempDb);
@unlink($tempDb . '-wal');
@unlink($tempDb . '-shm');

echo "\n╔══════════════════════════════════════════════════════════════╗\n";
echo "║  CONCURRENCY RESULTS: {$passed} passed, {$failed} failed                     ║\n";
echo "╚══════════════════════════════════════════════════════════════╝\n";

if ($failed > 0) {
    exit(1);
}
echo "\n🎉 Real Multi-Process Concurrency Test Passed!\n";
exit(0);
