import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, mock, test } from 'bun:test';
import { connectSSE, EVENT_HANDLERS } from '../../src/client/state/sse-bridge.ts';
import { stopHumanPresence } from '../../src/client/state/human-store.ts';

// Stale-SPA guard (0.4.5 report Finding W): a long-lived panel keeps its
// in-memory bundle across a daemon upgrade. The boot HTML stamps the server
// version at page-serve time; a `connected` frame reporting a different
// version means the server was upgraded under this page → reload once.

const RELOAD_KEY = 'pmx-canvas-version-reload';
let reload: ReturnType<typeof mock>;
const originalEventSource = globalThis.EventSource;

// `connected` kicks off the connect-time requests (viewport report, presence,
// AX snapshot); stub fetch so happy-dom does not hit a real socket.
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async () =>
    new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

function connected(version?: unknown): void {
  EVENT_HANDLERS.connected({ sessionId: 's1', ...(version !== undefined ? { version } : {}) });
}

beforeEach(() => {
  (window as unknown as { happyDOM: { setURL(next: string): void } }).happyDOM.setURL(
    'http://localhost:3000/workbench',
  );
  reload = mock(() => {});
  Object.defineProperty(window.location, 'reload', { configurable: true, value: reload });
  window.sessionStorage.removeItem(RELOAD_KEY);
});

afterEach(() => {
  stopHumanPresence();
  jest.useRealTimers();
  globalThis.EventSource = originalEventSource;
  (window as unknown as { happyDOM: { setURL(next: string): void } }).happyDOM.setURL(
    'http://localhost:3000/workbench',
  );
  delete (window as Window & { __PMX_BOOT_SERVER_VERSION?: string }).__PMX_BOOT_SERVER_VERSION;
  window.sessionStorage.removeItem(RELOAD_KEY);
});

describe('stale-SPA reload guard', () => {
  test('reloads once when the connected frame reports a newer server version', () => {
    (window as Window & { __PMX_BOOT_SERVER_VERSION?: string }).__PMX_BOOT_SERVER_VERSION = '0.4.5';
    connected('0.4.6');
    expect(reload).toHaveBeenCalledTimes(1);
    // The per-version guard stops a reload loop if the stamp never catches up.
    connected('0.4.6');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('does not reload when versions match or context is incomplete', () => {
    (window as Window & { __PMX_BOOT_SERVER_VERSION?: string }).__PMX_BOOT_SERVER_VERSION = '0.4.5';
    connected('0.4.5');
    connected('unknown');
    connected();
    delete (window as Window & { __PMX_BOOT_SERVER_VERSION?: string }).__PMX_BOOT_SERVER_VERSION;
    connected('0.4.6'); // no boot stamp (pre-upgrade HTML) → never guess
    expect(reload).toHaveBeenCalledTimes(0);
  });
});

test.each(['sse', 'poll'])('disconnecting %s stops connected human-presence writes', (transport) => {
  jest.useFakeTimers();
  (window as unknown as { happyDOM: { setURL(next: string): void } }).happyDOM.setURL(
    `http://localhost:3000/workbench?transport=${transport}`,
  );
  globalThis.EventSource = class extends EventTarget {
    close() {}
  } as unknown as typeof EventSource;
  const writes: unknown[] = [];
  globalThis.fetch = ((url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/canvas/human-presence' && init?.method === 'POST') {
      writes.push(JSON.parse(String(init.body)));
      return Promise.resolve(Response.json({ ok: true }));
    }
    return new Promise<Response>(() => {});
  }) as typeof fetch;
  const disconnect = connectSSE();
  try {
    connected('test');
    expect(writes).toHaveLength(1);
    jest.advanceTimersByTime(3000);
    expect(writes).toHaveLength(2);
    disconnect();
    jest.advanceTimersByTime(6000);
    expect(writes).toHaveLength(2);
  } finally {
    disconnect();
  }
});
