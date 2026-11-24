import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

window.Pusher = Pusher;

let echoInstance = null;
const channelSubscriberCount = {};
const channelLeaveTimers = {};

/**
 * Returns a singleton Echo instance connected to Laravel Reverb.
 * Dynamically resolves the host based on window.location.hostname
 * so both localhost and mobile devices on local network work seamlessly.
 */
export function getEcho() {
  if (echoInstance) return echoInstance;

  const reverbKey = import.meta.env.VITE_REVERB_APP_KEY;
  if (!reverbKey) {
    console.warn('[Echo] VITE_REVERB_APP_KEY is not set — WebSocket disabled. Polling will be used.');
    return null;
  }
  const reverbHost = import.meta.env.VITE_REVERB_HOST || window.location.hostname || '127.0.0.1';
  const reverbPort = import.meta.env.VITE_REVERB_PORT || 8085;
  const reverbScheme = import.meta.env.VITE_REVERB_SCHEME || 'http';

  echoInstance = new Echo({
    broadcaster: 'reverb',
    key: reverbKey,
    wsHost: reverbHost,
    wsPort: Number(reverbPort),
    wssPort: Number(reverbPort),
    forceTLS: window.location.protocol === 'https:' || reverbScheme === 'https',
    enabledTransports: ['ws', 'wss'],
    disableStats: true,
  });

  // Active reconnection guard with exponential backoff & jitter (R2.6)
  const connection = echoInstance.connector?.pusher?.connection;
  if (connection) {
    let reconnectAttempts = 0;
    let reconnectTimer = null;

    const scheduleReconnect = () => {
      if (reconnectTimer) return;
      reconnectAttempts++;
      // Backoff: 1s, 2s, 4s, max 10s + jitter
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 10000) + Math.random() * 500;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (connection.state !== 'connected' && connection.state !== 'connecting') {
          console.log(`[Echo] Reconnecting to Reverb (attempt #${reconnectAttempts}, delay ${Math.round(delay)}ms)...`);
          connection.connect();
        }
      }, delay);
    };

    connection.bind('state_change', (states) => {
      if (states.current === 'unavailable' || states.current === 'disconnected') {
        scheduleReconnect();
      } else if (states.current === 'connected') {
        reconnectAttempts = 0;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      }
    });

    connection.bind('error', () => {
      scheduleReconnect();
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
  if (!echo) return () => {}; // WebSocket disabled — polling-only mode
  const channelName = `session.${pin}`;

  // If a delayed leave was pending for this channel, cancel it
  if (channelLeaveTimers[channelName]) {
    clearTimeout(channelLeaveTimers[channelName]);
    delete channelLeaveTimers[channelName];
  }

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
      // Unsubscribe specific handlers
      Object.entries(listeners).forEach(([eventName, handler]) => {
        channel.stopListening(`.${eventName}`, handler);
        channel.stopListening(eventName, handler);
      });
      if (connection && stateHandler) {
        connection.unbind('state_change', stateHandler);
      }
      channelSubscriberCount[channelName] = Math.max(0, (channelSubscriberCount[channelName] || 1) - 1);

      // Delay leave by 1500ms on unmount so fast component transitions don't thrash socket (R2.6)
      if (channelSubscriberCount[channelName] === 0) {
        if (channelLeaveTimers[channelName]) {
          clearTimeout(channelLeaveTimers[channelName]);
        }
        channelLeaveTimers[channelName] = setTimeout(() => {
          if (channelSubscriberCount[channelName] === 0) {
            echo.leaveChannel(channelName);
          }
          delete channelLeaveTimers[channelName];
        }, 1500);
      }
    } catch (e) {
      console.warn('[Echo] Error cleaning up channel:', e);
    }
  };
}
