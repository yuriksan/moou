import { ref } from 'vue';

// ─── Types ───
export type ToastVariant = 'error' | 'success' | 'info';

export interface Toast {
  id: number;
  variant: ToastVariant;
  title?: string;
  message: string;
  /** When null, toast must be dismissed manually. */
  timeoutMs: number | null;
}

// ─── Module-level reactive state ───
// A single store is intentional: one toast overlay per app, reachable from
// anywhere (including non-component modules like useApi.ts).
const toasts = ref<Toast[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 1;

const DEFAULT_TIMEOUT: Record<ToastVariant, number | null> = {
  success: 3500,
  info: 4000,
  error: 7000,
};

function scheduleDismiss(id: number, timeoutMs: number | null) {
  if (timeoutMs == null) return;
  const handle = setTimeout(() => dismiss(id), timeoutMs);
  timers.set(id, handle);
}

function clearTimer(id: number) {
  const handle = timers.get(id);
  if (handle) {
    clearTimeout(handle);
    timers.delete(id);
  }
}

// ─── Public API ───

export interface PushToastOptions {
  title?: string;
  /** Override the variant default. Pass `null` to require manual dismiss. */
  timeoutMs?: number | null;
}

export function pushToast(
  variant: ToastVariant,
  message: string,
  opts: PushToastOptions = {},
): number {
  const id = nextId++;
  const timeoutMs = opts.timeoutMs === undefined ? DEFAULT_TIMEOUT[variant] : opts.timeoutMs;

  // Deduplicate back-to-back identical messages so a flurry of failing requests
  // doesn't spam the stack. Reset the timer on the existing toast instead.
  const last = toasts.value[toasts.value.length - 1];
  if (last && last.variant === variant && last.message === message && last.title === opts.title) {
    clearTimer(last.id);
    scheduleDismiss(last.id, timeoutMs);
    return last.id;
  }

  toasts.value.push({ id, variant, title: opts.title, message, timeoutMs });
  scheduleDismiss(id, timeoutMs);
  return id;
}

export function dismiss(id: number) {
  clearTimer(id);
  const idx = toasts.value.findIndex(t => t.id === id);
  if (idx !== -1) toasts.value.splice(idx, 1);
}

export function clearAll() {
  for (const id of timers.keys()) clearTimer(id);
  toasts.value = [];
}

// Convenience wrappers — the 99% case.
export const toast = {
  error: (message: string, opts?: PushToastOptions) => pushToast('error', message, opts),
  success: (message: string, opts?: PushToastOptions) => pushToast('success', message, opts),
  info: (message: string, opts?: PushToastOptions) => pushToast('info', message, opts),
};

// Composable — returns the reactive list plus actions. Call from any component.
export function useToast() {
  return { toasts, pushToast, dismiss, clearAll, toast };
}
