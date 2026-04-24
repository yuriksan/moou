import { ref } from 'vue';
import { api } from './useApi';

export type ConnectionState = 'connected' | 'checking' | 'disconnected' | 'auth_expired' | 'idle';

export const connectionState = ref<ConnectionState>('idle');

let intervalId: ReturnType<typeof setInterval> | undefined;
let started = false;
let stopped = false;

const BASE = import.meta.env.VITE_API_URL || '/api';

/**
 * Start polling the provider health check at the interval specified by the provider.
 * Call once from App.vue after authentication.
 * If the provider returns healthCheckIntervalMs = null, no polling occurs.
 */
export async function startConnectionMonitor() {
  if (started) return;
  started = true;
  stopped = false;

  try {
    const provider = await api.getProvider();
    const intervalMs = provider.healthCheckIntervalMs;
    if (intervalMs == null) {
      // Provider doesn't need keepalive — always connected
      connectionState.value = 'connected';
      return;
    }

    // Initial check
    await checkNow();

    // Poll at provider-specified interval
    intervalId = setInterval(checkNow, intervalMs);
  } catch {
    // Can't reach provider endpoint — reset so retry is possible
    started = false;
  }
}

export async function checkNow() {
  connectionState.value = 'checking';
  try {
    const res = await fetch(`${BASE}/provider/health`, { credentials: 'include', cache: 'no-store' });
    if (stopped) return; // monitor was stopped while request was in-flight
    if (res.status === 401) {
      // Token has expired — signal auth_expired so App.vue can redirect to login
      connectionState.value = 'auth_expired';
      return;
    }
    if (!res.ok) {
      connectionState.value = 'disconnected';
      return;
    }
    const data = await res.json();
    if (stopped) return;
    connectionState.value = data.connected ? 'connected' : 'disconnected';
  } catch {
    // Network error — don't treat as auth failure
    if (!stopped) connectionState.value = 'disconnected';
  }
}

export function stopConnectionMonitor() {
  stopped = true;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = undefined;
  }
  started = false;
  connectionState.value = 'idle';
}
