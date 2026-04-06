import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useToast, toast } from '../composables/useToast';

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToast().clearAll();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pushes a toast and stores it in the reactive list', () => {
    const { toasts, pushToast } = useToast();
    pushToast('error', 'Something broke');
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0]!.variant).toBe('error');
    expect(toasts.value[0]!.message).toBe('Something broke');
  });

  it('assigns monotonically increasing ids', () => {
    const { toasts, pushToast } = useToast();
    pushToast('info', 'A');
    pushToast('info', 'B');
    expect(toasts.value[0]!.id).toBeLessThan(toasts.value[1]!.id);
  });

  it('dismisses a toast by id', () => {
    const { toasts, pushToast, dismiss } = useToast();
    const id = pushToast('info', 'Bye');
    dismiss(id);
    expect(toasts.value).toHaveLength(0);
  });

  it('auto-dismisses after the default timeout', () => {
    const { toasts, pushToast } = useToast();
    pushToast('success', 'Done');
    expect(toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(3500);
    expect(toasts.value).toHaveLength(0);
  });

  it('respects an explicit timeoutMs override', () => {
    const { toasts, pushToast } = useToast();
    pushToast('error', 'boom', { timeoutMs: 100 });
    vi.advanceTimersByTime(99);
    expect(toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(toasts.value).toHaveLength(0);
  });

  it('does not auto-dismiss when timeoutMs is null', () => {
    const { toasts, pushToast } = useToast();
    pushToast('error', 'sticky', { timeoutMs: null });
    vi.advanceTimersByTime(60_000);
    expect(toasts.value).toHaveLength(1);
  });

  it('deduplicates identical back-to-back toasts and resets the timer', () => {
    const { toasts, pushToast } = useToast();
    const first = pushToast('error', 'same', { timeoutMs: 1000 });
    vi.advanceTimersByTime(800);
    // Re-push just before the first would have dismissed
    const second = pushToast('error', 'same', { timeoutMs: 1000 });
    // Same id — the existing toast was reused, not a new one
    expect(second).toBe(first);
    expect(toasts.value).toHaveLength(1);
    // Original timer would fire at t=1000 but was reset at t=800, so it now
    // fires at t=1800. At t=999+800 = 1799 it's still visible.
    vi.advanceTimersByTime(999);
    expect(toasts.value).toHaveLength(1);
    // Crossing 1800 total dismisses it
    vi.advanceTimersByTime(2);
    expect(toasts.value).toHaveLength(0);
  });

  it('clearAll removes every toast', () => {
    const { toasts, pushToast, clearAll } = useToast();
    pushToast('info', 'one');
    pushToast('info', 'two');
    pushToast('info', 'three');
    expect(toasts.value).toHaveLength(3);
    clearAll();
    expect(toasts.value).toHaveLength(0);
  });

  it('convenience wrappers push the correct variant', () => {
    const { toasts } = useToast();
    toast.error('err');
    toast.success('ok');
    toast.info('fyi');
    expect(toasts.value.map(t => t.variant)).toEqual(['error', 'success', 'info']);
  });
});
