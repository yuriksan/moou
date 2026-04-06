import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock EventSource before importing
class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    setTimeout(() => { this.onopen?.(); }, 0);
  }

  close() { this.closed = true; }

  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

vi.stubGlobal('EventSource', MockEventSource);

// Track cleanup functions registered via onUnmounted
const unmountCallbacks: Array<() => void> = [];
vi.mock('vue', async () => {
  const actual = await vi.importActual('vue');
  return {
    ...actual as any,
    onUnmounted: vi.fn((fn: () => void) => { unmountCallbacks.push(fn); }),
  };
});

beforeEach(() => {
  // Simulate unmount to clean up previous test's listeners
  for (const cb of unmountCallbacks) cb();
  unmountCallbacks.length = 0;
  MockEventSource.instances = [];
});

describe('useSSE', () => {
  it('connects to the event stream', async () => {
    const { useSSE } = await import('../composables/useSSE');
    const sse = useSSE();
    expect(sse.connected).toBeDefined();
    expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(1);
  });

  it('provides an on() method for typed event listeners', async () => {
    const { useSSE } = await import('../composables/useSSE');
    const sse = useSSE();
    const source = MockEventSource.instances[MockEventSource.instances.length - 1]!;

    const handler = vi.fn();
    sse.on('outcome_created', handler);

    source.simulateMessage({ type: 'outcome_created', id: '123' });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'outcome_created', id: '123' })
    );
  });

  it('unsubscribes via returned function', async () => {
    const { useSSE } = await import('../composables/useSSE');
    const sse = useSSE();
    const source = MockEventSource.instances[MockEventSource.instances.length - 1]!;

    const handler = vi.fn();
    const unsub = sse.on('test_event', handler);

    source.simulateMessage({ type: 'test_event' });
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    source.simulateMessage({ type: 'test_event' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('updates lastEvent ref on message', async () => {
    const { useSSE } = await import('../composables/useSSE');
    const sse = useSSE();
    const source = MockEventSource.instances[MockEventSource.instances.length - 1]!;

    source.simulateMessage({ type: 'ping', id: '1' });
    expect(sse.lastEvent.value).toEqual(expect.objectContaining({ type: 'ping', id: '1' }));
  });
});
