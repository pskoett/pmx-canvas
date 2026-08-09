import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  AX_INTERACTION_TYPES,
  DEFAULT_NODE_AX_CAPABILITIES,
  resolveNodeAxCapabilities,
  type AxInteractionType,
} from '../../src/server/ax-interaction.ts';
import { canvasState, type CanvasEdge, type CanvasNodeState } from '../../src/server/canvas-state.ts';
import {
  buildHtmlPrimitive,
  getHtmlPrimitiveDescriptor,
  HTML_PRIMITIVE_KINDS,
} from '../../src/server/html-primitives.ts';
import { executeOperation } from '../../src/server/operations/index.ts';
import { rectsOverlap } from '../../src/shared/placement.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

const AX_FLOW_CAPABILITIES: AxInteractionType[] = [
  'ax.work.create',
  'ax.work.update',
  'ax.steer',
  'ax.event.record',
  'ax.flow.materialize',
];

interface MaterializedStep {
  index: number;
  title: string;
  nodeId: string;
  workItemId: string;
}

interface MaterializeResult {
  ok: boolean;
  code?: string;
  error?: string;
  primitive?: {
    flowId: string;
    title: string;
    loop: { enabled: boolean; maxRuns: number };
    replacedNodeCount: number;
    steps: MaterializedStep[];
    edgeIds: string[];
  };
}

describe('ax-flow html primitive', () => {
  test('is a registered primitive kind with a complete descriptor', () => {
    expect(HTML_PRIMITIVE_KINDS).toContain('ax-flow');
    const descriptor = getHtmlPrimitiveDescriptor('ax-flow');
    expect(descriptor.title).toBe('AX Flow');
    expect(descriptor.description.length).toBeGreaterThan(20);
    expect(descriptor.useWhen.length).toBeGreaterThan(20);
    expect(descriptor.defaultSize.width).toBeGreaterThan(600);
    expect(descriptor.defaultSize.height).toBeGreaterThan(400);
    expect(descriptor.dataShape).toContain('steps');
    expect(descriptor.dataShape).toContain('loop');
    expect((descriptor.example as { kind?: string }).kind).toBe('ax-flow');
    expect(descriptor.axCapabilities).toEqual({ enabled: true, allowed: AX_FLOW_CAPABILITIES });
  });

  test('renders a surface that emits every capability it declares', () => {
    const built = buildHtmlPrimitive({ kind: 'ax-flow' });
    expect(built.kind).toBe('ax-flow');
    for (const type of AX_FLOW_CAPABILITIES) {
      expect(built.html, `ax-flow never emits "${type}"`).toContain(`'${type}'`);
    }
    // Live AX state only — no private mirror of step status, and matched by id.
    expect(built.html).toContain('window.PMX_AX.state');
    expect(built.html).toContain('pmx-ax-update');
    expect(built.html).toContain('axFlowWorkIds');
    // The three sandbox footguns: no storage APIs, awaited emits, honest steering copy.
    expect(built.html).not.toContain('localStorage');
    expect(built.html).not.toContain('sessionStorage');
    expect(built.html).not.toContain('document.cookie');
    expect(built.html).toContain('await window.PMX_AX.emit');
    expect(built.html).toContain("agent's next turn");
    // Bounded loop: capped, human-stoppable, never auto-started.
    expect(built.html).toContain('AX_MAX_RUNS = 20');
    expect(built.html).toContain('ax-stop-loop');
    expect(built.html).toContain('axAdvancing');
    // The diagram + the materialize control.
    expect(built.html).toContain('ax-flow-diagram');
    expect(built.html).toContain('ax-flow-materialize');
  });

  test('draws a loop-back rail only when the flow loops', () => {
    const looping = buildHtmlPrimitive({
      kind: 'ax-flow',
      data: { steps: [{ title: 'A' }, { title: 'B' }], loop: { enabled: true, maxRuns: 4 } },
    });
    expect(looping.html).toContain('ax-flow-wrap looping');
    expect(looping.html).toContain('loops back to step 1 · max 4 runs');

    const linear = buildHtmlPrimitive({ kind: 'ax-flow', data: { steps: [{ title: 'A' }, { title: 'B' }] } });
    expect(linear.html).not.toContain('ax-flow-wrap looping');
  });

  test('normalizes and caps authored step data before it reaches the panel', () => {
    const built = buildHtmlPrimitive({
      kind: 'ax-flow',
      data: { steps: Array.from({ length: 20 }, (_, i) => ({ title: `Step ${i + 1}` })), loop: { maxRuns: 99 } },
    });
    // What the panel actually reads: the embedded PMX_DATA, not the raw input.
    const embedded = JSON.parse(
      /<script type="application\/json" id="pmx-data">([\s\S]*?)<\/script>/.exec(built.html)?.[1] ?? '{}',
    ) as { steps: Array<{ title: string }>; loop: { maxRuns: number } };
    // Capped at the same 12-step bound the materialize interaction enforces.
    expect(embedded.steps).toHaveLength(12);
    expect(embedded.loop.maxRuns).toBe(20);
  });
});

describe('ax.flow.materialize interaction contract', () => {
  test('is a registered interaction type', () => {
    expect(AX_INTERACTION_TYPES).toContain('ax.flow.materialize');
  });

  test('is in the html ceiling and NO other node type', () => {
    const granted = Object.entries(DEFAULT_NODE_AX_CAPABILITIES)
      .filter(([, caps]) => caps.allowed.includes('ax.flow.materialize'))
      .map(([type]) => type);
    expect(granted).toEqual(['html']);
  });
});

describe('ax-flow node creation + materialize', () => {
  let workspaceRoot = '';

  beforeEach(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-ax-flow-');
    resetCanvasForTests(workspaceRoot);
  });

  afterEach(() => {
    removeTestWorkspace(workspaceRoot);
  });

  async function addFlowPanel(data?: Record<string, unknown>): Promise<CanvasNodeState> {
    const created = (await executeOperation('node.add', {
      type: 'html',
      primitive: 'ax-flow',
      title: 'Delivery Flow',
      x: 80,
      y: 80,
      ...(data ? { data } : {}),
    })) as { node: CanvasNodeState };
    return created.node;
  }

  async function materialize(sourceNodeId: string, payload: Record<string, unknown>): Promise<MaterializeResult> {
    return (await executeOperation('ax.interaction.submit', {
      type: 'ax.flow.materialize',
      sourceNodeId,
      sourceSurface: 'html-node',
      payload,
    })) as unknown as MaterializeResult;
  }

  const threeSteps = [
    { title: 'Reproduce', detail: 'Write the failing case.' },
    { title: 'Fix' },
    { title: 'Verify', detail: 'Typecheck + unit.' },
  ];

  test('applies the descriptor capabilities so the AX bridge is injected', async () => {
    const node = await addFlowPanel();
    expect(node.type).toBe('html');
    expect(node.data.htmlPrimitive).toBe('ax-flow');
    expect(node.data.axCapabilities).toEqual({ enabled: true, allowed: AX_FLOW_CAPABILITIES });

    const resolved = resolveNodeAxCapabilities(node);
    expect(resolved.enabled).toBe(true);
    expect([...resolved.allowed].sort()).toEqual([...AX_FLOW_CAPABILITIES].sort());
  });

  test('rejects more than 12 steps', async () => {
    const panel = await addFlowPanel();
    const result = await materialize(panel.id, {
      steps: Array.from({ length: 13 }, (_, i) => ({ title: `Step ${i + 1}` })),
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid-payload');
    expect(canvasState.getLayout().nodes).toHaveLength(1);
  });

  test('rejects an empty step list, a blank step title, and an over-long title', async () => {
    const panel = await addFlowPanel();

    expect((await materialize(panel.id, { steps: [] })).code).toBe('invalid-payload');
    expect((await materialize(panel.id, { steps: [{ title: '   ' }] })).code).toBe('invalid-payload');
    expect((await materialize(panel.id, { steps: [{ title: 'x'.repeat(121) }] })).code).toBe('invalid-payload');
    expect((await materialize(panel.id, { title: 'x'.repeat(121), steps: [{ title: 'ok' }] })).code).toBe(
      'invalid-payload',
    );
    // A 120-char title is exactly at the bound and must be accepted.
    expect((await materialize(panel.id, { steps: [{ title: 'x'.repeat(120) }] })).ok).toBe(true);
  });

  test('rejects a node type that lacks the capability', async () => {
    const created = (await executeOperation('node.add', { type: 'markdown', title: 'Not a panel' })) as {
      node: CanvasNodeState;
    };
    const result = await materialize(created.node.id, { steps: threeSteps });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not-allowed');
  });

  test('creates one node per step, flow edges in order, and one linked work item each', async () => {
    const panel = await addFlowPanel();
    const result = await materialize(panel.id, { title: 'Bug Flow', steps: threeSteps });
    expect(result.ok).toBe(true);
    const primitive = result.primitive;
    if (!primitive) throw new Error('missing primitive');

    expect(primitive.steps).toHaveLength(3);
    expect(primitive.replacedNodeCount).toBe(0);

    const layout = canvasState.getLayout();
    const stepNodes = layout.nodes.filter((node) => node.data.axFlowId === primitive.flowId);
    expect(stepNodes).toHaveLength(3);
    expect(stepNodes.every((node) => node.type === 'markdown')).toBe(true);
    expect(stepNodes.map((node) => node.data.title).sort()).toEqual(['1. Reproduce', '2. Fix', '3. Verify']);

    // N-1 flow edges, chained in order, no loop-back (looping is off).
    const flowEdges = layout.edges.filter((edge: CanvasEdge) => edge.type === 'flow');
    expect(flowEdges).toHaveLength(2);
    expect(flowEdges.map((edge) => [edge.from, edge.to])).toEqual([
      [primitive.steps[0].nodeId, primitive.steps[1].nodeId],
      [primitive.steps[1].nodeId, primitive.steps[2].nodeId],
    ]);
    expect(layout.edges.filter((edge) => edge.type === 'references')).toHaveLength(0);

    // One work item per step, each linked to ITS node — which lights the existing
    // work-item→node status mirror on the step node.
    const workItems = canvasState.getWorkItems();
    expect(workItems).toHaveLength(3);
    for (const step of primitive.steps) {
      const item = workItems.find((entry) => entry.id === step.workItemId);
      expect(item?.nodeIds).toEqual([step.nodeId]);
      expect(canvasState.getNode(step.nodeId)?.data.axWorkStatus).toBe('todo');
    }
  });

  test('adds a dashed loop-back edge when looping is enabled', async () => {
    const panel = await addFlowPanel();
    const result = await materialize(panel.id, { steps: threeSteps, loop: { enabled: true, maxRuns: 5 } });
    const primitive = result.primitive;
    if (!primitive) throw new Error('missing primitive');
    expect(primitive.loop).toEqual({ enabled: true, maxRuns: 5 });

    const edges = canvasState.getLayout().edges;
    expect(edges.filter((edge) => edge.type === 'flow')).toHaveLength(2);
    const loopEdge = edges.find((edge) => edge.type === 'references');
    expect(loopEdge?.from).toBe(primitive.steps[2].nodeId);
    expect(loopEdge?.to).toBe(primitive.steps[0].nodeId);
    expect(loopEdge?.label).toBe('loop');
    expect(loopEdge?.style).toBe('dashed');
  });

  test('places the step band without overlapping anything already on the canvas', async () => {
    const panel = await addFlowPanel();
    await executeOperation('node.add', { type: 'markdown', title: 'Neighbour', x: 80, y: 1000 });

    const result = await materialize(panel.id, {
      steps: Array.from({ length: 6 }, (_, i) => ({ title: `Step ${i + 1}` })),
    });
    expect(result.ok).toBe(true);

    const nodes = canvasState.getLayout().nodes;
    for (const a of nodes) {
      for (const b of nodes) {
        if (a.id === b.id) continue;
        expect(rectsOverlap(a.position, a.size.width, a.size.height, b, 0), `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  test('re-materializing REPLACES the previous flow instead of duplicating it', async () => {
    const panel = await addFlowPanel();
    const first = await materialize(panel.id, { steps: threeSteps, loop: { enabled: true } });
    const firstIds = first.primitive?.steps.map((step) => step.nodeId) ?? [];
    expect(firstIds).toHaveLength(3);

    const second = await materialize(panel.id, { steps: [{ title: 'Only step' }] });
    expect(second.primitive?.replacedNodeCount).toBe(3);

    const layout = canvasState.getLayout();
    // Panel + exactly one step node — the previous three are gone with their edges
    // (step ids are derived from the flow, so step 1's id is reused by the new flow).
    expect(layout.nodes).toHaveLength(2);
    expect(layout.nodes.filter((node) => node.data.axFlowId === second.primitive?.flowId)).toHaveLength(1);
    expect(layout.edges).toHaveLength(0);
    for (const id of firstIds.slice(1)) expect(canvasState.getNode(id)).toBeUndefined();
    expect(canvasState.getNode(firstIds[0])?.data.title).toBe('1. Only step');

    // The source node's manifest tracks only the current flow.
    expect(canvasState.getNode(panel.id)?.data.axFlowNodeIds).toEqual([second.primitive?.steps[0].nodeId]);
  });

  test('sweeps only nodes this panel created, not any node wearing the tag', async () => {
    const panel = await addFlowPanel();
    const first = await materialize(panel.id, { steps: threeSteps });
    const flowId = first.primitive?.flowId;

    // An unrelated node stamped with a plausible-looking flow id. The sweep works
    // off the SOURCE node's manifest, so this must survive.
    const impostor = (await executeOperation('node.add', {
      type: 'markdown',
      title: 'Not mine',
      x: 2400,
      y: 2400,
      data: { axFlowId: flowId },
    })) as { node: CanvasNodeState };

    await materialize(panel.id, { steps: [{ title: 'Fresh' }] });
    expect(canvasState.getNode(impostor.node.id)).toBeDefined();
  });
});
