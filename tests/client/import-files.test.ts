import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { importFiles } from '../../src/client/canvas/import-files.ts';
import { activeBoardId } from '../../src/client/state/boards-store.ts';

const originalFetch = globalThis.fetch;
const OriginalFileReader = globalThis.FileReader;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  activeBoardId.value = 'A';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.FileReader = OriginalFileReader;
});

describe('file imports stay on their captured board', () => {
  test('a board switch during a delayed text read cancels node creation', async () => {
    const read = deferred<string>();
    const requests: RequestInit[] = [];
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return Promise.resolve(new Response(JSON.stringify({ ok: true })));
    }) as typeof fetch;
    const file = { name: 'notes.md', text: () => read.promise } as File;

    const importing = importFiles([file], 0, 0);
    activeBoardId.value = 'B';
    read.resolve('captured text');
    await importing;

    expect(requests).toHaveLength(0);
  });

  test('a board switch during a delayed image read cancels node creation', async () => {
    const read = deferred<string>();
    const requests: RequestInit[] = [];
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return Promise.resolve(new Response(JSON.stringify({ ok: true })));
    }) as typeof fetch;
    globalThis.FileReader = class {
      result: string | null = null;
      onload: (() => void) | null = null;

      readAsDataURL(): void {
        void read.promise.then((result) => {
          this.result = result;
          this.onload?.();
        });
      }
    } as unknown as typeof FileReader;
    const file = { name: 'diagram.png' } as File;

    const importing = importFiles([file], 0, 0);
    activeBoardId.value = 'B';
    read.resolve('data:image/png;base64,AA==');
    await importing;

    expect(requests).toHaveLength(0);
  });

  test('node creation carries the captured board while preserving Home imports', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Promise.resolve(new Response(JSON.stringify({ ok: true })));
    }) as typeof fetch;

    await importFiles([{ name: 'board.md', text: async () => 'board' } as File], 0, 0);
    activeBoardId.value = null;
    await importFiles([{ name: 'home.md', text: async () => 'home' } as File], 0, 0);

    expect(bodies[0]?.boardId).toBe('A');
    expect(bodies[1]).not.toHaveProperty('boardId');
  });
});
