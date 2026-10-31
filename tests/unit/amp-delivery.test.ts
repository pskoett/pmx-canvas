import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import type { PluginThread, ThreadMessage } from '@ampcode/plugin';
import { bind, readBinding, unbind } from '../../plugins/amp/binding.js';
import { CanvasDelivery } from '../../plugins/amp/delivery.js';
import type { ContextDecider } from '../../plugins/amp/context-relevance.js';
import type { AdviceDecider } from '../../plugins/amp/jev-advice.js';
import { reviewInput } from '../fixtures/jev-advice.js';
import { canvasState } from '../../src/server/canvas-state.js';
import type { ContextBriefDocument } from '../../src/server/context-brief.js';
import { HttpOperationInvoker } from '../../src/server/operations/invoker.js';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.js';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.js';

let root: string;
let board: string;
let visible: string;
let api: HttpOperationInvoker;
const first = 'T-delivery-first';
const second = 'T-delivery-second';
const originalUrl = process.env.PMX_CANVAS_URL;
const stores = new Set<CanvasDelivery>();
const open = (id = first) => {
  const store = new CanvasDelivery(root, id);
  stores.add(store);
  return store;
};
const close = (store: CanvasDelivery) => {
  stores.delete(store);
  store.close();
};
const token = (content: string) => /Receipt token: ([a-f0-9-]+)/.exec(content)![1];
const briefIn = (content: string) =>
  JSON.parse(content.split('\n').find((line) => line.startsWith('{"version":'))!) as ContextBriefDocument;

beforeEach(() => {
  root = createTestWorkspace('amp-delivery-');
  resetCanvasForTests(root);
  board = canvasState.createBoard('Bound')!.id;
  visible = canvasState.createBoard('Human')!.id;
  canvasState.switchBoard(visible);
  process.env.PMX_CANVAS_URL = startCanvasServer({ workspaceRoot: root, port: 0 })!;
  api = new HttpOperationInvoker(process.env.PMX_CANVAS_URL, 'delivery-test');
  bind(root, first, board);
  bind(root, second, visible);
});

afterEach(() => {
  for (const store of stores) store.close();
  stores.clear();
  stopCanvasServer();
  removeTestWorkspace(root);
  if (originalUrl === undefined) delete process.env.PMX_CANVAS_URL;
  else process.env.PMX_CANVAS_URL = originalUrl;
});

async function steer(message: string, target?: string) {
  const result = (await api.invoke('ax.steer', { message, target, source: 'browser' })) as { steering: { id: string } };
  return result.steering.id;
}

function thread() {
  const contents: string[] = [];
  const messages: ThreadMessage[] = [];
  const host: Pick<PluginThread, 'messages' | 'appendUserMessage'> = {
    messages: async ({ offset = 0, limit = 20 } = {}) => messages.slice(offset, offset + limit),
    appendUserMessage: async (message, options) => {
      expect(options?.steer).toBe(true);
      contents.push(message.content);
      messages.push({ id: contents.length, role: 'user', content: [{ type: 'text', text: message.content }] });
    },
  };
  return { host, contents, messages };
}

test('preparation does not consume context; receipt is thread-local, retryable and never a full-content read', async () => {
  const node = (await api.invoke('node.add', {
    targetBoardId: board,
    type: 'markdown',
    title: 'Pinned decision',
    content: 'Use blue.',
  })) as { id: string };
  canvasState.withBoard(board, () => canvasState.setContextPins([node.id]));
  const store = open();
  const content = await store.context('turn-1');
  expect(content).toContain('Pinned decision');
  expect(canvasState.getContextReads().reads).toHaveLength(0);
  expect(canvasState.getContextBriefCursor(board, `amp:${first}`)).toBeNull();
  await expect(open(second).receive(token(content))).rejects.toThrow('Unknown receipt');
  close(store);
  const resumed = open();
  expect(await resumed.context('turn-1')).toBe(content);
  await resumed.receive(token(content));
  await resumed.receive(token(content));
  const reads = canvasState.getContextReads().reads;
  expect(reads).toHaveLength(1);
  expect(reads[0]).toMatchObject({
    boardId: board,
    consumer: `amp:${first}`,
    deliveredNodeIds: [node.id],
    readNodes: {},
  });
  expect(canvasState.visibleBoardId).toBe(visible);
  const next = await resumed.context('turn-2');
  expect(next).not.toContain('"requested":null');
  expect(canvasState.getContextReads().reads).toHaveLength(1);
  unbind(root, first);
  bind(root, first, board);
  await expect(resumed.receive(token(next))).rejects.toThrow('different binding');
});

async function seedNearbyContext() {
  const ids: string[] = [];
  for (const [index, title] of ['Explicit pin', 'Unrelated picnic', 'Checkout failure'].entries()) {
    const node = (await api.invoke('node.add', {
      targetBoardId: board,
      type: 'markdown',
      title,
      content: title,
      x: index * 200,
      y: 0,
    })) as { id: string };
    ids.push(node.id);
  }
  canvasState.withBoard(board, () => canvasState.setContextPins([ids[0]]));
  return ids;
}

test('opt-in ranking retains all context and receipt semantics across concurrent preparation, reload and rebind', async () => {
  const ids = await seedNearbyContext();
  const store = open();
  let calls = 0;
  const decide: ContextDecider = async () => {
    calls++;
    return {
      model: 'fixture',
      answers: {
        candidate0: { type: 'score', score: 0, confidence: 1, legend: {}, probabilities: {} },
        candidate1: { type: 'score', score: 2, confidence: 1, legend: {}, probabilities: {} },
      },
    };
  };
  expect(store.rankingEnabled()).toBe(false);
  await store.receive(token(await store.context('first-map', 'checkout', decide)));
  const baseline = briefIn(await store.context('baseline', 'checkout', decide));
  expect(calls).toBe(0);
  expect(baseline.entries.filter((entry) => entry.reason === 'near').map((entry) => entry.nodeId)).toEqual(
    ids.slice(1),
  );
  store.setRanking(readBinding(root, first)!.id, true);
  const [one, two] = await Promise.all([
    store.context('ranked', 'checkout', decide),
    store.context('ranked', 'checkout', decide),
  ]);
  expect(one).toBe(two);
  expect(calls).toBe(1);
  expect(one).toContain('"mode":"jev"');
  const ranked = briefIn(one);
  expect(ranked.entries.filter((entry) => entry.reason === 'near').map((entry) => entry.nodeId)).toEqual(
    ids.slice(1).reverse(),
  );
  expect(ranked).toEqual({ ...baseline, entries: ranked.entries });
  expect([...ranked.entries].sort((a, b) => a.nodeId.localeCompare(b.nodeId))).toEqual(
    [...baseline.entries].sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
  );
  expect(canvasState.getContextReads().reads).toHaveLength(1);
  close(store);
  const resumed = open();
  expect(resumed.rankingEnabled()).toBe(true);
  expect(await resumed.context('ranked', 'different task', decide)).toBe(one);
  expect(calls).toBe(1);
  await resumed.receive(token(one));
  await resumed.receive(token(one));
  expect(canvasState.getContextReads().reads).toHaveLength(2);
  expect(canvasState.getContextReads().reads.every((read) => Object.keys(read.readNodes).length === 0)).toBe(true);
  resumed.setRanking(readBinding(root, first)!.id, false);
  expect(await resumed.context('disabled', 'checkout', decide)).not.toContain('Optional-context ranking:');
  expect(calls).toBe(1);
  resumed.setRanking(readBinding(root, first)!.id, true);
  const entered = Promise.withResolvers<void>();
  const decision = Promise.withResolvers<Awaited<ReturnType<ContextDecider>>>();
  const pending = resumed
    .context('rebound', 'checkout', () => {
      entered.resolve();
      return decision.promise;
    })
    .then(
      () => 'delivered',
      (error) => String(error),
    );
  await entered.promise;
  bind(root, first, visible);
  decision.resolve(await decide({ state: '', questions: {} }));
  expect(await pending).toContain('binding changed during ranking');
  expect(resumed.rankingEnabled()).toBe(false);
  expect(canvasState.getContextReads().reads).toHaveLength(2);
  expect(canvasState.visibleBoardId).toBe(visible);
});

test.each(['concurrent instance', 'reload'])('in-flight ranking is not resubmitted after %s', async (boundary) => {
  await seedNearbyContext();
  const store = open();
  await store.receive(token(await store.context('first-map')));
  const baseline = briefIn(await store.context('baseline'));
  store.setRanking(readBinding(root, first)!.id, true);
  const entered = Promise.withResolvers<void>();
  const decision = Promise.withResolvers<Awaited<ReturnType<ContextDecider>>>();
  let calls = 0;
  const decide: ContextDecider = () => {
    calls++;
    entered.resolve();
    return decision.promise;
  };
  const pending = store.context('interrupted', 'checkout', decide).catch(() => 'closed');
  await entered.promise;
  if (boundary === 'reload') close(store);
  const resumed = open();
  const replay = await resumed.context('interrupted', 'checkout', decide);
  decision.resolve({
    model: 'fixture',
    answers: {
      candidate0: { type: 'score', score: 0, confidence: 1, legend: {}, probabilities: {} },
      candidate1: { type: 'score', score: 2, confidence: 1, legend: {}, probabilities: {} },
    },
  });
  const original = await pending;
  expect(calls).toBe(1);
  expect(replay).toContain('"reason":"interrupted"');
  expect(briefIn(replay)).toEqual(baseline);
  expect(original).toBe(boundary === 'reload' ? 'closed' : replay);
  expect(await resumed.context('interrupted', 'checkout', decide)).toBe(replay);
  expect(canvasState.getContextReads().reads).toHaveLength(1);
});

test('enabling ranking during context preparation takes effect only on the next turn', async () => {
  await seedNearbyContext();
  const store = open();
  await store.receive(token(await store.context('first-map')));
  const baseline = briefIn(await store.context('baseline'));
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const real = process.env.PMX_CANVAS_URL!;
  const proxy = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/api/canvas/context') {
        entered.resolve();
        await release.promise;
      }
      return fetch(new URL(url.pathname + url.search, real), { headers: request.headers });
    },
  });
  process.env.PMX_CANVAS_URL = `http://localhost:${proxy.port}`;
  let calls = 0;
  const decide: ContextDecider = async () => {
    calls++;
    return {
      model: 'fixture',
      answers: {
        candidate0: { type: 'score', score: 0, confidence: 1, legend: {}, probabilities: {} },
        candidate1: { type: 'score', score: 2, confidence: 1, legend: {}, probabilities: {} },
      },
    };
  };
  try {
    const pending = store.context('already-started', 'checkout', decide);
    await entered.promise;
    store.setRanking(readBinding(root, first)!.id, true);
    release.resolve();
    const current = await pending;
    expect(calls).toBe(0);
    expect(current).not.toContain('Optional-context ranking:');
    expect(briefIn(current)).toEqual(baseline);
    expect(await store.context('next-turn', 'checkout', decide)).toContain('"mode":"jev"');
    expect(calls).toBe(1);
  } finally {
    release.resolve();
    proxy.stop(true);
  }
});

test('advice consent is separate, retries are immutable and interrupted inference is never resubmitted', async () => {
  const store = open();
  const input = reviewInput();
  let calls = 0;
  const decide: AdviceDecider = async () => {
    calls++;
    return {
      model: 'fixture',
      answers: {
        change0: { type: 'score', score: 0, confidence: 1, legend: {}, probabilities: {} },
        change1: { type: 'score', score: 2, confidence: 1, legend: {}, probabilities: {} },
      },
    };
  };
  store.setRanking(readBinding(root, first)!.id, true);
  expect(await store.advise(input, decide)).toMatchObject({ reason: 'disabled', orderedIds: ['copy', 'auth'] });
  expect(calls).toBe(0);
  store.setAdvice(readBinding(root, first)!.id, true);
  const enabled = { ...input, requestId: 'enabled' };
  const result = await store.advise(enabled, decide);
  expect(result).toMatchObject({ mode: 'jev', orderedIds: ['auth', 'copy'] });
  close(store);
  const resumed = open();
  expect(await resumed.advise(enabled, decide)).toEqual(result);
  await expect(resumed.advise({ ...enabled, task: 'different' }, decide)).rejects.toThrow('different advice input');
  expect(calls).toBe(1);
  const decision = Promise.withResolvers<Awaited<ReturnType<AdviceDecider>>>();
  const interrupted = { ...input, requestId: 'interrupted' };
  const pending = resumed
    .advise(interrupted, () => {
      calls++;
      return decision.promise;
    })
    .catch(() => 'closed');
  close(resumed);
  const reopened = open();
  const fallback = await reopened.advise(interrupted, decide);
  expect(fallback).toMatchObject({ reason: 'interrupted', orderedIds: ['copy', 'auth'] });
  decision.resolve({ model: 'late', answers: {} });
  expect(await pending).toBe('closed');
  expect(await reopened.advise(interrupted, decide)).toEqual(fallback);
  expect(calls).toBe(2);
  expect(canvasState.getContextReads().reads).toHaveLength(0);
  expect(canvasState.visibleBoardId).toBe(visible);
  bind(root, first, visible);
  expect(reopened.adviceEnabled()).toBe(false);
});

test('revocation and binding drift during advice cannot deliver a late model answer', async () => {
  const store = open();
  const binding = readBinding(root, first)!;
  store.setAdvice(binding.id, true);
  const decision = Promise.withResolvers<Awaited<ReturnType<AdviceDecider>>>();
  const pending = store.advise(reviewInput(), () => decision.promise);
  store.setAdvice(binding.id, false);
  decision.resolve({ model: 'late', answers: {} });
  expect(await pending).toMatchObject({ reason: 'disabled', orderedIds: ['copy', 'auth'] });
  store.setAdvice(binding.id, true);
  const second = Promise.withResolvers<Awaited<ReturnType<AdviceDecider>>>();
  const rebound = store.advise({ ...reviewInput(), requestId: 'rebound' }, () => second.promise);
  bind(root, first, visible);
  second.resolve({ model: 'late', answers: {} });
  await expect(rebound).rejects.toThrow('binding changed during advice');
});

test('lost receipt responses retry without duplicate reads and clipped preparation consumes no unseen updates', async () => {
  const ids: string[] = [];
  for (let i = 0; i < 50; i++) {
    const node = (await api.invoke('node.add', {
      targetBoardId: board,
      type: 'markdown',
      title: `Decision ${i}`,
      content: 'A long decision. '.repeat(100),
    })) as { id: string };
    ids.push(node.id);
  }
  canvasState.withBoard(board, () => canvasState.setContextPins(ids));
  const store = open();
  const content = await store.context('clipped');
  const brief = briefIn(content);
  expect(brief.delivery.omittedEntries).toBeGreaterThan(0);
  const lastRevision = canvasState.withBoard(board, () => canvasState.getNode(ids.at(-1)!)!.contentRevision!);
  expect(brief.cursor.next).toBeLessThan(lastRevision);
  expect(canvasState.getContextReads().reads).toHaveLength(0);
  const real = process.env.PMX_CANVAS_URL!;
  let loseReply = true;
  const proxy = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const response = await fetch(new URL(url.pathname + url.search, real), {
        method: request.method,
        headers: request.headers,
        ...(request.method === 'POST' ? { body: await request.text() } : {}),
      });
      if (loseReply && url.pathname === '/api/canvas/ax/context-reads') {
        loseReply = false;
        await response.text();
        return new Response('Lost response', { status: 502 });
      }
      return response;
    },
  });
  process.env.PMX_CANVAS_URL = `http://localhost:${proxy.port}`;
  try {
    await expect(store.receive(token(content))).rejects.toThrow('502');
    const firstRead = canvasState.getContextReads().reads[0];
    close(store);
    const resumed = open();
    await resumed.receive(token(content));
    expect(canvasState.getContextReads().reads).toEqual([firstRead]);
    expect(firstRead.readNodes).toEqual({});
    expect(firstRead.deliveredNodeIds.length).toBeLessThan(ids.length);
    expect(canvasState.getContextReads().summary[0].readsDeliveringAllPins).toBe(0);
    const next = briefIn(await resumed.context('after-clipping'));
    expect(next.cursor.requested).toBe(brief.cursor.next);
    expect(next.cursor.requested).toBeLessThan(lastRevision);
  } finally {
    proxy.stop(true);
    process.env.PMX_CANVAS_URL = real;
  }
});

test('a receipt pruned before retry requires fresh context rather than an endless retry', async () => {
  const store = open();
  const receipt = token(await store.context('expired'));
  const read = {
    channel: 'adapter' as const,
    resource: 'amp:context',
    source: 'amp',
    consumer: `amp:${first}`,
    agentId: `amp:${first}`,
    pinnedNodeIds: [],
    deliveredNodeIds: [],
    bytes: 1,
  };
  // The server accepted this receipt, but the client has not received its response.
  await api.invoke('ax.reads.record', { ...read, boardId: board, deliveryId: receipt });
  // Seed the pruned log directly; context-reads.test.ts covers the retention boundary.
  // Thousands of durable writes here exceed the Windows test deadline before the retry.
  const db = new Database(join(root, '.pmx-canvas', 'canvas.db'));
  db.run('DELETE FROM context_reads WHERE id = ?', [canvasState.getContextReads().reads[0].id]);
  db.close();
  canvasState.recordContextRead(read, board);
  const before = canvasState.getContextReads().reads;
  await expect(store.receive(receipt)).rejects.toThrow('fresh context');
  expect(canvasState.getContextReads().reads).toEqual(before);
  expect(briefIn(await store.context('fresh-turn')).cursor.requested).toBeNull();
});

test('addressed steering bypasses broadcast backlog, reserves across pumps, and waits for action acknowledgment', async () => {
  for (let i = 0; i < 55; i++) await steer(`Broadcast ${i}`);
  const id = await steer('Change the bound decision.', `amp:${first}`);
  const other = await steer('Other recipient only.', `amp:${second}`);
  const host = thread();
  const one = open();
  const two = open();
  await Promise.all([one.poll(host.host), two.poll(host.host)]);
  expect(host.contents).toHaveLength(1);
  expect(host.contents[0]).toContain('Change the bound decision.');
  expect(host.contents[0]).not.toContain('Other recipient');
  const receipt = token(host.contents[0]);
  await expect(one.acknowledge(receipt)).rejects.toThrow('Receive');
  await one.receive(receipt);
  expect(canvasState.getPendingSteering({ consumer: `amp:${first}`, addressedOnly: true }).map((s) => s.id)).toEqual([
    id,
  ]);
  await one.acknowledge(receipt);
  await two.acknowledge(receipt);
  expect(canvasState.getPendingSteering({ consumer: `amp:${first}`, addressedOnly: true })).toEqual([]);
  expect(canvasState.getPendingSteering({ consumer: `amp:${second}`, addressedOnly: true }).map((s) => s.id)).toEqual([
    other,
  ]);
  expect(one.refuseStaleSteering(host.contents[0])).toBe(true);
  expect(canvasState.visibleBoardId).toBe(visible);
});

test('interrupted host sends reconcile exact transcript evidence and never resend automatically after restart', async () => {
  await steer('Apply once.', `amp:${first}`);
  const host = thread();
  const append = host.host.appendUserMessage;
  host.host.appendUserMessage = async (message, options) => {
    await append(message, options);
    throw new Error('Host lost reply after accepting');
  };
  const initial = open();
  await expect(initial.poll(host.host)).rejects.toThrow('lost reply');
  expect(initial.status()[0].state).toBe('uncertain');
  close(initial);
  const resumed = open();
  // An assistant quotation is not host acceptance evidence.
  host.messages[0].role = 'assistant';
  await resumed.poll(host.host);
  expect(resumed.status()[0].state).toBe('uncertain');
  expect(host.contents).toHaveLength(1);
  host.messages[0].role = 'user';
  await resumed.poll(host.host);
  expect(resumed.status()[0].state).toBe('accepted');
  expect(host.contents).toHaveLength(1);
  unbind(root, first);
  expect(resumed.refuseStaleSteering(host.contents[0])).toBe(true);
});

test('unknown sends need explicit retry and rebind prevents queued steering from acting on another board', async () => {
  await steer('Retry only with human permission.', `amp:${first}`);
  const host = thread();
  const store = open();
  await expect(
    store.poll({
      ...host.host,
      appendUserMessage: async () => {
        throw new Error('unknown');
      },
    }),
  ).rejects.toThrow('unknown');
  await store.poll(host.host);
  expect(host.contents).toEqual([]);
  store.retry(store.status()[0].token);
  await store.poll(host.host);
  expect(host.contents).toHaveLength(1);
  bind(root, first, visible);
  expect(store.refuseStaleSteering(host.contents[0])).toBe(true);
  await expect(store.receive(token(host.contents[0]))).rejects.toThrow('different binding');
  bind(root, first, board);
  expect(store.refuseStaleSteering(host.contents[0])).toBe(true);
  unbind(root, first);
  await store.dismiss(token(host.contents[0]));
  expect(store.status()).toEqual([]);
  expect(canvasState.getPendingSteering({ consumer: `amp:${first}`, addressedOnly: true })).toEqual([]);
});

test('unacknowledged and oversized steering cannot starve later instructions', async () => {
  const oversized = await steer('Large '.repeat(6000), `amp:${first}`);
  for (let i = 0; i < 51; i++) await steer(`Instruction ${i}`, `amp:${first}`);
  const store = open();
  const host = thread();
  await store.poll(host.host);
  await store.poll(host.host);
  await store.poll(host.host);
  expect(host.contents).toHaveLength(51);
  expect(host.contents.at(-1)).toContain('Instruction 50');
  const blocked = store.status().find((row) => row.state === 'blocked-size')!;
  expect(blocked).toBeDefined();
  await expect(store.receive(blocked.token)).rejects.toThrow('not been sent');
  await store.dismiss(blocked.token);
  expect(
    canvasState.getPendingSteering({ consumer: `amp:${first}`, addressedOnly: true }).some((s) => s.id === oversized),
  ).toBe(false);
});

test('cancellation during discovery sends neither context receipt nor action acknowledgment', async () => {
  const store = open();
  const context = await store.context('cancelled');
  const steering = await steer('Do not acknowledge on Stop.', `amp:${first}`);
  const host = thread();
  await store.poll(host.host);
  const receipt = token(host.contents[0]);
  await store.receive(receipt);
  const real = process.env.PMX_CANVAS_URL!;
  let entered = Promise.withResolvers<void>();
  let release = Promise.withResolvers<void>();
  let posts = 0;
  const proxy = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === 'POST') posts++;
      const response = await fetch(new URL(url.pathname + url.search, real), {
        method: request.method,
        headers: request.headers,
        ...(request.method === 'POST' ? { body: await request.text() } : {}),
      });
      if (url.pathname === '/health') {
        entered.resolve();
        await release.promise;
      }
      return response;
    },
  });
  process.env.PMX_CANVAS_URL = `http://localhost:${proxy.port}`;
  try {
    for (const invoke of [
      (signal: AbortSignal) => store.receive(token(context), signal),
      (signal: AbortSignal) => store.acknowledge(receipt, signal),
    ]) {
      entered = Promise.withResolvers<void>();
      release = Promise.withResolvers<void>();
      const controller = new AbortController();
      const pending = invoke(controller.signal).then(
        () => 'accepted',
        () => 'cancelled',
      );
      await entered.promise;
      controller.abort();
      release.resolve();
      expect(await pending).toBe('cancelled');
    }
    expect(posts).toBe(0);
    expect(canvasState.getContextReads().reads).toEqual([]);
    expect(canvasState.getPendingSteering({ consumer: `amp:${first}`, addressedOnly: true }).map((s) => s.id)).toEqual([
      steering,
    ]);
    expect(store.status()[0].state).toBe('received');
  } finally {
    release.resolve();
    proxy.stop(true);
    process.env.PMX_CANVAS_URL = real;
  }
});
