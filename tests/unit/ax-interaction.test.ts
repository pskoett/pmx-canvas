import { describe, expect, test } from 'bun:test';
import {
  applyAxInteraction,
  DEFAULT_NODE_AX_CAPABILITIES,
  normalizeNodeAxCapabilities,
  resolveNodeAxCapabilities,
  type AxInteractionManager,
} from '../../src/server/ax-interaction.ts';
import type { CanvasNodeState } from '../../src/server/canvas-state.ts';

function makeNode(type: CanvasNodeState['type'], data: Record<string, unknown> = {}): CanvasNodeState {
  return {
    id: `${type}-1`,
    type,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data,
  };
}

// Minimal manager mock: getNode resolves the single node; ops return plausible
// primitives and record their calls so tests can assert dispatch + mapping.
function makeManager(node: CanvasNodeState | undefined) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const rec = (op: string, ...args: unknown[]) => calls.push({ op, args });
  const manager: AxInteractionManager = {
    getNode: (id) => (node && node.id === id ? node : undefined),
    recordAxEvent: (input, o) => {
      rec('recordAxEvent', input, o);
      return {
        id: 'ev1',
        seq: 1,
        kind: input.kind,
        summary: input.summary,
        detail: input.detail ?? null,
        nodeIds: input.nodeIds ?? [],
        data: input.data ?? null,
        createdAt: 't',
        source: o?.source ?? null,
      };
    },
    recordSteeringMessage: (message, o) => {
      rec('recordSteeringMessage', message, o);
      return { id: 's1', seq: 1, message, delivered: false, createdAt: 't', source: o?.source ?? null };
    },
    addWorkItem: (input, o) => {
      rec('addWorkItem', input, o);
      return {
        id: 'w1',
        title: input.title,
        status: input.status ?? 'todo',
        detail: input.detail ?? null,
        nodeIds: input.nodeIds ?? [],
        createdAt: 't',
        updatedAt: 't',
        source: o?.source ?? null,
      };
    },
    updateWorkItem: (id, patch, o) => {
      rec('updateWorkItem', id, patch, o);
      return id === 'missing'
        ? null
        : {
            id,
            title: patch.title ?? 'x',
            status: patch.status ?? 'todo',
            detail: patch.detail ?? null,
            nodeIds: patch.nodeIds ?? [],
            createdAt: 't',
            updatedAt: 't',
            source: o?.source ?? null,
          };
    },
    addEvidence: (input, o) => {
      rec('addEvidence', input, o);
      return {
        id: 'ev2',
        seq: 1,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        ref: input.ref ?? null,
        nodeIds: input.nodeIds ?? [],
        data: input.data ?? null,
        createdAt: 't',
        source: o?.source ?? null,
      };
    },
    requestApproval: (input, o) => {
      rec('requestApproval', input, o);
      return {
        id: 'a1',
        title: input.title,
        detail: input.detail ?? null,
        action: input.action ?? null,
        status: 'pending',
        nodeIds: input.nodeIds ?? [],
        createdAt: 't',
        resolvedAt: null,
        resolution: null,
        source: o?.source ?? null,
      };
    },
    resolveApproval: (id, decision, o) => {
      rec('resolveApproval', id, decision, o);
      return id === 'missing'
        ? null
        : {
            id,
            title: 'x',
            detail: null,
            action: null,
            status: decision,
            nodeIds: [],
            createdAt: 't',
            resolvedAt: 't',
            resolution: o?.resolution ?? null,
            source: o?.source ?? null,
          };
    },
    addReviewAnnotation: (input, o) => {
      rec('addReviewAnnotation', input, o);
      return {
        id: 'r1',
        kind: input.kind ?? 'comment',
        body: input.body,
        severity: input.severity ?? 'info',
        status: 'open',
        anchorType: input.anchorType ?? 'node',
        nodeId: input.nodeId ?? null,
        file: input.file ?? null,
        region: input.region ?? null,
        author: input.author ?? null,
        createdAt: 't',
        updatedAt: 't',
        source: o?.source ?? null,
      };
    },
    setAxFocus: (nodeIds, o) => {
      rec('setAxFocus', nodeIds, o);
      return { nodeIds, primaryNodeId: nodeIds[0] ?? null, updatedAt: 't', source: o?.source ?? null };
    },
    requestElicitation: (input, o) => {
      rec('requestElicitation', input, o);
      return {
        id: 'el1',
        prompt: input.prompt,
        fields: input.fields ?? [],
        status: 'pending',
        response: null,
        nodeIds: input.nodeIds ?? [],
        createdAt: 't',
        resolvedAt: null,
        source: o?.source ?? null,
      };
    },
    requestMode: (input, o) => {
      rec('requestMode', input, o);
      return {
        id: 'mo1',
        mode: input.mode,
        reason: input.reason ?? null,
        status: 'pending',
        nodeIds: input.nodeIds ?? [],
        createdAt: 't',
        resolvedAt: null,
        resolution: null,
        source: o?.source ?? null,
      };
    },
    invokeCommand: (name, args, o) => {
      rec('invokeCommand', name, args, o);
      return name === 'pmx.plan'
        ? {
            id: 'cmd1',
            seq: 1,
            kind: 'command',
            summary: name,
            detail: null,
            nodeIds: [],
            data: { command: name },
            createdAt: 't',
            source: o?.source ?? null,
          }
        : null;
    },
  };
  return { manager, calls };
}

describe('resolveNodeAxCapabilities', () => {
  test('returns type defaults when no per-node override', () => {
    const caps = resolveNodeAxCapabilities(makeNode('status'));
    expect(caps.enabled).toBe(true);
    expect(caps.allowed).toContain('ax.work.create');
  });

  test('html is disabled by default (opt-in)', () => {
    expect(resolveNodeAxCapabilities(makeNode('html')).enabled).toBe(false);
  });

  test('per-node override can opt-in and narrow within the ceiling', () => {
    const caps = resolveNodeAxCapabilities(
      makeNode('html', { axCapabilities: { enabled: true, allowed: ['ax.work.create'] } }),
    );
    expect(caps.enabled).toBe(true);
    expect(caps.allowed).toEqual(['ax.work.create']);
  });

  test('per-node override cannot grant beyond the type ceiling', () => {
    // file ceiling has no ax.steer; a malicious/erroneous override is clamped out.
    const caps = resolveNodeAxCapabilities(
      makeNode('file', { axCapabilities: { enabled: true, allowed: ['ax.steer', 'ax.evidence.add'] } }),
    );
    expect(caps.allowed).toEqual(['ax.evidence.add']);
  });

  test('every node type has a registry entry', () => {
    for (const entry of Object.values(DEFAULT_NODE_AX_CAPABILITIES)) {
      expect(Array.isArray(entry.allowed)).toBe(true);
    }
  });
});

describe('normalizeNodeAxCapabilities', () => {
  test('drops unknown interaction types and invalid shapes', () => {
    expect(normalizeNodeAxCapabilities({ enabled: true, allowed: ['ax.work.create', 'nope'] })).toEqual({
      enabled: true,
      allowed: ['ax.work.create'],
    });
    expect(normalizeNodeAxCapabilities('bad')).toBeNull();
    expect(normalizeNodeAxCapabilities({})).toBeNull();
  });
});

describe('applyAxInteraction', () => {
  test('accepts an allowed interaction and maps it to the AX op', () => {
    const { manager, calls } = makeManager(makeNode('status'));
    const { result, events } = applyAxInteraction(
      manager,
      { type: 'ax.work.create', sourceNodeId: 'status-1', payload: { title: 'Wire auth' } },
      'api',
    );
    expect(result.ok).toBe(true);
    expect(calls.some((c) => c.op === 'addWorkItem')).toBe(true);
    // defaults nodeIds to the source node
    const addCall = calls.find((c) => c.op === 'addWorkItem');
    expect((addCall?.args[0] as { nodeIds: string[] }).nodeIds).toEqual(['status-1']);
    // emits an outcome event plus the primitive state event
    expect(events.map((e) => e.event)).toEqual(['ax-interaction', 'ax-state-changed']);
  });

  test('rejects an interaction the node type cannot emit', () => {
    const { manager, calls } = makeManager(makeNode('file'));
    const { result } = applyAxInteraction(
      manager,
      { type: 'ax.steer', sourceNodeId: 'file-1', payload: { message: 'go' } },
      'api',
    );
    expect(result).toMatchObject({ ok: false, code: 'not-allowed', status: 403 });
    expect(calls.some((c) => c.op === 'recordSteeringMessage')).toBe(false);
  });

  test('rejects when AX is disabled for the node', () => {
    const { manager } = makeManager(makeNode('html'));
    const { result } = applyAxInteraction(
      manager,
      { type: 'ax.work.create', sourceNodeId: 'html-1', payload: { title: 'x' } },
      'api',
    );
    expect(result).toMatchObject({ ok: false, code: 'ax-disabled', status: 403 });
  });

  test('rejects an unknown source node', () => {
    const { manager } = makeManager(undefined);
    const { result } = applyAxInteraction(
      manager,
      { type: 'ax.work.create', sourceNodeId: 'ghost', payload: { title: 'x' } },
      'api',
    );
    expect(result).toMatchObject({ ok: false, code: 'unknown-node', status: 404 });
  });

  test('rejects an invalid payload', () => {
    const { manager } = makeManager(makeNode('status'));
    const { result } = applyAxInteraction(
      manager,
      { type: 'ax.work.create', sourceNodeId: 'status-1', payload: {} },
      'api',
    );
    expect(result).toMatchObject({ ok: false, code: 'invalid-payload', status: 400 });
  });

  test('rejects a malformed envelope', () => {
    const { manager } = makeManager(makeNode('status'));
    const { result } = applyAxInteraction(manager, { type: 'ax.work.create' }, 'api');
    expect(result).toMatchObject({ ok: false, code: 'invalid-envelope' });
  });

  test('maps evidence / review / approval / steer to their ops', () => {
    const file = makeManager(makeNode('file'));
    expect(
      applyAxInteraction(
        file.manager,
        { type: 'ax.evidence.add', sourceNodeId: 'file-1', payload: { kind: 'file', title: 'log' } },
        'api',
      ).result.ok,
    ).toBe(true);
    expect(file.calls.some((c) => c.op === 'addEvidence')).toBe(true);

    const file2 = makeManager(makeNode('file'));
    const review = applyAxInteraction(
      file2.manager,
      { type: 'ax.review.add', sourceNodeId: 'file-1', payload: { body: 'looks off' } },
      'api',
    );
    expect(review.result.ok).toBe(true);
    expect((file2.calls.find((c) => c.op === 'addReviewAnnotation')?.args[0] as { nodeId: string }).nodeId).toBe(
      'file-1',
    );

    const status = makeManager(makeNode('status'));
    expect(
      applyAxInteraction(
        status.manager,
        { type: 'ax.approval.request', sourceNodeId: 'status-1', payload: { title: 'Deploy?' } },
        'api',
      ).result.ok,
    ).toBe(true);
    expect(status.calls.some((c) => c.op === 'requestApproval')).toBe(true);

    const md = makeManager(makeNode('markdown'));
    expect(
      applyAxInteraction(
        md.manager,
        { type: 'ax.steer', sourceNodeId: 'markdown-1', payload: { message: 'go' } },
        'api',
      ).result.ok,
    ).toBe(true);
    expect(md.calls.some((c) => c.op === 'recordSteeringMessage')).toBe(true);
  });

  test('maps elicitation + mode requests (Phase 5 primitives)', () => {
    const jr = makeManager(makeNode('json-render'));
    const elic = applyAxInteraction(
      jr.manager,
      {
        type: 'ax.elicitation.request',
        sourceNodeId: 'json-render-1',
        payload: { prompt: 'owner?', fields: ['owner'] },
      },
      'api',
    );
    expect(elic.result.ok).toBe(true);
    expect(jr.calls.some((c) => c.op === 'requestElicitation')).toBe(true);

    const st = makeManager(makeNode('status'));
    const mode = applyAxInteraction(
      st.manager,
      { type: 'ax.mode.request', sourceNodeId: 'status-1', payload: { mode: 'execute', reason: 'plan approved' } },
      'api',
    );
    expect(mode.result.ok).toBe(true);
    expect(st.calls.some((c) => c.op === 'requestMode')).toBe(true);

    // mode requires a valid enum value
    const bad = applyAxInteraction(
      makeManager(makeNode('status')).manager,
      { type: 'ax.mode.request', sourceNodeId: 'status-1', payload: { mode: 'turbo' } },
      'api',
    );
    expect(bad.result).toMatchObject({ ok: false, code: 'invalid-payload' });
  });

  test('sandboxed surfaces cannot target arbitrary nodes (nodeIds clamped to source)', () => {
    const { manager, calls } = makeManager(
      makeNode('html', { axCapabilities: { enabled: true, allowed: ['ax.focus.set', 'ax.work.create'] } }),
    );
    // html-node surface tries to focus a DIFFERENT node — must be clamped to source.
    const focus = applyAxInteraction(
      manager,
      {
        type: 'ax.focus.set',
        sourceNodeId: 'html-1',
        sourceSurface: 'html-node',
        payload: { nodeIds: ['other-node', 'another'] },
      },
      'browser',
    );
    expect(focus.result.ok).toBe(true);
    expect(calls.find((c) => c.op === 'setAxFocus')?.args[0]).toEqual(['html-1']);

    const work = applyAxInteraction(
      manager,
      {
        type: 'ax.work.create',
        sourceNodeId: 'html-1',
        sourceSurface: 'html-node',
        payload: { title: 'x', nodeIds: ['victim'] },
      },
      'browser',
    );
    expect((work.result as { primitive: { nodeIds: string[] } }).primitive.nodeIds).toEqual(['html-1']);
  });

  test('json-render viewer surface is scoped to its own node (author spec cannot target other nodes)', () => {
    // json-render is enabled by default with ax.work.create; the viewer bridge is a
    // sandboxed opaque-origin iframe, so caller-supplied nodeIds must clamp to source.
    const { manager } = makeManager(makeNode('json-render'));
    const work = applyAxInteraction(
      manager,
      {
        type: 'ax.work.create',
        sourceNodeId: 'json-render-1',
        sourceSurface: 'json-render',
        payload: { title: 'x', nodeIds: ['victim'] },
      },
      'browser',
    );
    expect(work.result.ok).toBe(true);
    expect((work.result as { primitive: { nodeIds: string[] } }).primitive.nodeIds).toEqual(['json-render-1']);
  });

  test('trusted surfaces may target explicit nodeIds', () => {
    const { manager, calls } = makeManager(makeNode('context'));
    applyAxInteraction(
      manager,
      {
        type: 'ax.focus.set',
        sourceNodeId: 'context-1',
        sourceSurface: 'native-node',
        payload: { nodeIds: ['a', 'b'] },
      },
      'browser',
    );
    expect(calls.find((c) => c.op === 'setAxFocus')?.args[0]).toEqual(['a', 'b']);
  });

  test('rejects update of a non-existent work item (404)', () => {
    const wm = makeManager(makeNode('status'));
    expect(
      applyAxInteraction(
        wm.manager,
        { type: 'ax.work.update', sourceNodeId: 'status-1', payload: { id: 'missing', status: 'done' } },
        'api',
      ).result,
    ).toMatchObject({ ok: false, code: 'work-item-not-found', status: 404 });
  });

  test('command invoke is registry-gated', () => {
    // markdown grants ax.command.invoke; a registry name dispatches.
    const ok = makeManager(makeNode('markdown'));
    const r = applyAxInteraction(
      ok.manager,
      { type: 'ax.command.invoke', sourceNodeId: 'markdown-1', payload: { name: 'pmx.plan' } },
      'api',
    );
    expect(r.result.ok).toBe(true);
    expect(ok.calls.some((c) => c.op === 'invokeCommand')).toBe(true);

    // unknown command -> rejected (manager returns null for non-registry names).
    const bad = makeManager(makeNode('markdown'));
    expect(
      applyAxInteraction(
        bad.manager,
        { type: 'ax.command.invoke', sourceNodeId: 'markdown-1', payload: { name: 'rm-rf' } },
        'api',
      ).result,
    ).toMatchObject({ ok: false, code: 'unknown-command' });

    // payload requires a name.
    const np = makeManager(makeNode('markdown'));
    expect(
      applyAxInteraction(np.manager, { type: 'ax.command.invoke', sourceNodeId: 'markdown-1', payload: {} }, 'api')
        .result,
    ).toMatchObject({ ok: false, code: 'invalid-payload' });
  });

  test('opted-in mcp-app node emits a node-scoped interaction (Phase 6 bridge)', () => {
    const { manager } = makeManager(
      makeNode('mcp-app', { axCapabilities: { enabled: true, allowed: ['ax.work.create'] } }),
    );
    const r = applyAxInteraction(
      manager,
      {
        type: 'ax.work.create',
        sourceNodeId: 'mcp-app-1',
        sourceSurface: 'mcp-app',
        payload: { title: 'from app', nodeIds: ['victim'] },
      },
      'browser',
    );
    expect(r.result.ok).toBe(true);
    expect((r.result as { primitive: { nodeIds: string[] } }).primitive.nodeIds).toEqual(['mcp-app-1']);

    // ax.elicitation.request is in the mcp-app ceiling (surfaces a human prompt) and
    // is likewise node-scoped.
    const elic = makeManager(
      makeNode('mcp-app', { axCapabilities: { enabled: true, allowed: ['ax.elicitation.request'] } }),
    );
    const er = applyAxInteraction(
      elic.manager,
      {
        type: 'ax.elicitation.request',
        sourceNodeId: 'mcp-app-1',
        sourceSurface: 'mcp-app',
        payload: { prompt: 'pick one', nodeIds: ['victim'] },
      },
      'browser',
    );
    expect(er.result.ok).toBe(true);
    expect((er.result as { primitive: { nodeIds: string[] } }).primitive.nodeIds).toEqual(['mcp-app-1']);
    expect(elic.calls.some((c) => c.op === 'requestElicitation')).toBe(true);

    // disabled by default
    const off = makeManager(makeNode('mcp-app'));
    expect(
      applyAxInteraction(
        off.manager,
        { type: 'ax.work.create', sourceNodeId: 'mcp-app-1', sourceSurface: 'mcp-app', payload: { title: 'x' } },
        'browser',
      ).result,
    ).toMatchObject({ ok: false, code: 'ax-disabled' });
  });

  test('opt-in html node can emit an allowed interaction', () => {
    const { manager, calls } = makeManager(
      makeNode('html', { axCapabilities: { enabled: true, allowed: ['ax.focus.set'] } }),
    );
    const { result } = applyAxInteraction(
      manager,
      { type: 'ax.focus.set', sourceNodeId: 'html-1', payload: {} },
      'api',
    );
    expect(result.ok).toBe(true);
    expect(calls.find((c) => c.op === 'setAxFocus')?.args[0]).toEqual(['html-1']);
  });
});
