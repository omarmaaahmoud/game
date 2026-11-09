import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

window.Pusher = Pusher;

let echoInstance = null;
const channelSubscriberCount = {};

/**
 * Returns a singleton Echo instance connected to Laravel Reverb.
 * Dynamically resolves the host based on window.location.hostname
 * so both localhost and mobile devices on local network work seamlessly.
 */
export function getEcho() {
  if (echoInstance) return echoInstance;

  const currentHost = window.location.hostname || '127.0.0.1';
  const reverbKey = import.meta.env.VITE_REVERB_APP_KEY || '8wrdb1nljzsyjjtschzi';
  const reverbPort = import.meta.env.VITE_REVERB_PORT || 8085;
  const reverbScheme = import.meta.env.VITE_REVERB_SCHEME || 'http';

  echoInstance = new Echo({
    broadcaster: 'reverb',
    key: reverbKey,
    wsHost: currentHost,
    wsPort: Number(reverbPort),
    wssPort: Number(reverbPort),
    forceTLS: reverbScheme === 'https',
    enabledTransports: ['ws', 'wss'],
    disableStats: true,
  });

  // Active reconnection guard: if connection drops or becomes unavailable, retry proactively
  const connection = echoInstance.connector?.pusher?.connection;
  if (connection) {
    let reconnectTimer = null;
    connection.bind('state_change', (states) => {
      if (states.current === 'unavailable' || states.current === 'disconnected') {
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (connection.state !== 'connected' && connection.state !== 'connecting') {
              console.log('[Echo] Proactive reconnection attempt to Reverb...');
              connection.connect();
            }
          }, 1200);
        }
      } else if (states.current === 'connected') {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      }
    });
  }

  return echoInstance;
}

/**
 * Helper to subscribe to a session channel and attach listeners.
 * Uses reference counting so screen transitions never drop active subscriptions prematurely.
 * Returns an unsubscribe cleanup function.
 */
export function subscribeToSession(pin, listeners = {}, onReconnect = null) {
  if (!pin) return () => {};

  const echo = getEcho();
  const channelName = `session.${pin}`;
  channelSubscriberCount[channelName] = (channelSubscriberCount[channelName] || 0) + 1;
  const channel = echo.channel(channelName);

  // Attach event listeners
  Object.entries(listeners).forEach(([eventName, handler]) => {
    channel.listen(`.${eventName}`, handler);
    channel.listen(eventName, handler);
  });

  // Handle reconnection sync
  const connection = echo.connector?.pusher?.connection;
  let stateHandler = null;

  if (connection && onReconnect) {
    stateHandler = (states) => {
      if (states.current === 'connected' && states.previous !== 'connected') {
        console.log('[Echo] Reconnected to Reverb. Synchronizing state...');
        onReconnect();
      }
    };
    connection.bind('state_change', stateHandler);
  }

  return () => {
    try {
      Object.keys(listeners).forEach((eventName) => {
        channel.stopListening(`.${eventName}`);
        channel.stopListening(eventName);
      });
      if (connection && stateHandler) {
        connection.unbind('state_change', stateHandler);
      }
      channelSubscriberCount[channelName] = Math.max(0, (channelSubscriberCount[channelName] || 1) - 1);
      if (channelSubscriberCount[channelName] === 0) {
        echo.leaveChannel(channelName);
      }
    } catch (e) {
      console.warn('[Echo] Error cleaning up channel:', e);
    }
  };
}
