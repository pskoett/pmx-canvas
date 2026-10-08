import { afterAll, beforeEach, describe, expect, jest, test } from 'bun:test';
import { activeBoardId, boardList } from '../../src/client/state/boards-store.ts';
import { briefSize, refreshContextChip } from '../../src/client/state/context-chip-store.ts';

const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
  jest.useRealTimers();
});
beforeEach(() => {
  briefSize.value = null;
  activeBoardId.value = 'a';
  boardList.value = [];
});

async function flush(): Promise<void> {
  jest.advanceTimersByTime(300);
  jest.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('context chip store', () => {
  test('the brief fetch is a measurement, never booked as an agent read', async () => {
    const seen: Array<{ url: string; headers: Headers }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: new Headers(init?.headers) });
      return Response.json({ entries: [], delivery: { truncated: false } });
    }) as unknown as typeof fetch;
    jest.useFakeTimers();
    refreshContextChip();
    await flush();
    const brief = seen.find((call) => call.url === '/api/canvas/context');
    expect(brief?.headers.get('x-pmx-proxied-read')).toBe('1');
    expect(briefSize.value?.chars).toBeGreaterThan(0);
  });

  test('an answer for a board you have since left does not paint the chip', async () => {
    globalThis.fetch = (async () => {
      activeBoardId.value = 'b';
      return Response.json({ entries: [{}], delivery: { truncated: true } });
    }) as unknown as typeof fetch;
    jest.useFakeTimers();
    refreshContextChip();
    await flush();
    expect(briefSize.value).toBeNull();
  });
});
