import { ref, onUnmounted } from 'vue';

const BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api');

export interface SSEEvent {
  type: string;
  id?: string;
  timestamp?: string;
  [key: string]: unknown;
}

// ─── Singleton SSE connection ───
const connected = ref(false);
const lastEvent = ref<SSEEvent | null>(null);
const listeners = new Map<string, Set<(event: SSEEvent) => void>>();
let source: EventSource | null = null;
let refCount = 0;

function ensureConnected() {
  if (source) return;
  source = new EventSource(`${BASE}/events`);

  source.onopen = () => { connected.value = true; };

  source.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data) as SSEEvent;
      lastEvent.value = event;

      const typeListeners = listeners.get(event.type);
      if (typeListeners) {
        for (const fn of typeListeners) fn(event);
      }
      const allListeners = listeners.get('*');
      if (allListeners) {
        for (const fn of allListeners) fn(event);
      }
    } catch {
      // Ignore non-JSON messages (keep-alive)
    }
  };

  source.onerror = () => { connected.value = false; };
}

function disconnectIfUnused() {
  if (refCount <= 0 && source) {
    source.close();
    source = null;
    connected.value = false;
  }
}

/**
 * Composable for SSE events. Uses a singleton connection shared across all components.
 * Listeners registered via on() are automatically cleaned up on component unmount.
 */
export function useSSE() {
  refCount++;
  ensureConnected();

  // Track this component's listeners for cleanup
  const localCleanups: Array<() => void> = [];

  function on(type: string, fn: (event: SSEEvent) => void) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
    const cleanup = () => listeners.get(type)?.delete(fn);
    localCleanups.push(cleanup);
    return cleanup;
  }

  onUnmounted(() => {
    for (const cleanup of localCleanups) cleanup();
    refCount--;
    disconnectIfUnused();
  });

  return { connected, lastEvent, on };
}
