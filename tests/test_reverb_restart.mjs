import Pusher from 'pusher-js';

const WS_HOST = '127.0.0.1';
const WS_PORT = 8085;
const APP_KEY = '8wrdb1nljzsyjjtschzi';
const PIN = '123456';

console.log('=== TESTING REVERB RESTART RECOVERY WITH ACTIVE RECONNECT ===');

const pusher = new Pusher(APP_KEY, {
  wsHost: WS_HOST,
  wsPort: WS_PORT,
  forceTLS: false,
  enabledTransports: ['ws'],
  cluster: 'mt1',
  disableStats: true,
});

let connectedCount = 0;
let subscriptionCount = 0;
let reconnectTimer = null;

pusher.connection.bind('state_change', (states) => {
  console.log(`[Pusher State] ${states.previous} -> ${states.current}`);
  if (states.current === 'connected') {
    connectedCount++;
    console.log(`[State Connected #${connectedCount}]`);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  } else if (states.current === 'unavailable' || states.current === 'disconnected') {
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (pusher.connection.state !== 'connected') {
          console.log('[Test Client] Proactive reconnect call...');
          pusher.connect();
        }
      }, 1000);
    }
  }
});

const channel = pusher.subscribe(`session.${PIN}`);
channel.bind('pusher:subscription_succeeded', () => {
  subscriptionCount++;
  console.log(`[Subscription #${subscriptionCount}] Channel session.${PIN} subscription confirmed.`);
  if (subscriptionCount >= 2) {
    console.log('🎉 VERIFIED: Successfully reconnected and resubscribed to channel after Reverb restart!');
    pusher.disconnect();
    process.exit(0);
  }
});

// Safety timeout
setTimeout(() => {
  console.log(`Final Result: subscriptions=${subscriptionCount}, connected=${connectedCount}`);
  pusher.disconnect();
  process.exit(subscriptionCount >= 2 ? 0 : 1);
}, 45000);
