import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import {
  CallToolResultSchema,
  ProgressNotificationSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { canvasState } from '../../src/server/canvas-state.js';
import type { ContextReadInput } from '../../src/server/context-reads.js';
import {
  registerOperationTools,
  registerCompositeTools,
  LocalOperationInvoker,
  type OperationInvoker,
  type OperationToolHost,
} from '../../src/server/operations/index.js';
import { operationOutputSchema, operationToolAnnotations } from '../../src/server/operations/mcp-contracts.js';
import type { OperationExecutionOptions } from '../../src/server/operations/types.js';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests, waitForCondition } from './helpers.js';

let root: string;
const sessions: Array<{ server: McpServer; client: Client }> = [];
beforeEach(() => {
  root = createTestWorkspace('pmx-mcp-contracts-');
  resetCanvasForTests(root);
});
afterEach(async () => {
  for (const session of sessions.splice(0)) {
    await session.client.close();
    await session.server.close();
  }
  removeTestWorkspace(root);
});

async function session(invoker: OperationInvoker = new LocalOperationInvoker('mcp'), beforeHost?: () => Promise<void>) {
  const reads: ContextReadInput[] = [];
  const host: OperationToolHost = {
    invoker: () => invoker,
    getPinnedNodeIds: async () => [...canvasState.contextPinnedNodeIds],
    prepareContextRead: async () => ({
      boardId: canvasState.activeBoardId,
      pinnedNodeIds: [...canvasState.contextPinnedNodeIds],
    }),
    recordContextRead: async (read) => {
      reads.push(read);
    },
  };
  const server = new McpServer({ name: 'contract-test', version: '1' });
  const getHost = async () => {
    await beforeHost?.();
    return host;
  };
  registerOperationTools(server, getHost);
  registerCompositeTools(server, getHost);
  const client = new Client({ name: 'contract-consumer', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  sessions.push({ server, client });
  const { tools } = await client.listTools();
  const validator = new AjvJsonSchemaValidator();
  const call = async (name: string, args: Record<string, unknown> = {}, error = false) => {
    const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }, CallToolResultSchema));
    expect(result.isError === true, textOf(result)).toBe(error);
    const schema = tools.find((tool) => tool.name === name)?.outputSchema;
    expect(schema).toBeDefined();
    const validation = validator.getValidator(schema!)(result.structuredContent);
    expect(validation.valid, validation.errorMessage).toBe(true);
    return result;
  };
  return { client, server, tools, call, reads };
}

function textOf(result: CallToolResult): string {
  return result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}
function dataOf(result: CallToolResult): Record<string, unknown> {
  const envelope = result.structuredContent?.result as { data: Record<string, unknown> };
  expect(envelope.data).toEqual(JSON.parse(textOf(result)));
  return envelope.data;
}

describe('registry MCP output contracts', () => {
  test('all 21 tools advertise validating schemas and audited worst-case annotations', async () => {
    const { tools } = await session();
    expect(tools).toHaveLength(21);
    for (const tool of tools) {
      expect(tool.outputSchema?.type).toBe('object');
      expect(tool.annotations).toEqual(operationToolAnnotations(tool.name));
      const validate = new AjvJsonSchemaValidator().getValidator(tool.outputSchema!);
      expect(validate({}).valid).toBe(false);
      expect(validate({ result: { operation: 'not-an-operation', outcome: 'success', data: {} } }).valid).toBe(false);
    }
    // Negative controls for the old mutates-based classification: these all
    // write despite their operation records saying mutates:false.
    for (const name of [
      'canvas_pin_nodes',
      'canvas_history',
      'canvas_board',
      'canvas_ax_gate',
      'canvas_intent',
      'canvas_query',
    ]) {
      expect(tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint).toBe(false);
    }
    expect(tools.find((tool) => tool.name === 'canvas_webview')?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(tools.find((tool) => tool.name === 'canvas_invoke_command')?.annotations?.openWorldHint).toBe(false);
    expect(tools.find((tool) => tool.name === 'canvas_pin_nodes')?.annotations?.idempotentHint).toBe(true);
    expect(() => operationToolAnnotations('unreviewed-tool')).toThrow('Missing MCP annotation audit');
  });

  test('shared success contracts preserve operation/payload pairing and envelope strictness', async () => {
    const { tools } = await session();
    const cases = [
      {
        tool: 'canvas_board',
        operations: ['board.list', 'board.open', 'board.update', 'board.pin', 'board.unpin'],
        data: { ok: true, activeBoardId: null, boards: [{ id: 'board' }] },
        wrongOperations: ['board.get', 'board.create', 'board.create-from', 'knowledge.list'],
      },
      {
        tool: 'canvas_board',
        operations: ['board.get', 'board.create', 'board.create-from'],
        data: { ok: true, board: { id: 'board' } },
        wrongOperations: ['board.list', 'board.open', 'board.update', 'board.pin', 'board.unpin'],
      },
      {
        tool: 'canvas_node',
        operations: ['node.add', 'node.update'],
        data: { ok: true, id: 'node', contentRevision: 1 },
        wrongOperations: ['node.get', 'node.remove', 'node.lifecycle-get'],
      },
      {
        tool: 'canvas_render',
        operations: ['jsonrender.add', 'graph.add'],
        data: { ok: true, id: 'node' },
        wrongOperations: ['jsonrender.stream', 'schema.describe'],
      },
      {
        tool: 'canvas_webview',
        operations: ['webview.status', 'webview.start', 'webview.resize'],
        data: { supported: false, active: false },
        wrongOperations: ['webview.stop', 'webview.evaluate'],
      },
      {
        tool: 'canvas_view',
        operations: ['tour.set', 'annotation.remove'],
        data: { ok: true },
        wrongOperations: ['tour.get', 'tour.go', 'tour.exit', 'camera.move', 'view.fit', 'node.focus', 'canvas.clear'],
      },
      {
        tool: 'canvas_view',
        operations: ['tour.exit'],
        data: { ok: true, catalogEpoch: 'server-run', boardGeneration: 3, sequence: 7 },
        wrongOperations: ['tour.get', 'tour.go', 'camera.move', 'view.fit'],
      },
      {
        tool: 'canvas_ax_state',
        operations: ['ax.get', 'ax.policy.set', 'ax.host-capability.report', 'ax.presence.get', 'ax.presence.set'],
        data: { ok: true },
        wrongOperations: ['ax.focus.set'],
      },
      {
        tool: 'canvas_ax_timeline',
        operations: ['ax.timeline.get', 'ax.reads.list'],
        data: { ok: true },
        wrongOperations: ['ax.event.record', 'ax.evidence.add', 'ax.steer', 'ax.reads.status'],
      },
      {
        tool: 'canvas_history',
        operations: ['canvas.undo', 'canvas.redo'],
        data: { ok: true, description: 'Changed', canUndo: false, canRedo: true },
        wrongOperations: ['node.add'],
      },
    ];
    for (const { tool, operations, data, wrongOperations } of cases) {
      const validate = new AjvJsonSchemaValidator().getValidator(
        tools.find((entry) => entry.name === tool)!.outputSchema!,
      );
      for (const operation of operations) {
        const result = { operation, outcome: 'success', data };
        expect(validate({ result }).valid, operation).toBe(true);
        expect(validate({ result: { ...result, data: { ...data, extension: 'retained' } } }).valid).toBe(true);
        expect(validate({ result: { ...result, data: {} } }).valid).toBe(false);
        expect(validate({ result, extra: true }).valid).toBe(false);
        expect(validate({ result: { ...result, extra: true } }).valid).toBe(false);
        expect(validate({ result: { ...result, outcome: 'partial' } }).valid).toBe(false);
        expect(validate({ result: { operation, outcome: 'error', data: { message: 'Failed' } } }).valid).toBe(true);
        expect(
          validate({ result: { operation, outcome: 'error', data: { ok: false, error: 'Failed', id: 'receipt' } } })
            .valid,
        ).toBe(true);
      }
      for (const operation of [...wrongOperations, 'unknown.operation'])
        expect(validate({ result: { operation, outcome: 'success', data } }).valid, operation).toBe(false);
      expect(validate({ result: { operation: null, outcome: 'error', data: { message: 'Exception' } } }).valid).toBe(
        true,
      );
      expect(validate({ result: { operation: null, outcome: 'success', data } }).valid).toBe(false);
    }
  });

  test('node IDs, revisions and payload types reject invalid output and mismatched operations', async () => {
    const { call, tools } = await session();
    const created = await call('canvas_node', {
      action: 'add',
      type: 'markdown',
      title: 'Contract',
      content: 'Read this.',
    });
    const id = dataOf(created).id;
    const read = await call('canvas_node', { action: 'get', id, full: true });
    dataOf(read);
    const schema = tools.find((tool) => tool.name === 'canvas_node')!.outputSchema!;
    const validate = new AjvJsonSchemaValidator().getValidator(schema);
    for (const data of [
      { id: 7, type: 'markdown' },
      { id, type: 'markdown', contentRevision: -1 },
      { id, type: false },
    ]) {
      expect(validate({ result: { operation: 'node.get', outcome: 'success', data } }).valid).toBe(false);
    }
    expect(
      validate({ result: { operation: 'node.lifecycle-get', outcome: 'success', data: { id, type: 'markdown' } } })
        .valid,
    ).toBe(false);
    const lifecycle = dataOf(await call('canvas_node', { action: 'lifecycle-get', id }));
    expect(lifecycle.contentRevision).toBeNumber();
    const error = await call('canvas_node', { action: 'get', id: 'missing' }, true);
    expect(textOf(error)).toContain('not found');
  });

  test('invalid producer output is rejected; formatted JSON errors still match advertised schemas', async () => {
    const { call } = await session({
      async invoke(name) {
        if (name === 'node.get') return { id: 123, type: 'markdown', data: {} };
        if (name === 'webview.start')
          return { ok: false, error: 'Backend unavailable', webview: { supported: false, active: false } };
        if (name === 'node.add') return { ok: false, error: 'Fetch failed', id: 'partial-node' };
        if (name === 'canvas.batch')
          return {
            ok: false,
            cancelled: true,
            failedIndex: 1,
            error: 'Cancelled',
            results: [{ ok: true, id: 'completed-node' }],
            refs: { first: { ok: true, id: 'completed-node' } },
          };
        throw new Error(`Unexpected test operation ${name}`);
      },
    });
    const invalid = await call('canvas_node', { action: 'get', id: 'ignored' }, true);
    expect(textOf(invalid)).toContain('invalid_type');
    expect((invalid.structuredContent?.result as { outcome: string }).outcome).toBe('error');
    dataOf(await call('canvas_webview', { action: 'start' }, true));
    const failedNode = dataOf(
      await call('canvas_node', { action: 'add', type: 'webpage', url: 'https://example.com' }, true),
    );
    expect(failedNode.id).toBe('partial-node');
    const cancelled = await call('canvas_batch', { operations: [] }, true);
    expect(dataOf(cancelled).cancelled).toBe(true);
    expect((cancelled.structuredContent?.result as { outcome: string }).outcome).toBe('partial');
  });

  test('compact/full projections stay aligned and only delivered content is attributed', async () => {
    const { call, reads } = await session();
    const id = dataOf(
      await call('canvas_node', {
        action: 'add',
        type: 'status',
        title: 'Metadata only',
        data: { privateDetail: 'full only' },
      }),
    ).id;
    const before = reads.length;
    const compact = dataOf(await call('canvas_node', { action: 'get', id }));
    expect(compact.data).toBeUndefined();
    expect(reads).toHaveLength(before);
    const full = dataOf(await call('canvas_node', { action: 'get', id, full: true }));
    expect(full.data).toBeDefined();
    expect(reads).toHaveLength(before + 1);
    expect(reads.at(-1)?.consumer).toBe('contract-consumer');
    const textId = dataOf(await call('canvas_node', { action: 'add', type: 'markdown', content: 'Visible text' })).id;
    await call('canvas_node', { action: 'get', id: textId });
    expect(reads).toHaveLength(before + 2);
    dataOf(await call('canvas_query', { action: 'layout' }));
    dataOf(await call('canvas_query', { action: 'layout', full: true }));
  });

  test('batch errors preserve completed outcomes, references and cancellation fields', async () => {
    const { call, tools } = await session();
    const result = await call(
      'canvas_batch',
      {
        operations: [
          { op: 'node.add', assign: 'first', args: { type: 'markdown', content: 'Completed' } },
          { op: 'not-supported', args: {} },
        ],
      },
      true,
    );
    const data = dataOf(result);
    expect(data.failedIndex).toBe(1);
    expect(data.results).toHaveLength(1);
    expect((result.structuredContent?.result as { outcome: string }).outcome).toBe('partial');
    const refs = data.refs as { first: { id: string } };
    expect(canvasState.getNode(refs.first.id)).toBeDefined();
    const wrongOutcome = { result: { operation: 'canvas.batch', outcome: 'success', data } };
    expect(operationOutputSchema(['canvas.batch']).safeParse(wrongOutcome).success).toBe(false);
    const invalid = structuredClone(result.structuredContent);
    const receipt = invalid!.result as { data: { failedIndex: unknown } };
    receipt.data.failedIndex = 'one';
    expect(operationOutputSchema(['canvas.batch']).safeParse(invalid).success).toBe(false);
    const validate = new AjvJsonSchemaValidator().getValidator(
      tools.find((tool) => tool.name === 'canvas_batch')!.outputSchema!,
    );
    for (const outcome of ['success', 'error', 'partial']) {
      const envelope = { result: { operation: 'canvas.batch', outcome, data } };
      expect(validate(envelope).valid).toBe(outcome === 'partial');
      expect(operationOutputSchema(['canvas.batch']).safeParse(envelope).success).toBe(outcome === 'partial');
      const empty = { result: { operation: 'canvas.batch', outcome, data: { ...data, results: [], refs: {} } } };
      expect(validate(empty).valid).toBe(outcome === 'error');
      expect(operationOutputSchema(['canvas.batch']).safeParse(empty).success).toBe(outcome === 'error');
      const success = { result: { operation: 'canvas.batch', outcome, data: { ok: true, results: [], refs: {} } } };
      expect(validate(success).valid).toBe(outcome === 'success');
      expect(operationOutputSchema(['canvas.batch']).safeParse(success).success).toBe(outcome === 'success');
    }
    expect(validate(invalid).valid).toBe(false);
    expect(
      validate({ result: { operation: 'canvas.batch', outcome: 'error', data: { message: 'No receipt' } } }).valid,
    ).toBe(false);
  });

  test('representative composite reads, writes, prose, arrays and formatter follow-ups', async () => {
    const { call } = await session();
    const id = dataOf(
      await call('canvas_node', { action: 'add', type: 'markdown', title: 'Contract', content: 'Content' }),
    ).id;
    await call('canvas_pin_nodes', { nodeIds: [id] });
    await call('canvas_board', { action: 'list' });
    await call('canvas_board', { action: 'get' });
    await call('canvas_board', { action: 'knowledge-list' });
    await call('canvas_query', { action: 'context' });
    await call('canvas_query', { action: 'search', query: 'Contract' });
    await call('canvas_query', { action: 'graph' });
    await call('canvas_query', { action: 'validate' });
    await call('canvas_render', { action: 'describe-schema' });
    await call('canvas_render', { action: 'workboard' });
    await call('canvas_view', { action: 'get-tour' });
    await call('canvas_view', { action: 'fit' });
    await call('canvas_ax_state', { action: 'get' });
    await call('canvas_ax_state', { action: 'set-focus', nodeIds: [id] });
    await call('canvas_ax_work', { action: 'add', title: 'Work' });
    await call('canvas_ax_timeline', { action: 'record-event', kind: 'assistant-message', summary: 'Done' });
    await call('canvas_ax_delivery', { action: 'claim', consumer: 'contract-test' });
    await call('canvas_invoke_command', { name: 'pmx.plan' });
    await call('canvas_import', { action: 'list' });
    const snapshot = dataOf(await call('canvas_snapshot', { action: 'save', name: 'Before' })).id;
    await call('canvas_snapshot', { action: 'list' });
    const diff = await call('canvas_snapshot', { action: 'diff', snapshot });
    expect((diff.structuredContent?.result as { data: { message: string } }).data.message).toBe(textOf(diff));
    await call('canvas_node', { action: 'update', id, content: 'Changed' });
    await call('canvas_history', { action: 'undo' });
    await call('canvas_snapshot', { action: 'restore', id: snapshot });
    await call('canvas_snapshot', { action: 'gc', dryRun: true });
  });

  test('SDK progress is opt-in and signal/options reach formatter follow-up invocations', async () => {
    const observed: Array<{ name: string; options: OperationExecutionOptions | undefined }> = [];
    const local = new LocalOperationInvoker('mcp');
    const { client, call } = await session({
      async invoke(name, input, options) {
        observed.push({ name, options });
        await options?.onProgress?.({ progress: observed.length, message: name });
        return local.invoke(name, input, options);
      },
    });
    const notifications: unknown[] = [];
    client.setNotificationHandler(ProgressNotificationSchema, (notification) => {
      notifications.push(notification.params);
    });
    await call('canvas_history', { action: 'undo' });
    expect(notifications).toHaveLength(0);
    expect(observed.every((entry) => entry.options?.onProgress === undefined)).toBe(true);
    observed.length = 0;
    await client.callTool(
      { name: 'canvas_history', arguments: { action: 'undo' }, _meta: { progressToken: 0 } },
      CallToolResultSchema,
    );
    expect(observed.map((entry) => entry.name)).toEqual(['canvas.undo', 'history.get']);
    expect(observed[0].options?.signal).toBeInstanceOf(AbortSignal);
    expect(observed[1].options?.signal).toBe(observed[0].options?.signal);
    expect(observed[1].options?.onProgress).toBe(observed[0].options?.onProgress);
    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toEqual({ progressToken: 0, progress: 1, message: 'canvas.undo' });
  });

  test('public cancellation reaches a running invocation', async () => {
    let entered = false;
    let cancelled = false;
    const { client } = await session({
      async invoke(_name, _input, options) {
        entered = true;
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => {
              cancelled = true;
              reject(options.signal?.reason);
            },
            { once: true },
          );
        });
      },
    });
    const controller = new AbortController();
    const pending = client.callTool({ name: 'canvas_import', arguments: { action: 'list' } }, CallToolResultSchema, {
      signal: controller.signal,
    });
    const rejection = pending.then(
      () => null,
      (error: unknown) => error,
    );
    await waitForCondition(() => entered);
    controller.abort();
    expect(await rejection).toBeInstanceOf(Error);
    await waitForCondition(() => cancelled);
  });

  test.each([
    'canvas_import',
    'canvas_invoke_command',
  ])('cancellation during getHost prevents dispatch: %s', async (name) => {
    let entered = false;
    let invoked = false;
    let hostReturned = false;
    const ready = Promise.withResolvers<void>();
    const { client } = await session(
      {
        async invoke() {
          invoked = true;
          return { ok: true };
        },
      },
      async () => {
        entered = true;
        await ready.promise;
        hostReturned = true;
      },
    );
    const controller = new AbortController();
    const pending = client.callTool(
      { name, arguments: name === 'canvas_import' ? { action: 'list' } : { name: 'pmx.plan' } },
      CallToolResultSchema,
      { signal: controller.signal },
    );
    const rejected = pending.then(
      () => null,
      (error: unknown) => error,
    );
    await waitForCondition(() => entered);
    controller.abort();
    expect(await rejected).toBeInstanceOf(Error);
    ready.resolve();
    await waitForCondition(() => hostReturned);
    expect(invoked).toBe(false);
  });
});
