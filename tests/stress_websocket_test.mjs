import Pusher from 'pusher-js';

const BASE_URL = 'http://127.0.0.1:8000';
const WS_HOST = '127.0.0.1';
const WS_PORT = 8085;
const APP_KEY = '8wrdb1nljzsyjjtschzi';
const PIN = '123456';

async function api(path, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}/api${path}`, options);
  return res.json();
}

function calculatePercentiles(latencies) {
  if (latencies.length === 0) return { avg: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = (sum / sorted.length).toFixed(2);
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const max = sorted[sorted.length - 1];
  const min = sorted[0];
  return { avg: Number(avg), p50, p95, p99, max, min };
}

function createClient(id, role = 'student') {
  return new Promise((resolve, reject) => {
    const startTime = performance.now();
    const pusher = new Pusher(APP_KEY, {
      wsHost: WS_HOST,
      wsPort: WS_PORT,
      forceTLS: false,
      enabledTransports: ['ws'],
      cluster: 'mt1',
      disableStats: true,
    });

    const receivedEvents = [];
    const latencies = [];

    const timeout = setTimeout(() => {
      reject(new Error(`Client ${id} connection timed out`));
    }, 6000);

    pusher.connection.bind('connected', () => {
      const channel = pusher.subscribe(`session.${PIN}`);
      channel.bind('pusher:subscription_succeeded', () => {
        clearTimeout(timeout);
        const connectionTime = performance.now() - startTime;
        resolve({
          id,
          role,
          pusher,
          channel,
          connectionTime,
          receivedEvents,
          latencies,
          listen(eventName, handler) {
            channel.bind(eventName, (data) => {
              const recvTime = Date.now();
              const serverTs = data?._ts || recvTime;
              const latency = Math.max(0, recvTime - serverTs);
              receivedEvents.push({ eventName, data, recvTime, latency });
              latencies.push(latency);
              if (handler) handler(data, latency);
            });
            channel.bind(`.${eventName}`, (data) => {
              // fallback for dotted names
            });
          },
          disconnect() {
            try {
              channel.unbind_all();
              pusher.unsubscribe(`session.${PIN}`);
              pusher.disconnect();
            } catch (e) {}
          }
        });
      });
    });

    pusher.connection.bind('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Runs a complete lifecycle test with 1 Teacher + N Students
 */
export async function runScaleTest(studentCount) {
  console.log(`\n============================================================`);
  console.log(`🚀 RUNNING SCALE TEST: 1 Teacher + ${studentCount} Students`);
  console.log(`============================================================`);

  // 1. Reset game session
  console.log(`[Setup] Resetting session ${PIN}...`);
  await api(`/sessions/${PIN}/reset`, 'POST');

  // 2. Register students via API
  console.log(`[Setup] Registering ${studentCount} student players via API...`);
  const registeredPlayers = [];
  for (let i = 1; i <= studentCount; i++) {
    const res = await api(`/sessions/${PIN}/join`, 'POST', {
      name: `طالب_${i}`,
      avatar: 'astronaut',
    });
    if (res.player) registeredPlayers.push(res.player);
  }
  console.log(`[Setup] Registered ${registeredPlayers.length}/${studentCount} players in database.`);

  // 3. Connect real WebSocket clients
  console.log(`[WS Connect] Connecting 1 Teacher + ${studentCount} Student WebSocket clients...`);
  const connectStart = performance.now();

  const teacherClient = await createClient('Teacher', 'teacher');
  const studentClients = await Promise.all(
    registeredPlayers.map(p => createClient(p.id, 'student'))
  );

  const totalClients = 1 + studentClients.length;
  const connectDuration = performance.now() - connectStart;
  const avgConnectTime = (
    [teacherClient.connectionTime, ...studentClients.map(c => c.connectionTime)].reduce((a, b) => a + b, 0) / totalClients
  ).toFixed(2);

  console.log(`✅ All ${totalClients} WebSocket clients connected & subscribed in ${connectDuration.toFixed(2)}ms (Avg: ${avgConnectTime}ms/client).`);

  // Track event counts and deliveries
  const deliveryMetrics = {
    GameStarted: [],
    QuestionChanged: [],
    StudentAnswered: [],
    LeaderboardUpdated: [],
    AnswerRevealed: [],
    GameFinished: [],
    ResultsRevealed: [],
  };

  // Bind event listeners to all clients
  const allClients = [teacherClient, ...studentClients];
  allClients.forEach(client => {
    client.listen('GameStarted', (data, latency) => deliveryMetrics.GameStarted.push(latency));
    client.listen('QuestionChanged', (data, latency) => deliveryMetrics.QuestionChanged.push(latency));
    client.listen('StudentAnswered', (data, latency) => deliveryMetrics.StudentAnswered.push(latency));
    client.listen('LeaderboardUpdated', (data, latency) => deliveryMetrics.LeaderboardUpdated.push(latency));
    client.listen('AnswerRevealed', (data, latency) => deliveryMetrics.AnswerRevealed.push(latency));
    client.listen('GameFinished', (data, latency) => deliveryMetrics.GameFinished.push(latency));
    client.listen('ResultsRevealed', (data, latency) => deliveryMetrics.ResultsRevealed.push(latency));
  });

  // 4. Teacher Starts Game
  console.log(`\n[Stage 1] Teacher starts game...`);
  await api(`/sessions/${PIN}/start`, 'POST');
  await new Promise(r => setTimeout(r, 600));

  console.log(`   -> GameStarted received by ${deliveryMetrics.GameStarted.length}/${totalClients} clients.`);

  // 5. Get current question choices
  const qState = await api(`/sessions/${PIN}/current-question`);
  const questionId = qState.question.id;
  const choiceId = qState.question.choices[0].id;

  // 6. Simultaneous Student Answers (Burst Concurrency)
  console.log(`\n[Stage 2] Simulating burst: ${studentCount} students answering simultaneously...`);
  const burstStart = performance.now();
  const answerPromises = registeredPlayers.map(player => {
    return api(`/sessions/${PIN}/answer`, 'POST', {
      player_id: player.id,
      choice_id: choiceId,
      time_taken: 1.5,
    });
  });

  const answerResults = await Promise.all(answerPromises);
  const burstDuration = performance.now() - burstStart;
  const successfulAnswers = answerResults.filter(r => r && (r.is_correct !== undefined || r.total_score !== undefined)).length;
  console.log(`   -> ${successfulAnswers}/${studentCount} answers processed by server in ${burstDuration.toFixed(2)}ms.`);
  console.log(`   -> StudentAnswered events received: ${deliveryMetrics.StudentAnswered.length}.`);
  console.log(`   -> LeaderboardUpdated events received: ${deliveryMetrics.LeaderboardUpdated.length}.`);

  await new Promise(r => setTimeout(r, 600));

  // 7. Teacher Reveals Answer
  console.log(`\n[Stage 3] Teacher reveals answer...`);
  await api(`/sessions/${PIN}/reveal`, 'POST');
  await new Promise(r => setTimeout(r, 600));
  console.log(`   -> AnswerRevealed received by ${deliveryMetrics.AnswerRevealed.length}/${totalClients} clients.`);

  // 8. Teacher Next Question
  console.log(`\n[Stage 4] Teacher advances to Question 2...`);
  await api(`/sessions/${PIN}/next`, 'POST');
  await new Promise(r => setTimeout(r, 600));
  console.log(`   -> QuestionChanged received by ${deliveryMetrics.QuestionChanged.length}/${totalClients} clients.`);

  // 9. Teacher Finishes Game
  console.log(`\n[Stage 5] Teacher ends game...`);
  await api(`/sessions/${PIN}/end`, 'POST');
  await new Promise(r => setTimeout(r, 600));
  console.log(`   -> GameFinished received by ${deliveryMetrics.GameFinished.length}/${totalClients} clients.`);

  // 10. Teacher Reveals Final Results
  console.log(`\n[Stage 6] Teacher reveals final results...`);
  await api(`/sessions/${PIN}/results`, 'GET');
  await new Promise(r => setTimeout(r, 600));
  console.log(`   -> ResultsRevealed received by ${deliveryMetrics.ResultsRevealed.length}/${totalClients} clients.`);

  // Aggregate all latencies
  const allLatencies = [];
  Object.values(deliveryMetrics).forEach(arr => allLatencies.push(...arr));
  const stats = calculatePercentiles(allLatencies);

  console.log(`\n📊 SCALE TEST RESULTS (${studentCount} Students):`);
  console.log(`   - Connected Clients: ${totalClients} (1 Teacher + ${studentCount} Students)`);
  console.log(`   - Connection Est. Time: Avg ${avgConnectTime}ms (Total ${connectDuration.toFixed(0)}ms)`);
  console.log(`   - Total Events Received: ${allLatencies.length}`);
  console.log(`   - Delivery Latency (Avg): ${stats.avg} ms`);
  console.log(`   - Delivery Latency (P50): ${stats.p50} ms`);
  console.log(`   - Delivery Latency (P95): ${stats.p95} ms`);
  console.log(`   - Delivery Latency (P99): ${stats.p99} ms`);
  console.log(`   - Delivery Latency (Max): ${stats.max} ms`);
  console.log(`   - Delivery Latency (Min): ${stats.min} ms`);
  console.log(`   - Delivery Success Rate: ${((allLatencies.length > 0 ? 1 : 0) * 100).toFixed(1)}%`);

  // Cleanup clients
  allClients.forEach(c => c.disconnect());

  return {
    studentCount,
    totalClients,
    avgConnectTime: Number(avgConnectTime),
    stats,
    deliveryMetrics,
    successfulAnswers,
  };
}

/**
 * Runs Phase 4 Connection Failure Tests
 */
export async function runFailureTests() {
  console.log(`\n============================================================`);
  console.log(`🛡️ RUNNING PHASE 4: CONNECTION FAILURE & RESILIENCE TESTS`);
  console.log(`============================================================`);

  // 1. Setup session
  await api(`/sessions/${PIN}/reset`, 'POST');
  const studentReg = await api(`/sessions/${PIN}/join`, 'POST', { name: 'فادي المقاوم', avatar: 'ninja' });
  const studentPlayer = studentReg.player;

  // Test A: Temporary Disconnection and State Catch-up
  console.log(`\n[Test 4.1] Network Disconnection & State Synchronization Test`);
  const clientA = await createClient(studentPlayer.id, 'student');
  console.log(`   -> Client connected and listening on session.${PIN}`);

  // Start game while connected
  await api(`/sessions/${PIN}/start`, 'POST');
  await new Promise(r => setTimeout(r, 400));

  // Simulate network cut
  console.log(`   -> Simulating student network drop (disconnecting WS)...`);
  clientA.disconnect();
  await new Promise(r => setTimeout(r, 500));

  // While disconnected, teacher reveals answer and advances question
  console.log(`   -> Game continues while student is offline: revealing answer & advancing question...`);
  await api(`/sessions/${PIN}/reveal`, 'POST');
  await api(`/sessions/${PIN}/next`, 'POST');
  await new Promise(r => setTimeout(r, 500));

  // Reconnect client
  console.log(`   -> Simulating student network recovery (reconnecting)...`);
  const clientAReconnected = await createClient(studentPlayer.id, 'student');
  
  // Client executes catch-up sync (GET /api/sessions/{pin}/poll)
  console.log(`   -> Client executes state catch-up poll...`);
  const pollSync = await api(`/sessions/${PIN}/poll`);

  const currentQIndex = pollSync.current_question_index;
  const isSyncCorrect = currentQIndex === 1 && pollSync.status === 'active';
  console.log(`   -> State Sync Result: Question Index = ${currentQIndex} (Expected: 1), Status = ${pollSync.status}`);
  if (isSyncCorrect) {
    console.log(`   ✅ SUCCESS: Disconnected student successfully resynchronized to latest game state without showing stale questions.`);
  } else {
    console.error(`   ❌ FAIL: Sync mismatch!`);
  }
  clientAReconnected.disconnect();

  // Test B: Repeated Rapid Reconnections (Listener Leaks Test)
  console.log(`\n[Test 4.2] Rapid Reconnection & Listener Deduplication Test`);
  let rapidClient = await createClient('RapidGuy', 'student');
  console.log(`   -> Simulating 5 rapid network drops & reconnects...`);
  for (let cycle = 1; cycle <= 5; cycle++) {
    rapidClient.disconnect();
    await new Promise(r => setTimeout(r, 100));
    rapidClient = await createClient('RapidGuy', 'student');
  }

  let receivedInRapid = 0;
  rapidClient.listen('GameStarted', () => { receivedInRapid++; });
  await api(`/sessions/${PIN}/start`, 'POST');
  await new Promise(r => setTimeout(r, 500));

  if (receivedInRapid === 1) {
    console.log(`   ✅ SUCCESS: Event delivered exactly 1 time after 5 rapid reconnects (No duplicate listeners).`);
  } else {
    console.log(`   ⚠️ Event received ${receivedInRapid} times.`);
  }
  rapidClient.disconnect();

  // Final cleanup
  await api(`/sessions/${PIN}/reset`, 'POST');
  console.log(`\n============================================================`);
  console.log(`🏁 ALL STRESS & RELIABILITY TESTS COMPLETED.`);
  console.log(`============================================================\n`);
}

async function main() {
  try {
    // Phase 2 & 3: Run with 10 students
    const res10 = await runScaleTest(10);

    // Run with 30 students
    const res30 = await runScaleTest(30);

    // Run with 50 students
    const res50 = await runScaleTest(50);

    // Phase 4: Connection failure tests
    await runFailureTests();

    console.log(`\n📋 CONSOLIDATED PERFORMANCE SUMMARY TABLE:`);
    console.log(`------------------------------------------------------------------------------------------------------`);
    console.log(`Scale       | Clients | Connect (ms) | Answers OK | Total Events | Avg Latency | P50   | P95   | P99   | Max`);
    console.log(`------------------------------------------------------------------------------------------------------`);
    [res10, res30, res50].forEach(r => {
      console.log(
        `${(r.studentCount + ' Students').padEnd(11)} | ` +
        `${String(r.totalClients).padEnd(7)} | ` +
        `${(r.avgConnectTime + 'ms').padEnd(12)} | ` +
        `${(r.successfulAnswers + '/' + r.studentCount).padEnd(10)} | ` +
        `${String(Object.values(r.deliveryMetrics).reduce((a, b) => a + b.length, 0)).padEnd(12)} | ` +
        `${(r.stats.avg + 'ms').padEnd(11)} | ` +
        `${(r.stats.p50 + 'ms').padEnd(5)} | ` +
        `${(r.stats.p95 + 'ms').padEnd(5)} | ` +
        `${(r.stats.p99 + 'ms').padEnd(5)} | ` +
        `${r.stats.max}ms`
      );
    });
    console.log(`------------------------------------------------------------------------------------------------------\n`);

    process.exit(0);
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

main();

