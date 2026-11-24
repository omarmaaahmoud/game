/**
 * Tecorbi Kids Arena — Classroom Load Simulation (T4.4)
 * 
 * Simulates 1 teacher + 100 students through the full classroom quiz lifecycle:
 * 1. Teacher creates session (POST /api/sessions)
 * 2. 100 students join concurrently in lobby (POST /api/sessions/:pin/join)
 * 3. Teacher starts quiz (POST /api/sessions/:pin/start)
 * 4. 100 students poll state (GET /api/sessions/:pin/state)
 * 5. 100 students submit answers with realistic jitter (POST /api/sessions/:pin/answer)
 * 6. Duplicate answer attempts to verify idempotency / 409 ALREADY_ANSWERED handling
 * 7. Teacher reveals correct answer (POST /api/sessions/:pin/reveal)
 * 8. 100 students fetch individual results (GET /api/sessions/:pin/my-result)
 * 9. Teacher ends quiz (POST /api/sessions/:pin/end)
 * 10. 100 students fetch final podium results (GET /api/sessions/:pin/results)
 * 
 * Usage:
 *   node tests/load_test_classroom.js --url=http://127.0.0.1:8000 [--students=100]
 */

const args = process.argv.slice(2);
const urlArg = args.find(a => a.startsWith('--url='));
const studentsArg = args.find(a => a.startsWith('--students='));

if (!urlArg || !urlArg.split('=')[1]) {
  console.error('❌ Error: --url=<base_url> is required (no default URL to prevent accidental production hits).');
  console.error('   Usage: node tests/load_test_classroom.js --url=http://127.0.0.1:8000 [--students=100]');
  process.exit(1);
}

const BASE_URL = urlArg.split('=')[1].replace(/\/$/, '');
const STUDENT_COUNT = studentsArg ? parseInt(studentsArg.split('=')[1], 10) : 100;

const AVATARS = ['spongebob', 'patrick', 'squidward', 'sandy', 'mrkrabs', 'plankton', 'gary', 'pearl', 'lion', 'panda', 'fox', 'koala'];

class LatencyTracker {
  constructor() {
    this.durations = [];
    this.errors = 0;
  }

  record(ms, isError = false) {
    this.durations.push(ms);
    if (isError) this.errors++;
  }

  stats() {
    if (this.durations.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0, errors: this.errors };
    const sorted = [...this.durations].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.50)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const max = sorted[sorted.length - 1];
    return { count: sorted.length, p50: Math.round(p50), p95: Math.round(p95), p99: Math.round(p99), max: Math.round(max), errors: this.errors };
  }
}

const stats = {
  joins: new LatencyTracker(),
  answers: new LatencyTracker(),
  polls: new LatencyTracker(),
  myResults: new LatencyTracker(),
  finalResults: new LatencyTracker(),
};

async function timedFetch(url, options = {}, tracker = null, expectStatus = null) {
  const start = performance.now();
  try {
    const res = await fetch(url, options);
    const duration = performance.now() - start;
    const isOk = expectStatus !== null ? res.status === expectStatus : res.ok;
    if (tracker) tracker.record(duration, !isOk);
    return res;
  } catch (err) {
    const duration = performance.now() - start;
    if (tracker) tracker.record(duration, true);
    throw err;
  }
}

async function run() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Tecorbi Kids Arena — Classroom Load Simulation (100 Kids)   ║');
  console.log(`║  Target: ${BASE_URL.padEnd(51)}║`);
  console.log(`║  Students: ${String(STUDENT_COUNT).padEnd(49)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Verify server is reachable — exit non-zero on failure
  try {
    const health = await fetch(`${BASE_URL}/api/health`);
    if (!health.ok) {
      console.error(`❌ Error: Health check at ${BASE_URL}/api/health returned HTTP ${health.status}.`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`❌ Error: Server at ${BASE_URL} is unreachable (${err.message}).`);
    process.exit(1);
  }

  // 1. Teacher creates session
  console.log('Step 1: Teacher creates quiz session with 2 questions...');
  const createRes = await timedFetch(`${BASE_URL}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      teacher_name: 'Professor LoadTest',
      title: 'Classroom 100-Student Challenge',
      questions: [
        {
          question_text: 'What is 5 x 5?',
          question_text_ar: 'كم حاصل ضرب 5 في 5؟',
          time_limit: 20,
          choices: [
            { choice_text: '20', is_correct: false },
            { choice_text: '25', is_correct: true },
            { choice_text: '30', is_correct: false },
            { choice_text: '35', is_correct: false },
          ],
        },
        {
          question_text: 'Which planet is closest to the Sun?',
          question_text_ar: 'أي كوكب هو الأقرب للشمس؟',
          time_limit: 20,
          choices: [
            { choice_text: 'Mercury', is_correct: true },
            { choice_text: 'Venus', is_correct: false },
            { choice_text: 'Mars', is_correct: false },
            { choice_text: 'Jupiter', is_correct: false },
          ],
        },
      ],
    }),
  });

  if (!createRes.ok) {
    console.error('Failed to create session:', await createRes.text());
    process.exit(1);
  }

  const createData = await createRes.json();
  const pin = createData.pin;
  const teacherToken = createData.teacher_token;
  console.log(`✅ Session created: PIN=${pin}, teacher_token=${teacherToken ? '***' : 'missing'}\n`);

  // 2. 100 Students join concurrently
  console.log(`Step 2: Concurrently joining ${STUDENT_COUNT} students into lobby...`);
  const joinStart = performance.now();
  const students = [];

  const joinPromises = Array.from({ length: STUDENT_COUNT }, async (_, i) => {
    const studentNum = String(i + 1).padStart(3, '0');
    const name = `Kid_${studentNum}`;
    const avatar = AVATARS[i % AVATARS.length];

    const res = await timedFetch(`${BASE_URL}/api/sessions/${pin}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, avatar }),
    }, stats.joins);

    if (res.ok) {
      const data = await res.json();
      return {
        id: data.player?.id,
        name,
        token: data.player_token,
      };
    } else {
      console.error(`Failed to join ${name}:`, res.status, await res.text());
      return null;
    }
  });

  const joinedResults = await Promise.all(joinPromises);
  const activeStudents = joinedResults.filter(Boolean);
  const joinDuration = Math.round(performance.now() - joinStart);
  console.log(`✅ ${activeStudents.length}/${STUDENT_COUNT} students joined in ${joinDuration}ms\n`);

  // 3. Teacher starts quiz
  console.log('Step 3: Teacher starts quiz...');
  const startRes = await timedFetch(`${BASE_URL}/api/sessions/${pin}/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Teacher-Token': teacherToken,
    },
  });
  if (!startRes.ok) {
    console.error('Failed to start quiz:', await startRes.text());
    process.exit(1);
  }
  console.log('✅ Quiz started! Waiting 2s sync lead period...\n');
  await new Promise(r => setTimeout(r, 2200));

  // 4. Students poll state
  console.log(`Step 4: ${activeStudents.length} students poll session state...`);
  const pollPromises = activeStudents.map(s =>
    timedFetch(`${BASE_URL}/api/sessions/${pin}/state`, {
      headers: { 'X-Player-Token': s.token },
    }, stats.polls).then(r => r.json())
  );
  const pollStates = await Promise.all(pollPromises);
  const currentQ = pollStates[0]?.current_question;
  const qId = currentQ?.id;
  const choices = currentQ?.choices || [];
  console.log(`✅ State polled. Current Question #${pollStates[0]?.current_question_index + 1}: ${currentQ?.question_text}\n`);

  // 5. 100 Students submit answers with staggered jitter (200ms - 2000ms)
  console.log(`Step 5: ${activeStudents.length} students concurrently submit answers (staggered 200ms - 2000ms)...`);
  const ansStart = performance.now();
  const answerPromises = activeStudents.map(async (s, idx) => {
    // Artificial jitter: 50ms + random 0-1500ms
    const delay = 50 + Math.random() * 1500;
    await new Promise(r => setTimeout(r, delay));

    // Choose choice (majority pick right choice)
    const choice = idx % 5 === 0 ? (choices[0] || choices[1]) : (choices[1] || choices[0]);

    const res = await timedFetch(`${BASE_URL}/api/sessions/${pin}/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Player-Token': s.token,
      },
      body: JSON.stringify({
        player_id: s.id,
        question_id: qId,
        choice_id: choice.id,
      }),
    }, stats.answers);

    return { status: res.status, ok: res.ok };
  });

  const ansResults = await Promise.all(answerPromises);
  const ansDuration = Math.round(performance.now() - ansStart);
  const successAnswers = ansResults.filter(r => r.ok).length;
  console.log(`✅ ${successAnswers}/${activeStudents.length} answers accepted in ${ansDuration}ms\n`);

  // 6. Test duplicate answer handling under load
  console.log('Step 6: Testing duplicate answer idempotency (10 students re-submit)...');
  const dupPromises = activeStudents.slice(0, 10).map(async (s) => {
    const res = await timedFetch(`${BASE_URL}/api/sessions/${pin}/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Player-Token': s.token,
      },
      body: JSON.stringify({
        player_id: s.id,
        question_id: qId,
        choice_id: choices[0].id,
      }),
    });
    return res.status;
  });
  const dupStatuses = await Promise.all(dupPromises);
  const all409 = dupStatuses.every(st => st === 409);
  if (!all409) {
    console.error(`❌ Duplicate answer check FAILED: statuses=${JSON.stringify(dupStatuses)}`);
    process.exit(1);
  }
  console.log(`✅ Duplicate answer checks passed (HTTP 409 ALREADY_ANSWERED): ${all409}\n`);

  // 7. Teacher reveals correct answer
  console.log('Step 7: Teacher reveals correct answer...');
  const revealRes = await timedFetch(`${BASE_URL}/api/sessions/${pin}/reveal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Teacher-Token': teacherToken,
    },
  });
  if (!revealRes.ok) {
    console.error('Failed to reveal answer:', await revealRes.text());
    process.exit(1);
  } else {
    console.log('✅ Answer revealed!\n');
  }

  // 8. Students fetch individual results
  console.log(`Step 8: ${activeStudents.length} students fetch GET /my-result...`);
  const myResPromises = activeStudents.map(s =>
    timedFetch(`${BASE_URL}/api/sessions/${pin}/my-result?question_id=${qId}`, {
      headers: { 'X-Player-Token': s.token },
    }, stats.myResults).then(r => r.json())
  );
  const myResults = await Promise.all(myResPromises);
  const correctCount = myResults.filter(r => r.is_correct).length;
  console.log(`✅ Results fetched: ${correctCount} students answered correctly\n`);

  // 9. Teacher ends quiz
  console.log('Step 9: Teacher ends quiz...');
  await timedFetch(`${BASE_URL}/api/sessions/${pin}/end`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Teacher-Token': teacherToken,
    },
  });
  console.log('✅ Quiz ended!\n');

  // 10. Students fetch podium / results
  console.log(`Step 10: ${activeStudents.length} students fetch final /results...`);
  const finalPromises = activeStudents.map(s =>
    timedFetch(`${BASE_URL}/api/sessions/${pin}/results`, {}, stats.finalResults).then(r => r.json())
  );
  const finalResultsList = await Promise.all(finalPromises);
  const podium = finalResultsList[0]?.results || [];
  console.log(`✅ Final results fetched. Top 3 on podium:`);
  podium.slice(0, 3).forEach((p, idx) => {
    console.log(`   ${idx + 1}. ${p.name} — ${p.score} XP (Streak: ${p.streak})`);
  });

  // Print latency benchmark summary
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║               CLASSROOM LOAD BENCHMARK SUMMARY               ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║ Endpoint         Count    p50 (ms)  p95 (ms)  p99 (ms) Errors║');
  console.log('╟──────────────────────────────────────────────────────────────╢');
  let totalErrors = 0;
  for (const [name, tracker] of Object.entries(stats)) {
    const s = tracker.stats();
    totalErrors += s.errors;
    const line = `║ ${name.padEnd(16)} ${String(s.count).padEnd(8)} ${String(s.p50).padEnd(9)} ${String(s.p95).padEnd(9)} ${String(s.p99).padEnd(8)} ${String(s.errors).padEnd(6)}║`;
    console.log(line);
  }
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  if (activeStudents.length !== STUDENT_COUNT || successAnswers !== activeStudents.length || totalErrors > 0) {
    console.error(`❌ Load test finished with failures (joined=${activeStudents.length}/${STUDENT_COUNT}, answers=${successAnswers}/${activeStudents.length}, errors=${totalErrors})`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal load test error:', err);
  process.exit(1);
});
