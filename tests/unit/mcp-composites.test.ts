// Parity + behavior tests for the plan-006 composite (action-discriminated)
// MCP tools. Each composite action dispatches to the same registered operation
// as its legacy standalone tool, reusing that op's buildInput/formatResult — so
// a composite action and its standalone tool must return identical results. The
// head-to-head reads below prove that; the mutation cases prove the wiring.
import { afterEach, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace, removeTestWorkspace } from './helpers.ts';

interface TextContentItem { type: string; text?: string }
interface ToolResultShape { content?: TextContentItem[]; isError?: boolean }

const mcpServerPath = fileURLToPath(new URL('../../src/mcp/server.ts', import.meta.url));

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to resolve an ephemeral port.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function textOf(result: ToolResultShape): string {
  return result.content?.find((item) => item.type === 'text')?.text ?? '';
}
function parseJsonText<T>(result: ToolResultShape): T {
  return JSON.parse(textOf(result)) as T;
}

const sessions: Array<{ transport: StdioClientTransport; workspaceRoot: string }> = [];

async function createMcpSession(): Promise<{ client: Client; port: number }> {
  const workspaceRoot = createTestWorkspace('pmx-canvas-mcp-composites-');
  const port = await getAvailablePort();
  const transport = new StdioClientTransport({
    command: 'bun',
    args: ['run', mcpServerPath],
    cwd: workspaceRoot,
    env: { ...process.env, PMX_CANVAS_DISABLE_BROWSER_OPEN: '1', PMX_CANVAS_PORT: String(port) },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'pmx-canvas-mcp-composites-test', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);
  sessions.push({ transport, workspaceRoot });
  return { client, port };
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResultShape> {
  return (await client.callTool({ name, arguments: args })) as ToolResultShape;
}

/**
 * Resolve the HTTP base URL of the in-process canvas server the MCP session
 * started. It binds the requested port, but may fall back if taken — probe a
 * small window from `port` upward until /health answers.
 */
async function resolveBaseUrl(port: number): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    for (let offset = 0; offset < 8; offset++) {
      const baseUrl = `http://127.0.0.1:${port + offset}`;
      try {
        const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(300) });
        if (response.ok) return baseUrl;
      } catch {
        // server not up yet on this candidate — keep probing.
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Canvas server did not become reachable.');
}

afterEach(async () => {
  while (sessions.length > 0) {
    const session = sessions.pop();
    if (!session) continue;
    await session.transport.close();
    removeTestWorkspace(session.workspaceRoot);
  }
});

describe('MCP composite tools (plan-006)', () => {
  test('canvas_node folds add/get/update/remove and matches canvas_get_node', async () => {
    const { client } = await createMcpSession();

    const added = parseJsonText<{ id: string }>(
      await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'Composite', content: '# Hi' }),
    );
    expect(added.id).toBeTruthy();

    // Head-to-head read parity: composite `get` === standalone canvas_get_node.
    const viaComposite = parseJsonText(await call(client, 'canvas_node', { action: 'get', id: added.id }));
    const viaStandalone = parseJsonText(await call(client, 'canvas_get_node', { id: added.id }));
    expect(viaComposite).toEqual(viaStandalone);

    await call(client, 'canvas_node', { action: 'update', id: added.id, title: 'Renamed' });
    // node.get formatResult returns the compact node payload at top level.
    const afterUpdate = parseJsonText<{ title?: string }>(
      await call(client, 'canvas_node', { action: 'get', id: added.id }),
    );
    expect(afterUpdate.title).toBe('Renamed');

    const removed = parseJsonText<{ ok?: boolean }>(await call(client, 'canvas_node', { action: 'remove', id: added.id }));
    expect(removed.ok).toBe(true);
    const missing = await call(client, 'canvas_node', { action: 'get', id: added.id });
    expect(missing.isError).toBe(true);
  }, 30000);

  test('canvas_query search/layout match canvas_search/canvas_get_layout', async () => {
    const { client } = await createMcpSession();
    await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'Findable', content: 'needle' });

    const searchComposite = parseJsonText(await call(client, 'canvas_query', { action: 'search', query: 'Findable' }));
    const searchStandalone = parseJsonText(await call(client, 'canvas_search', { query: 'Findable' }));
    expect(searchComposite).toEqual(searchStandalone);

    const layoutComposite = parseJsonText(await call(client, 'canvas_query', { action: 'layout' }));
    const layoutStandalone = parseJsonText(await call(client, 'canvas_get_layout', {}));
    expect(layoutComposite).toEqual(layoutStandalone);
  }, 30000);

  test('canvas_query validate matches canvas_validate', async () => {
    const { client } = await createMcpSession();
    await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'Validatable', content: 'x' });

    // Head-to-head read parity: composite `validate` === standalone canvas_validate.
    const validateComposite = parseJsonText<{ ok?: boolean; summary?: { nodes?: number } }>(
      await call(client, 'canvas_query', { action: 'validate' }),
    );
    const validateStandalone = parseJsonText(await call(client, 'canvas_validate', {}));
    expect(validateComposite).toEqual(validateStandalone);
    // The result carries the validation shape (a board summary), not a generic ok.
    expect(validateComposite.summary?.nodes).toBeGreaterThanOrEqual(1);
  }, 30000);

  test('canvas_view remove-annotation removes a drawn annotation; a missing id is a loud error', async () => {
    const { client, port } = await createMcpSession();
    // A tool call triggers ensureCanvas(), which starts the in-process canvas
    // HTTP server (lazily — not at connect time).
    await call(client, 'canvas_query', { action: 'layout' });
    // Seed a freehand annotation through the now-running public HTTP API (no MCP
    // tool draws annotations — humans do, in the browser).
    const baseUrl = await resolveBaseUrl(port);
    const annotationId = 'ann-composite-test';
    const created = await fetch(`${baseUrl}/api/canvas/annotation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: annotationId, type: 'freehand', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }),
    });
    expect((await created.json() as { ok?: boolean }).ok).toBe(true);

    const removed = parseJsonText<{ ok?: boolean; removed?: string }>(
      await call(client, 'canvas_view', { action: 'remove-annotation', id: annotationId }),
    );
    expect(removed.ok).toBe(true);
    expect(removed.removed).toBe(annotationId);

    // A non-existent id is a loud error (404 OperationError → isError tool result).
    const missing = await call(client, 'canvas_view', { action: 'remove-annotation', id: 'does-not-exist' });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain('not found');

    // An OMITTED id is a 400, not a misleading 404 — the composite widens `id` to
    // optional (node.focus also contributes it), so the handler guards it.
    const noId = await call(client, 'canvas_view', { action: 'remove-annotation' });
    expect(noId.isError).toBe(true);
    expect(textOf(noId)).toContain('Missing id');
  }, 30000);

  test('canvas_render describe-schema/validate/add-graph match standalone tools', async () => {
    const { client } = await createMcpSession();

    const schemaComposite = parseJsonText(await call(client, 'canvas_render', { action: 'describe-schema' }));
    const schemaStandalone = parseJsonText(await call(client, 'canvas_describe_schema', {}));
    expect(schemaComposite).toEqual(schemaStandalone);

    const valid = parseJsonText<{ ok?: boolean }>(
      await call(client, 'canvas_render', {
        action: 'validate',
        type: 'graph',
        graphType: 'bar',
        data: [{ label: 'A', value: 1 }],
        xKey: 'label',
        yKey: 'value',
      }),
    );
    expect(valid.ok).toBe(true);

    const graph = parseJsonText<{ id?: string; url?: string }>(
      await call(client, 'canvas_render', {
        action: 'add-graph',
        title: 'Bars',
        graphType: 'bar',
        data: [{ label: 'A', value: 1 }],
        xKey: 'label',
        yKey: 'value',
      }),
    );
    expect(graph.id).toBeTruthy();
    expect(graph.url).toContain('/api/canvas/json-render/view?nodeId=');
  }, 30000);

  test('canvas_edge folds add/remove', async () => {
    const { client } = await createMcpSession();
    const a = parseJsonText<{ id: string }>(await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'A' }));
    const b = parseJsonText<{ id: string }>(await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'B' }));

    const edge = parseJsonText<{ id?: string; from?: string; to?: string; type?: string }>(
      await call(client, 'canvas_edge', { action: 'add', from: a.id, to: b.id, type: 'flow' }),
    );
    expect(edge.id).toBeTruthy();
    expect(edge.from).toBe(a.id);
    expect(edge.to).toBe(b.id);
    expect(edge.type).toBe('flow');

    const removed = parseJsonText<{ ok?: boolean; removed?: string }>(
      await call(client, 'canvas_edge', { action: 'remove', id: edge.id }),
    );
    expect(removed.ok).toBe(true);
  }, 30000);

  test('canvas_group create/ungroup and canvas_view focus/fit/arrange', async () => {
    const { client } = await createMcpSession();
    const node = parseJsonText<{ id: string }>(await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'Grouped' }));

    const group = parseJsonText<{ id?: string; groupId?: string }>(
      await call(client, 'canvas_group', { action: 'create', title: 'G', childIds: [node.id] }),
    );
    const groupId = group.id ?? group.groupId;
    expect(groupId).toBeTruthy();

    // node.focus uses `id` (the composite schema is derived from the op's shape).
    expect((await call(client, 'canvas_view', { action: 'focus', id: node.id })).isError ?? false).toBe(false);
    expect((await call(client, 'canvas_view', { action: 'fit' })).isError ?? false).toBe(false);
    expect((await call(client, 'canvas_view', { action: 'arrange' })).isError ?? false).toBe(false);

    const ungrouped = parseJsonText<{ ok?: boolean }>(await call(client, 'canvas_group', { action: 'ungroup', groupId }));
    expect(ungrouped.ok).toBe(true);
  }, 30000);

  test('canvas_history undo/redo reverse the last mutation', async () => {
    const { client } = await createMcpSession();
    const node = parseJsonText<{ id: string }>(await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'Undoable' }));

    expect((await call(client, 'canvas_history', { action: 'undo' })).isError ?? false).toBe(false);
    // After undo, the node add is reversed → get errors.
    expect((await call(client, 'canvas_node', { action: 'get', id: node.id })).isError).toBe(true);

    expect((await call(client, 'canvas_history', { action: 'redo' })).isError ?? false).toBe(false);
    // After redo, the node is back.
    expect((await call(client, 'canvas_node', { action: 'get', id: node.id })).isError ?? false).toBe(false);
  }, 30000);

  test('an unknown action is a loud error, not a silent no-op', async () => {
    const { client } = await createMcpSession();
    const result = await call(client, 'canvas_node', { action: 'frobnicate', id: 'x' });
    // The derived `action` enum rejects unknown actions loudly at the schema
    // validation layer (before dispatch) — never a silent no-op.
    expect(result.isError).toBe(true);
    expect(textOf(result).toLowerCase()).toContain('action');
  }, 30000);
});

// ── AX composites (plan-007 Slice C) ──────────────────────────────────────────
// Each AX composite action dispatches to the same registry op as its legacy
// standalone tool (reusing buildInput/formatResult), so a composite action is
// byte-identical to the standalone tool. Head-to-head equality where it is a read;
// behavior assertions where it mutates.
describe('MCP AX composite tools (plan-007 Slice C)', () => {
  test('canvas_ax_state get/set-focus/set-policy/report-capability match standalone tools', async () => {
    const { client } = await createMcpSession();
    const node = parseJsonText<{ id: string }>(
      await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'AX state' }),
    );

    // Head-to-head read parity: composite `get` === standalone canvas_get_ax.
    // includeContext:false drops the agent context block, whose `generatedAt`
    // timestamp differs by ms between two separate calls (the bodies are
    // byte-identical by construction — same op, same buildInput — apart from it).
    const getComposite = parseJsonText(await call(client, 'canvas_ax_state', { action: 'get', includeContext: false }));
    const getStandalone = parseJsonText(await call(client, 'canvas_get_ax', { includeContext: false }));
    expect(getComposite).toEqual(getStandalone);

    // set-focus → ax.focus.set; the focus field reflects the node.
    const focus = parseJsonText<{ ok?: boolean; focus?: { nodeIds?: string[] } }>(
      await call(client, 'canvas_ax_state', { action: 'set-focus', nodeIds: [node.id] }),
    );
    expect(focus.ok).toBe(true);
    expect(focus.focus?.nodeIds).toEqual([node.id]);

    // set-policy → ax.policy.set; patch merges into the policy.
    const policy = parseJsonText<{ ok?: boolean; policy?: { tools?: { allowed?: string[] } } }>(
      await call(client, 'canvas_ax_state', { action: 'set-policy', tools: { allowed: ['pmx.plan'] } }),
    );
    expect(policy.ok).toBe(true);
    expect(policy.policy?.tools?.allowed).toContain('pmx.plan');

    // report-capability → ax.host-capability.report.
    const cap = parseJsonText<{ ok?: boolean; host?: { host?: string } }>(
      await call(client, 'canvas_ax_state', { action: 'report-capability', host: 'codex', tools: true }),
    );
    expect(cap.ok).toBe(true);
    expect(cap.host?.host).toBe('codex');
  }, 30000);

  test('canvas_ax_work add/update/annotate match standalone tools', async () => {
    const { client } = await createMcpSession();
    const node = parseJsonText<{ id: string }>(
      await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'Reviewable' }),
    );

    const added = parseJsonText<{ ok?: boolean; workItem?: { id: string; status?: string } }>(
      await call(client, 'canvas_ax_work', { action: 'add', title: 'Build it', status: 'todo' }),
    );
    expect(added.ok).toBe(true);
    expect(added.workItem?.id).toBeTruthy();

    const updated = parseJsonText<{ ok?: boolean; workItem?: { status?: string } }>(
      await call(client, 'canvas_ax_work', { action: 'update', id: added.workItem!.id, status: 'done' }),
    );
    expect(updated.ok).toBe(true);
    expect(updated.workItem?.status).toBe('done');

    const annotated = parseJsonText<{ ok?: boolean; reviewAnnotation?: { id: string } }>(
      await call(client, 'canvas_ax_work', {
        action: 'annotate',
        body: 'Looks good',
        kind: 'comment',
        anchorType: 'node',
        nodeId: node.id,
      }),
    );
    expect(annotated.ok).toBe(true);
    expect(annotated.reviewAnnotation?.id).toBeTruthy();
  }, 30000);

  test('canvas_ax_timeline read/record-event/add-evidence/send-steering match standalone tools', async () => {
    const { client } = await createMcpSession();

    const event = parseJsonText<{ ok?: boolean; event?: { kind?: string } }>(
      await call(client, 'canvas_ax_timeline', { action: 'record-event', kind: 'tool-start', summary: 'started' }),
    );
    expect(event.ok).toBe(true);
    expect(event.event?.kind).toBe('tool-start');

    const evidence = parseJsonText<{ ok?: boolean; evidence?: { kind?: string } }>(
      await call(client, 'canvas_ax_timeline', { action: 'add-evidence', kind: 'logs', title: 'run.log' }),
    );
    expect(evidence.ok).toBe(true);
    expect(evidence.evidence?.kind).toBe('logs');

    const steering = parseJsonText<{ ok?: boolean; steering?: { message?: string } }>(
      await call(client, 'canvas_ax_timeline', { action: 'send-steering', message: 'focus on tests' }),
    );
    expect(steering.ok).toBe(true);
    expect(steering.steering?.message).toBe('focus on tests');

    // Head-to-head read parity: composite `read` === standalone canvas_get_ax_timeline.
    const readComposite = parseJsonText(await call(client, 'canvas_ax_timeline', { action: 'read' }));
    const readStandalone = parseJsonText(await call(client, 'canvas_get_ax_timeline', {}));
    expect(readComposite).toEqual(readStandalone);
  }, 30000);

  test('canvas_ax_delivery claim/mark match standalone tools', async () => {
    const { client } = await createMcpSession();
    // Steering originated by `browser` so the `mcp` consumer can claim it (loop-safe).
    const steering = parseJsonText<{ steering?: { id: string } }>(
      await call(client, 'canvas_ax_timeline', { action: 'send-steering', message: 'do the thing', source: 'browser' }),
    );
    const steeringId = steering.steering!.id;

    // Head-to-head read parity: composite `claim` === standalone canvas_claim_ax_delivery.
    const claimComposite = parseJsonText(await call(client, 'canvas_ax_delivery', { action: 'claim', consumer: 'mcp' }));
    const claimStandalone = parseJsonText(await call(client, 'canvas_claim_ax_delivery', { consumer: 'mcp' }));
    expect(claimComposite).toEqual(claimStandalone);

    const marked = parseJsonText<{ ok?: boolean; delivered?: boolean }>(
      await call(client, 'canvas_ax_delivery', { action: 'mark', id: steeringId }),
    );
    expect(marked.ok).toBe(true);
    expect(marked.delivered).toBe(true);
  }, 30000);

  test('canvas_ax_gate folds approval request → resolve (kind × action)', async () => {
    const { client } = await createMcpSession();
    const requested = parseJsonText<{ ok?: boolean; approvalGate?: { id: string; status?: string; action?: string } }>(
      await call(client, 'canvas_ax_gate', {
        kind: 'approval',
        action: 'request',
        title: 'Deploy to prod',
        // approvalAction is the namespaced machine-readable identifier — it must
        // NOT collide with the `action` lifecycle discriminator.
        approvalAction: 'deploy',
      }),
    );
    expect(requested.ok).toBe(true);
    expect(requested.approvalGate?.status).toBe('pending');
    // The remapped approvalAction round-trips to the op's `action` field.
    expect(requested.approvalGate?.action).toBe('deploy');

    const resolved = parseJsonText<{ ok?: boolean; approvalGate?: { status?: string } }>(
      await call(client, 'canvas_ax_gate', {
        kind: 'approval',
        action: 'resolve',
        id: requested.approvalGate!.id,
        decision: 'approved',
      }),
    );
    expect(resolved.ok).toBe(true);
    expect(resolved.approvalGate?.status).toBe('approved');
  }, 30000);

  test('canvas_ax_gate folds elicitation request → resolve (resolve → respond op)', async () => {
    const { client } = await createMcpSession();
    const requested = parseJsonText<{ ok?: boolean; elicitation?: { id: string; status?: string } }>(
      await call(client, 'canvas_ax_gate', { kind: 'elicitation', action: 'request', prompt: 'Pick a branch' }),
    );
    expect(requested.ok).toBe(true);
    expect(requested.elicitation?.status).toBe('pending');

    // resolve for elicitation routes to ax.elicitation.respond (carries `response`).
    const resolved = parseJsonText<{ ok?: boolean; elicitation?: { status?: string } }>(
      await call(client, 'canvas_ax_gate', {
        kind: 'elicitation',
        action: 'resolve',
        id: requested.elicitation!.id,
        response: { branch: 'main' },
      }),
    );
    expect(resolved.ok).toBe(true);
    expect(resolved.elicitation?.status).not.toBe('pending');
  }, 30000);

  test('canvas_ax_gate folds mode request and an immediate await read', async () => {
    const { client } = await createMcpSession();
    const requested = parseJsonText<{ ok?: boolean; modeRequest?: { id: string; status?: string } }>(
      await call(client, 'canvas_ax_gate', { kind: 'mode', action: 'request', mode: 'plan' }),
    );
    expect(requested.ok).toBe(true);
    expect(requested.modeRequest?.status).toBe('pending');

    // await (action → ax.mode.get) with timeoutMs 0 is an immediate read; the
    // gate is still pending, so pending=true and the composite read === standalone.
    const awaitComposite = parseJsonText<{ pending?: boolean }>(
      await call(client, 'canvas_ax_gate', { kind: 'mode', action: 'await', id: requested.modeRequest!.id, timeoutMs: 0 }),
    );
    const awaitStandalone = parseJsonText(
      await call(client, 'canvas_await_mode', { id: requested.modeRequest!.id, timeoutMs: 0 }),
    );
    expect(awaitComposite.pending).toBe(true);
    expect(awaitComposite).toEqual(awaitStandalone);
  }, 30000);

  test('canvas_ax_gate rejects an invalid kind/action combo loudly', async () => {
    const { client } = await createMcpSession();
    // Invalid kind: the `kind` enum rejects it at the schema layer.
    const badKind = await call(client, 'canvas_ax_gate', { kind: 'nonsense', action: 'request' });
    expect(badKind.isError).toBe(true);

    // Invalid action: the `action` enum rejects it at the schema layer.
    const badAction = await call(client, 'canvas_ax_gate', { kind: 'approval', action: 'frobnicate' });
    expect(badAction.isError).toBe(true);
  }, 30000);
});
