import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { canvasState } from '../../src/server/canvas-state.ts';
import {
  dispatchOperationRoute,
  HttpOperationInvoker,
  LocalOperationInvoker,
} from '../../src/server/operations/index.ts';
import type { BatchEnvelope } from '../../src/server/operations/ops/batch.ts';
import type { OperationProgress } from '../../src/server/operations/types.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import { fetchWebpageSnapshot } from '../../src/server/webpage-node.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests, waitForCondition } from './helpers.ts';

let workspaceRoot = '';
let baseUrl = '';
const local = new LocalOperationInvoker();
let remote: HttpOperationInvoker;

beforeEach(async () => {
  workspaceRoot = createTestWorkspace('pmx-operation-cancellation-');
  resetCanvasForTests(workspaceRoot);
  const base = startCanvasServer({ workspaceRoot, port: 0 });
  if (!base) throw new Error('Could not start test server.');
  baseUrl = base;
  remote = new HttpOperationInvoker(baseUrl);
  await local.invoke('node.add', { type: 'markdown', title: 'Existing work' });
});

afterEach(() => {
  stopCanvasServer();
  removeTestWorkspace(workspaceRoot);
});

const gates = [
  {
    kind: 'approval',
    create: () => canvasState.requestApproval({ title: 'Proceed?' }).id,
    resolve: (id: string) => canvasState.resolveApproval(id, 'approved'),
    key: 'approvalGate',
    status: 'approved',
  },
  {
    kind: 'elicitation',
    create: () => canvasState.requestElicitation({ prompt: 'Which environment?' }).id,
    resolve: (id: string) => canvasState.respondElicitation(id, { environment: 'test' }),
    key: 'elicitation',
    status: 'answered',
  },
  {
    kind: 'mode',
    create: () => canvasState.requestMode({ mode: 'execute' }).id,
    resolve: (id: string) => canvasState.resolveModeRequest(id, 'approved'),
    key: 'modeRequest',
    status: 'approved',
  },
];

/** Observe the real subscription's disposer without replacing wait behavior. */
function observeSubscriptions() {
  let active = 0;
  let disposed = 0;
  const original = canvasState.onChange.bind(canvasState);
  const spy = spyOn(canvasState, 'onChange').mockImplementation((listener) => {
    active++;
    const dispose = original(listener);
    return () => {
      active--;
      disposed++;
      dispose();
    };
  });
  return {
    get active() {
      return active;
    },
    get disposed() {
      return disposed;
    },
    restore: () => spy.mockRestore(),
  };
}

/** Real upstream that can withhold headers or stop halfway through its body. */
function delayedWebpage(phase: 'headers' | 'body') {
  let requestSignal: AbortSignal | undefined;
  let finished = false;
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const html = '<html><title>Fetched control</title><body><p>Original webpage content.</p></body></html>';
  const late = '<html><title>Late response</title><body><p>Must not overwrite the card.</p></body></html>';
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === '/normal') return new Response(html, { headers: { 'Content-Type': 'text/html' } });
      if (path === '/redirect') return Response.redirect(new URL('/slow', req.url));
      requestSignal = req.signal;
      if (phase === 'headers') {
        await delayed;
        finished = true;
        return new Response(late, { headers: { 'Content-Type': 'text/html' } });
      }
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode('<html><title>Late streamed response</title><body>'));
          await delayed;
          if (!req.signal.aborted) {
            controller.enqueue(new TextEncoder().encode('<p>Late content.</p></body></html>'));
            controller.close();
          }
          finished = true;
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'text/html' } });
    },
  });
  return {
    url: `http://127.0.0.1:${upstream.port}`,
    get signal() {
      return requestSignal;
    },
    get finished() {
      return finished;
    },
    release,
    stop() {
      release();
      upstream.stop(true);
    },
  };
}

describe('operation cancellation', () => {
  test('abort-before-start prevents local and remote writes and board changes', async () => {
    const controller = new AbortController();
    controller.abort();
    const before = canvasState.getLayout();
    for (const invoker of [local, remote]) {
      await expect(
        invoker.invoke(
          'node.add',
          { type: 'markdown', title: 'Must not exist' },
          {
            signal: controller.signal,
          },
        ),
      ).rejects.toMatchObject({ name: 'AbortError' });
    }
    expect(canvasState.getLayout()).toEqual(before);

    const req = new Request(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      body: JSON.stringify({ type: 'markdown', title: 'Also forbidden' }),
      signal: controller.signal,
    });
    const response = await dispatchOperationRoute(req, new URL(req.url));
    expect(response?.status).toBe(499);
    expect(canvasState.getLayout()).toEqual(before);
  });

  for (const gate of gates) {
    test(`${gate.kind}: in-flight local abort disposes the wait, not a successful pending result`, async () => {
      const id = gate.create();
      const subscriptions = observeSubscriptions();
      const clear = spyOn(globalThis, 'clearTimeout');
      const controller = new AbortController();
      try {
        const pending = local.invoke(`ax.${gate.kind}.get`, { id, timeoutMs: 5000 }, { signal: controller.signal });
        const rejected = pending.catch((error: unknown) => error);
        await waitForCondition(() => subscriptions.active === 1);
        controller.abort();
        expect(await rejected).toMatchObject({ name: 'AbortError' });
        expect(subscriptions.active).toBe(0);
        expect(subscriptions.disposed).toBe(1);
        expect(clear).toHaveBeenCalled();
        gate.resolve(id);
        expect(subscriptions.disposed).toBe(1);
      } finally {
        controller.abort();
        subscriptions.restore();
        clear.mockRestore();
      }
    });

    test(`${gate.kind}: HTTP timeoutMs really waits and progress precedes normal resolution`, async () => {
      const id = gate.create();
      const progress: OperationProgress[] = [];
      const subscriptions = observeSubscriptions();
      let settled = false;
      try {
        const pending = remote
          .invoke(
            `ax.${gate.kind}.get`,
            { id, timeoutMs: 5000 },
            {
              onProgress: async (update) => {
                progress.push(update);
              },
            },
          )
          .then((result) => {
            settled = true;
            return result;
          });
        await waitForCondition(() => progress.length === 1 && subscriptions.active === 1);
        expect(settled).toBe(false);
        gate.resolve(id);
        expect(await pending).toMatchObject({ ok: true, pending: false, [gate.key]: { status: gate.status } });
        expect(progress.map((update) => update.progress)).toEqual([0, 1]);
        expect(subscriptions.active).toBe(0);
      } finally {
        gate.resolve(id);
        subscriptions.restore();
      }
    });
  }

  for (const streaming of [false, true]) {
    test(`HTTP disconnect cancels the server wait (progress=${streaming})`, async () => {
      const id = gates[0]!.create();
      const subscriptions = observeSubscriptions();
      const controller = new AbortController();
      try {
        const pending = remote.invoke(
          'ax.approval.get',
          { id, timeoutMs: 5000 },
          {
            signal: controller.signal,
            ...(streaming ? { onProgress: () => {} } : {}),
          },
        );
        const rejected = pending.catch((error: unknown) => error);
        await waitForCondition(() => subscriptions.active === 1);
        controller.abort();
        expect(await rejected).toMatchObject({ name: 'AbortError' });
        await waitForCondition(() => subscriptions.active === 0);
        expect(subscriptions.disposed).toBe(1);
      } finally {
        controller.abort();
        gates[0]!.resolve(id);
        subscriptions.restore();
      }
    });
  }

  test('steering long-poll propagates cancellation too', async () => {
    const subscriptions = observeSubscriptions();
    const controller = new AbortController();
    try {
      const pending = local.invoke(
        'ax.delivery.pending',
        { consumer: 'cancellation-test', timeoutMs: 5000 },
        {
          signal: controller.signal,
        },
      );
      const rejected = pending.catch((error: unknown) => error);
      await waitForCondition(() => subscriptions.active === 1);
      controller.abort();
      expect(await rejected).toMatchObject({ name: 'AbortError' });
      expect(subscriptions.active).toBe(0);
    } finally {
      controller.abort();
      subscriptions.restore();
    }
  });

  test('timeout is still an ordinary pending result, including the direct HTTP waitMs spelling', async () => {
    const id = gates[0]!.create();
    const subscriptions = observeSubscriptions();
    try {
      const response = await fetch(`${baseUrl}/api/canvas/ax/approval/${id}?waitMs=20`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, pending: true });
      expect(subscriptions.disposed).toBe(1);
      expect(subscriptions.active).toBe(0);
    } finally {
      subscriptions.restore();
    }
  });

  test('request cancellation does not leak into another concurrent invocation', async () => {
    const first = gates[0]!.create();
    const second = gates[0]!.create();
    const subscriptions = observeSubscriptions();
    const controller = new AbortController();
    try {
      const cancelled = local.invoke('ax.approval.get', { id: first, timeoutMs: 5000 }, { signal: controller.signal });
      const rejected = cancelled.catch((error: unknown) => error);
      const live = local.invoke('ax.approval.get', { id: second, timeoutMs: 5000 });
      await waitForCondition(() => subscriptions.active === 2);
      controller.abort();
      expect(await rejected).toMatchObject({ name: 'AbortError' });
      expect(subscriptions.active).toBe(1);
      gates[0]!.resolve(second);
      expect(await live).toMatchObject({ pending: false });
      expect(subscriptions.active).toBe(0);
    } finally {
      controller.abort();
      gates[0]!.resolve(second);
      subscriptions.restore();
    }
  });

  test('batch abort retains completed writes and refs, and never starts the next write', async () => {
    const controller = new AbortController();
    const progress: number[] = [];
    const result = (await local.invoke(
      'canvas.batch',
      {
        operations: [
          { op: 'node.add', assign: 'kept', args: { type: 'markdown', title: 'Completed' } },
          { op: 'node.add', args: { type: 'prompt', title: 'Must not start' } },
        ],
      },
      {
        signal: controller.signal,
        onProgress: async (update) => {
          progress.push(update.progress);
          if (update.progress === 1) controller.abort();
        },
      },
    )) as BatchEnvelope;
    expect(result).toMatchObject({ ok: false, cancelled: true, failedIndex: 1 });
    expect(result.results).toHaveLength(1);
    expect(result.refs.kept).toEqual(result.results[0]);
    expect(canvasState.getNode(String(result.results[0]!.id))?.data.title).toBe('Completed');
    expect(canvasState.getLayout().nodes.some((node) => node.data.title === 'Must not start')).toBe(false);
    expect(progress).toEqual([0, 1]);
  });

  test('HTTP dispatcher returns completed batch receipts on interruption during a write', async () => {
    const controller = new AbortController();
    const dispose = canvasState.onChange(() => {
      if (canvasState.getLayout().nodes.some((node) => node.data.title === 'HTTP retained')) controller.abort();
    });
    try {
      const req = new Request(`${baseUrl}/api/canvas/batch`, {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          operations: [
            { op: 'node.add', assign: 'kept', args: { type: 'markdown', title: 'HTTP retained' } },
            { op: 'node.add', args: { type: 'markdown', title: 'HTTP forbidden' } },
          ],
        }),
      });
      const response = await dispatchOperationRoute(req, new URL(req.url));
      expect(response?.status).toBe(400);
      const result = (await response!.json()) as BatchEnvelope;
      expect(result).toMatchObject({ ok: false, cancelled: true, failedIndex: 1 });
      expect(result.results).toHaveLength(1);
      expect(result.refs.kept).toEqual(result.results[0]);
      expect(canvasState.getLayout().nodes.some((node) => node.data.title === 'HTTP forbidden')).toBe(false);
    } finally {
      dispose();
    }
  });

  test('remote progress preserves ordinary batch partial failures and successful receipts', async () => {
    const progress: number[] = [];
    const result = (await remote.invoke(
      'canvas.batch',
      {
        operations: [
          { op: 'node.add', assign: 'kept', args: { type: 'markdown', title: 'Remote completed' } },
          { op: 'unsupported', args: {} },
        ],
      },
      {
        onProgress: (update) => {
          progress.push(update.progress);
        },
      },
    )) as BatchEnvelope;
    expect(result).toMatchObject({ ok: false, failedIndex: 1 });
    expect(result.results).toHaveLength(1);
    expect(result.refs.kept).toEqual(result.results[0]);
    expect(progress).toEqual([0, 1]);
  });

  test('a board switch while delivering progress cannot move batch writes to another board', async () => {
    const other = canvasState.createBoard('Other board')!;
    const result = (await local.invoke(
      'canvas.batch',
      {
        operations: [{ op: 'node.add', args: { type: 'markdown', title: 'Must not move' } }],
      },
      {
        onProgress: async () => {
          canvasState.switchBoard(other.id);
        },
      },
    )) as BatchEnvelope;
    expect(result).toMatchObject({ ok: false, failedIndex: 0, results: [] });
    expect(result.error).toContain('board changed');
    expect(canvasState.getLayout().nodes).toEqual([]);
  });

  test('cancellation after the final committed entry does not relabel completed writes as rolled back', async () => {
    const controller = new AbortController();
    const result = (await local.invoke(
      'canvas.batch',
      {
        operations: [{ op: 'node.add', args: { type: 'markdown', title: 'Committed' } }],
      },
      {
        signal: controller.signal,
        onProgress: (update) => {
          if (update.progress === 1) controller.abort();
        },
      },
    )) as BatchEnvelope;
    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(canvasState.getNode(String(result.results[0]!.id))?.data.title).toBe('Committed');
  });

  test('progress observer failures cannot erase successful batch receipts', async () => {
    const log = spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const invoker of [local, remote]) {
        const result = (await invoker.invoke(
          'canvas.batch',
          {
            operations: [{ op: 'node.add', args: { type: 'markdown', title: 'Receipt retained' } }],
          },
          {
            onProgress: async () => {
              throw new Error('Observer disconnected');
            },
          },
        )) as BatchEnvelope;
        expect(result.ok).toBe(true);
        expect(result.results).toHaveLength(1);
        expect(canvasState.getNode(String(result.results[0]!.id))).toBeDefined();
      }
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  for (const phase of ['headers', 'body'] as const) {
    for (const transport of ['local', 'HTTP'] as const) {
      for (const operation of ['node.refresh', 'node.update']) {
        test(`${transport} ${operation} aborts webpage ${phase} I/O and never writes late content`, async () => {
          const upstream = delayedWebpage(phase);
          const controller = new AbortController();
          try {
            // Normal fetch control traverses the same network/parser/write path.
            const created = (await remote.invoke('node.add', { type: 'webpage', url: `${upstream.url}/normal` })) as {
              id: string;
            };
            const before = structuredClone(canvasState.getNode(created.id)!);
            expect(before.data).toMatchObject({ status: 'ready', pageTitle: 'Fetched control' });
            expect(before.data.content).toContain('Original webpage content.');
            const invoker = transport === 'local' ? local : remote;
            const pending = invoker
              .invoke(
                operation,
                {
                  id: created.id,
                  refresh: true,
                  url: `${upstream.url}/redirect`,
                },
                { signal: controller.signal },
              )
              .catch((error: unknown) => error);
            await waitForCondition(() => upstream.signal !== undefined);
            controller.abort();
            expect(await pending).toMatchObject({ name: 'AbortError' });
            await waitForCondition(() => upstream.signal?.aborted === true);
            expect(canvasState.getNode(created.id)).toEqual(before);
            upstream.release();
            await waitForCondition(() => upstream.finished);
            await remote.invoke('node.get', { id: created.id, contextDelivery: false });
            expect(canvasState.getNode(created.id)).toEqual(before);
          } finally {
            controller.abort();
            upstream.stop();
          }
        });
      }
    }
  }

  test('cancelled webpage creation returns its committed node receipt with fetch.cancelled', async () => {
    const upstream = delayedWebpage('headers');
    const controller = new AbortController();
    try {
      const pending = local.invoke(
        'node.add',
        {
          type: 'webpage',
          title: 'Created before fetch',
          url: `${upstream.url}/slow`,
        },
        { signal: controller.signal },
      );
      await waitForCondition(() => upstream.signal !== undefined);
      const node = structuredClone(canvasState.getLayout().nodes.find((entry) => entry.type === 'webpage')!);
      controller.abort();
      expect(await pending).toMatchObject({ id: node.id, fetch: { ok: false, cancelled: true } });
      await waitForCondition(() => upstream.signal?.aborted === true);
      upstream.release();
      await waitForCondition(() => upstream.finished);
      expect(canvasState.getNode(node.id)).toEqual(node);
    } finally {
      controller.abort();
      upstream.stop();
    }
  });

  test('batch retains an interrupted webpage creation and never starts its following write', async () => {
    const upstream = delayedWebpage('body');
    const controller = new AbortController();
    try {
      const pending = local.invoke(
        'canvas.batch',
        {
          operations: [
            { op: 'node.add', assign: 'page', args: { type: 'webpage', url: `${upstream.url}/slow` } },
            { op: 'node.add', args: { type: 'markdown', title: 'Must not follow cancelled fetch' } },
          ],
        },
        { signal: controller.signal },
      );
      await waitForCondition(() => upstream.signal !== undefined);
      const before = structuredClone(canvasState.getLayout().nodes.find((entry) => entry.type === 'webpage')!);
      controller.abort();
      const result = (await pending) as BatchEnvelope;
      expect(result).toMatchObject({ ok: false, cancelled: true, failedIndex: 1 });
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({ id: before.id, fetch: { ok: false, cancelled: true } });
      expect(result.refs.page).toEqual(result.results[0]);
      await waitForCondition(() => upstream.signal?.aborted === true);
      upstream.release();
      await waitForCondition(() => upstream.finished);
      expect(canvasState.getNode(before.id)).toEqual(before);
      expect(canvasState.getLayout().nodes.some((node) => node.data.title === 'Must not follow cancelled fetch')).toBe(
        false,
      );
    } finally {
      controller.abort();
      upstream.stop();
    }
  });

  test('webpage caller abort during DNS stays cancellation, not a timeout or fetch error', async () => {
    const controller = new AbortController();
    let finishDns!: (addresses: Array<{ address: string; family: number }>) => void;
    const dns = new Promise<Array<{ address: string; family: number }>>((resolve) => {
      finishDns = resolve;
    });
    const reason = new Error('Caller stopped webpage lookup');
    const pending = fetchWebpageSnapshot('http://delayed-dns.test/', {
      signal: controller.signal,
      resolveHost: () => dns,
    }).catch((error: unknown) => error);
    controller.abort(reason);
    expect(await pending).toBe(reason);
    finishDns([{ address: '127.0.0.1', family: 4 }]);
  });
});
