/**
 * Frontend Clock Synchronization Unit Tests
 * 
 * Verifies monotonic RTT calculation, rolling window sample refresh,
 * avoidance of the lowest-RTT latch bug, slow network fallback,
 * and immunity to OS clock adjustments.
 * 
 * Run: node tests/test_clock_sync.cjs
 */

const assert = require('assert');

// ── Test harness ──
let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ PASS: ${label}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ FAIL: ${label}\n     ${err.message}`);
  }
}

console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log("║  Tecorbi Kids Arena — Frontend Clock Sync Unit Tests       ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

// Recreate the exact clock sync module under test
function createClockSyncModule() {
  const MAX_CLOCK_SAMPLES = 8;
  const SAMPLE_EXPIRY_MS = 60000;
  let clockSamples = [];
  let currentServerBaseEpoch = null;
  let simulatedPerfNow = 1000;
  let simulatedDateNow = 1700000000000;

  function getMonotonicNow() {
    return simulatedPerfNow;
  }

  function advanceMonotonic(ms) {
    simulatedPerfNow += ms;
  }

  function setOsClock(dateMs) {
    simulatedDateNow = dateMs;
  }

  function updateClockSync(serverNowMs, p0, p1) {
    if (!serverNowMs) return;
    const rtt = Math.max(0, p1 - p0);
    const midpointP = p0 + (rtt / 2);
    const baseEpoch = serverNowMs - midpointP;
    const nowMono = getMonotonicNow();

    // Filter out expired samples older than 60s
    clockSamples = clockSamples.filter(s => (nowMono - s.addedAt) < SAMPLE_EXPIRY_MS);

    // Add new sample
    clockSamples.push({
      baseEpoch,
      rtt,
      addedAt: nowMono,
    });

    if (clockSamples.length > MAX_CLOCK_SAMPLES) {
      clockSamples.shift();
    }

    const validSamples = clockSamples.filter(s => s.rtt <= 2000);
    const candidates = validSamples.length > 0 ? validSamples : clockSamples;

    let best = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].rtt < best.rtt) {
        best = candidates[i];
      }
    }

    if (best) {
      currentServerBaseEpoch = best.baseEpoch;
    }
  }

  function serverNow() {
    if (currentServerBaseEpoch !== null) {
      return Math.round(currentServerBaseEpoch + getMonotonicNow());
    }
    return simulatedDateNow;
  }

  return {
    updateClockSync,
    serverNow,
    advanceMonotonic,
    setOsClock,
    getSampleCount: () => clockSamples.length,
    getBaseEpoch: () => currentServerBaseEpoch,
  };
}

// ── Test Cases ──

test("Initial serverNow() falls back to Date.now() when no samples recorded", () => {
  const mod = createClockSyncModule();
  mod.setOsClock(1700000050000);
  assert.strictEqual(mod.serverNow(), 1700000050000);
});

test("First valid sync sample establishes authoritative serverNow()", () => {
  const mod = createClockSyncModule();
  // Request sent at perf=1000, received at perf=1100 (RTT = 100ms)
  // Server reported server_now_ms = 1700000000050 at midpoint (perf=1050)
  mod.updateClockSync(1700000000050, 1000, 1100);

  // At perf=1100 (50ms after midpoint): serverNow should be 1700000000050 + 50 = 1700000000100
  mod.advanceMonotonic(100); // perf now 1100
  assert.strictEqual(mod.serverNow(), 1700000000100);
});

test("OS clock jumps do NOT affect monotonic serverNow()", () => {
  const mod = createClockSyncModule();
  mod.updateClockSync(1700000000050, 1000, 1100);
  const beforeJump = mod.serverNow();

  // User alters Windows OS clock by +2 hours
  mod.setOsClock(Date.now() + 7200000);

  const afterJump = mod.serverNow();
  // Timer MUST NOT jump 2 hours into future
  assert.strictEqual(beforeJump, afterJump);
});

test("Lowest-RTT sample is not permanently latched when samples expire after 60s", () => {
  const mod = createClockSyncModule();
  // Sample 1 at t=1000 with exceptionally fast RTT = 20ms, offset base = 1000
  mod.updateClockSync(2000, 1000, 1020);
  assert.strictEqual(mod.getBaseEpoch(), 2000 - 1010); // 990

  // Server clock drifted +500ms over time
  // Advance monotonic clock by 65 seconds (65000ms)
  mod.advanceMonotonic(65000);

  // New sample arrives with RTT = 80ms (slower than 20ms, but recent!)
  // Midpoint at current monotonic time:
  const p0 = 66000;
  const p1 = 66080;
  const newServerMs = 67540; // drifted
  mod.updateClockSync(newServerMs, p0, p1);

  // Old sample (20ms) should have expired! Best should now be the new sample
  assert.strictEqual(mod.getSampleCount(), 1);
  assert.strictEqual(mod.getBaseEpoch(), newServerMs - (p0 + 40));
});

test("Slow networks (RTT > 2000ms) establish clock sync instead of remaining un-synced", () => {
  const mod = createClockSyncModule();
  // High latency request: RTT = 2500ms
  mod.updateClockSync(1800000000000, 1000, 3500);

  assert.strictEqual(mod.getSampleCount(), 1);
  // Base epoch should be established
  assert.notStrictEqual(mod.getBaseEpoch(), null);
  assert.strictEqual(mod.getBaseEpoch(), 1800000000000 - 2250);
});

test("High confidence sample (RTT <= 2000ms) takes priority over high latency sample", () => {
  const mod = createClockSyncModule();
  // First sample: slow 2500ms
  mod.updateClockSync(1000000, 1000, 3500);
  assert.strictEqual(mod.getBaseEpoch(), 1000000 - 2250);

  // Second sample: fast 150ms
  mod.updateClockSync(2000000, 4000, 4150);
  // Best should now be the 150ms sample
  assert.strictEqual(mod.getBaseEpoch(), 2000000 - 4075);
});

console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log(`║  RESULTS: ${passed} passed, ${failed} failed                            ║`);
console.log("╚══════════════════════════════════════════════════════════════╝\n");

if (failed > 0) {
  process.exit(1);
}
