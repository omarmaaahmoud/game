<?php
/**
 * Genuine Multi-Process Concurrency Test for SQLite
 * 
 * Spawns multiple parallel OS processes (PHP CLI) executing simultaneous
 * next() and pause() operations on a temporary SQLite database file with WAL mode.
 * 
 * Verifies that:
 * 1. Concurrent next() calls with the same expected_index NEVER advance the question more than once.
 * 2. Concurrent pause() calls NEVER corrupt or reduce the remaining time.
 * 3. SQLite concurrency, WAL, and busy_timeout operate safely under parallel process contention.
 * 
 * Run: php tests/test_concurrency_multiprocess.php
 */

$tempDb = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'quiz_concurrency_test_' . uniqid() . '.sqlite';
touch($tempDb);

echo "\n╔══════════════════════════════════════════════════════════════╗\n";
echo "║  Tecorbi Kids Arena — Multi-Process Concurrency Test        ║\n";
echo "║  Target: Temporary SQLite file (isolated from production)  ║\n";
echo "╚══════════════════════════════════════════════════════════════╝\n\n";

// Set environment for test setup
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
use App\Models\GameSession;

Artisan::call('migrate', ['--force' => true]);

$pin = '777888';
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

$controller = new \App\Http\Controllers\SessionController();
$controller->start($pin);
$session->refresh();

// ── Multi-Process Test 1: 4 Parallel Workers calling next(expected_index=0) ──
echo "── Concurrency Test 1: 4 Parallel OS Processes calling next() simultaneously ──\n";

$workerScript = __DIR__ . DIRECTORY_SEPARATOR . 'worker_concurrency.php';
$workerCode = <<< 'PHP'
<?php
$tempDb = $argv[1];
$pin = $argv[2];
$action = $argv[3];
$expectedIndex = isset($argv[4]) ? (int)$argv[4] : 0;

putenv("DB_CONNECTION=sqlite");
putenv("DB_DATABASE={$tempDb}");
putenv("DB_BUSY_TIMEOUT=5000");
putenv("DB_JOURNAL_MODE=WAL");
putenv("DB_SYNCHRONOUS=NORMAL");
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

\Illuminate\Support\Facades\DB::connection()->getPdo()->exec('PRAGMA busy_timeout = 5000;');
\Illuminate\Support\Facades\DB::connection()->getPdo()->exec('PRAGMA journal_mode = WAL;');

$controller = new \App\Http\Controllers\SessionController();

if ($action === 'next') {
    $req = new \Illuminate\Http\Request();
    $req->merge(['expected_index' => $expectedIndex]);
    app()->instance('request', $req);
    $resp = $controller->next($req, $pin);
    echo $resp->getContent();
} elseif ($action === 'pause') {
    $resp = $controller->pause($pin);
    echo $resp->getContent();
}
PHP;

file_put_contents($workerScript, $workerCode);

$rootDir = realpath(__DIR__ . '/..');
$cmd = "php \"{$workerScript}\" \"{$tempDb}\" \"{$pin}\" next 0";

// Launch 4 distinct OS processes simultaneously using file redirects (avoids Windows pipe deadlocks)
$procs = [];
$outFiles = [];
$errFiles = [];
for ($i = 0; $i < 4; $i++) {
    $outFiles[$i] = sys_get_temp_dir() . DIRECTORY_SEPARATOR . "worker_out_{$i}_" . uniqid() . ".json";
    $errFiles[$i] = sys_get_temp_dir() . DIRECTORY_SEPARATOR . "worker_err_{$i}_" . uniqid() . ".log";
    $desc = [
        0 => ['file', 'NUL', 'r'],
        1 => ['file', $outFiles[$i], 'w'],
        2 => ['file', $errFiles[$i], 'w'],
    ];
    $procs[$i] = proc_open($cmd, $desc, $pipes, $rootDir);
}

// Wait for all 4 workers to finish
$outputs = [];
for ($i = 0; $i < 4; $i++) {
    proc_close($procs[$i]);
    $content = file_exists($outFiles[$i]) ? file_get_contents($outFiles[$i]) : '';
    $err = file_exists($errFiles[$i]) ? file_get_contents($errFiles[$i]) : '';
    if (!empty($err)) {
        echo "Worker {$i} STDERR: {$err}\n";
    }
    @unlink($outFiles[$i]);
    @unlink($errFiles[$i]);
    $outputs[$i] = json_decode($content, true);
}

$session->refresh();
$finalIndex = (int) $session->current_question_index;

$passed = 0;
$failed = 0;

if ($finalIndex === 1) {
    $passed++;
    echo "  ✅ PASS: 4 concurrent next(expected_index=0) advanced question EXACTLY ONCE (final index = 1)\n";
} else {
    $failed++;
    echo "  ❌ FAIL: 4 concurrent next(expected_index=0) advanced to index {$finalIndex} (race condition!)\n";
}

// Verify responses: all returned valid state
$allResponsesValid = true;
foreach ($outputs as $i => $data) {
    if (!isset($data['current_question_index'])) {
        $allResponsesValid = false;
        echo "  ❌ Worker {$i} returned invalid response\n";
    }
}
if ($allResponsesValid) {
    $passed++;
    echo "  ✅ PASS: All 4 concurrent workers received clean JSON state responses\n";
} else {
    $failed++;
}

// ── Multi-Process Test 2: 4 Parallel Workers calling pause() simultaneously ──
echo "\n── Concurrency Test 2: 4 Parallel OS Processes calling pause() simultaneously ──\n";

$session->update(['question_started_at' => (int)round(microtime(true) * 1000) - 5000]); // 5s into question
$cmdPause = "php \"{$workerScript}\" \"{$tempDb}\" \"{$pin}\" pause";

$procs = [];
$pauseOutFiles = [];
for ($i = 0; $i < 4; $i++) {
    $pauseOutFiles[$i] = sys_get_temp_dir() . DIRECTORY_SEPARATOR . "worker_pause_out_{$i}_" . uniqid() . ".json";
    $desc = [
        0 => ['file', 'NUL', 'r'],
        1 => ['file', $pauseOutFiles[$i], 'w'],
        2 => ['file', 'NUL', 'w'],
    ];
    $procs[$i] = proc_open($cmdPause, $desc, $pipes, $rootDir);
}

$pauseOutputs = [];
for ($i = 0; $i < 4; $i++) {
    proc_close($procs[$i]);
    $content = file_exists($pauseOutFiles[$i]) ? file_get_contents($pauseOutFiles[$i]) : '';
    @unlink($pauseOutFiles[$i]);
    $pauseOutputs[$i] = json_decode($content, true);
}

$session->refresh();
if ($session->status === 'paused') {
    $passed++;
    echo "  ✅ PASS: Session status is safely 'paused' after 4 concurrent pause calls\n";
} else {
    $failed++;
    echo "  ❌ FAIL: Session status is not paused\n";
}

// Check that remaining duration was preserved around 15s (not reduced to 0 by duplicate pauses)
$rem = $session->question_paused_remaining_ms;
if ($rem >= 14000 && $rem <= 16000) {
    $passed++;
    echo "  ✅ PASS: Remaining time preserved safely ({$rem}ms ≈ 15000ms) under concurrent pause calls\n";
} else {
    $failed++;
    echo "  ❌ FAIL: Remaining time corrupted ({$rem}ms)\n";
}

// Cleanup temporary files
@unlink($workerScript);
@unlink($tempDb);
@unlink($tempDb . '-wal');
@unlink($tempDb . '-shm');

echo "\n╔══════════════════════════════════════════════════════════════╗\n";
echo "║  CONCURRENCY RESULTS: {$passed} passed, {$failed} failed                      ║\n";
echo "╚══════════════════════════════════════════════════════════════╝\n";

if ($failed > 0) {
    exit(1);
}
echo "\n🎉 Real Multi-Process Concurrency Test Passed!\n";
exit(0);
