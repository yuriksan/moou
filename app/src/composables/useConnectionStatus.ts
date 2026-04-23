import { ref } from 'vue';
import { api } from './useApi';

export type ConnectionState = 'connected' | 'checking' | 'disconnected' | 'idle';

export const connectionState = ref<ConnectionState>('idle');

let intervalId: ReturnType<typeof setInterval> | undefined;
let started = false;

const BASE = import.meta.env.VITE_API_URL || '/api';

/**
 * Start polling the provider health check at the interval specified by the provider.
 * Call once from App.vue after authentication.
 * If the provider returns healthCheckIntervalMs = null, no polling occurs.
 */
export async function startConnectionMonitor() {
  if (started) return;
  started = true;

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
    const res = await fetch(`${BASE}/provider/health`, { credentials: 'include' });
    if (!res.ok) {
      connectionState.value = 'disconnected';
      return;
    }
    const data = await res.json();
    connectionState.value = data.connected ? 'connected' : 'disconnected';
  } catch {
    connectionState.value = 'disconnected';
  }
}

export function stopConnectionMonitor() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = undefined;
  }
  started = false;
  connectionState.value = 'idle';
}
