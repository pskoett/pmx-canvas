/**
 * Native AX flow steps + the durable server-side loop.
 *
 * Covers the metadata `ax.flow.materialize` stamps for the native controls
 * (`data.axStep` / `data.axFlow`), the payloads those controls emit, and the
 * bounded loop in `ax-flow-loop.ts`: one advance per completion, the run cap,
 * Stop, and re-entrancy (the loop's own writes re-enter the same listener).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULT_NODE_AX_CAPABILITIES } from '../../src/server/ax-interaction.ts';
import type { PmxAxWorkItemStatus } from '../../src/server/ax-state.ts';
import { canvasState, type CanvasNodeState } from '../../src/server/canvas-state.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { executeOperation } from '../../src/server/operations/index.ts';
import { AX_FLOW_LOOP_HARD_CAP, clampAxFlowMaxRuns, readAxFlow, readAxStep } from '../../src/shared/ax-flow.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

interface MaterializedFlow {
  flowId: string;
  steps: Array<{ index: number; title: string; nodeId: string; workItemId: string }>;
}

const THREE_STEPS = [{ title: 'Reproduce' }, { title: 'Fix' }, { title: 'Verify' }];

let workspaceRoot = '';

beforeEach(() => {
  workspaceRoot = createTestWorkspace('pmx-canvas-ax-flow-loop-');
  resetCanvasForTests(workspaceRoot);
});

afterEach(() => {
  removeTestWorkspace(workspaceRoot);
});

async function materialize(
  steps: Array<{ title: string; detail?: string }> = THREE_STEPS,
  loop?: { enabled?: boolean; maxRuns?: number },
): Promise<MaterializedFlow> {
  const panel = (await executeOperation('node.add', {
    type: 'html',
    primitive: 'ax-flow',
    title: 'Flow panel',
    x: 80,
    y: 80,
  })) as { node: CanvasNodeState };
  const result = (await executeOperation('ax.interaction.submit', {
    type: 'ax.flow.materialize',
    sourceNodeId: panel.node.id,
    sourceSurface: 'html-node',
    payload: { title: 'Loop Flow', steps, ...(loop ? { loop } : {}) },
  })) as unknown as { ok: boolean; primitive?: MaterializedFlow };
  if (!result.ok || !result.primitive) throw new Error('materialize failed');
  return result.primitive;
}

function node(id: string): CanvasNodeState {
  const found = canvasState.getNode(id);
  if (!found) throw new Error(`missing node ${id}`);
  return found;
}

function statusOf(workItemId: string): PmxAxWorkItemStatus | undefined {
  return canvasState.getWorkItems().find((item) => item.id === workItemId)?.status;
}

function statuses(flow: MaterializedFlow): Array<PmxAxWorkItemStatus | undefined> {
  return flow.steps.map((step) => statusOf(step.workItemId));
}

function setStatus(workItemId: string, status: PmxAxWorkItemStatus): void {
  canvasState.updateWorkItem(workItemId, { status }, { source: 'browser' });
}

/** Arm (or disarm) the anchor's loop the way the browser control does: a node data patch. */
async function setLoop(
  flow: MaterializedFlow,
  loop: { running: boolean; run?: number; maxRuns?: number },
): Promise<void> {
  const anchorId = flow.steps[0].nodeId;
  const current = readAxFlow(node(anchorId).data);
  if (!current) throw new Error('anchor is not a flow anchor');
  await executeOperation('node.update', {
    id: anchorId,
    data: {
      axFlow: {
        ...current,
        loop: {
          running: loop.running,
          run: loop.run ?? current.loop.run,
          maxRuns: loop.maxRuns ?? current.loop.maxRuns,
        },
      },
    },
  });
}

function loopState(flow: MaterializedFlow): { running: boolean; run: number; maxRuns: number } {
  const anchor = readAxFlow(node(flow.steps[0].nodeId).data);
  if (!anchor) throw new Error('anchor is not a flow anchor');
  return anchor.loop;
}

describe('ax.flow.materialize step metadata', () => {
  test('stamps axStep on every step node and axFlow on the anchor only', async () => {
    const flow = await materialize(THREE_STEPS, { enabled: true, maxRuns: 4 });

    for (const step of flow.steps) {
      expect(readAxStep(node(step.nodeId).data)).toEqual({
        flowId: flow.flowId,
        index: step.index,
        total: 3,
        workItemId: step.workItemId,
      });
    }

    // The anchor carries the whole flow + its loop config, at rest.
    const anchor = readAxFlow(node(flow.steps[0].nodeId).data);
    expect(anchor?.flowId).toBe(flow.flowId);
    expect(anchor?.title).toBe('Loop Flow');
    expect(anchor?.loop).toEqual({ running: false, run: 0, maxRuns: 4 });
    expect(anchor?.steps).toEqual(
      flow.steps.map((step) => ({
        index: step.index,
        nodeId: step.nodeId,
        workItemId: step.workItemId,
        title: step.title,
      })),
    );
    // Only the anchor.
    expect(readAxFlow(node(flow.steps[1].nodeId).data)).toBeNull();
    expect(readAxFlow(node(flow.steps[2].nodeId).data)).toBeNull();
  });

  test('keeps the existing status mirror and the idempotent replace', async () => {
    const flow = await materialize();
    expect(flow.steps.map((step) => node(step.nodeId).data.axWorkStatus)).toEqual(['todo', 'todo', 'todo']);

    // Re-materializing from the same panel replaces the step nodes and re-stamps them.
    const again = await materialize();
    expect(canvasState.getLayout().nodes.filter((n) => n.data.axFlowId === flow.flowId)).toHaveLength(3);
    expect(readAxStep(node(again.steps[0].nodeId).data)?.workItemId).toBe(again.steps[0].workItemId);
  });

  test('clamps a stamped maxRuns to the hard cap on read', () => {
    expect(clampAxFlowMaxRuns(999)).toBe(AX_FLOW_LOOP_HARD_CAP);
    expect(clampAxFlowMaxRuns(0)).toBe(1);
    expect(clampAxFlowMaxRuns('nope')).toBe(1);
  });
});

describe('native step control payloads', () => {
  test('markdown step nodes may emit ax.work.update (the Start/Done/Blocked control)', async () => {
    // The step node type's ceiling has to allow what the controls emit.
    expect(DEFAULT_NODE_AX_CAPABILITIES.markdown.allowed).toContain('ax.work.update');
    expect(DEFAULT_NODE_AX_CAPABILITIES.markdown.allowed).toContain('ax.steer');

    const flow = await materialize();
    const step = flow.steps[1];
    const result = (await executeOperation('ax.interaction.submit', {
      type: 'ax.work.update',
      sourceNodeId: step.nodeId,
      sourceSurface: 'native-node',
      payload: { id: step.workItemId, status: 'in-progress' },
    })) as unknown as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(statusOf(step.workItemId)).toBe('in-progress');
    // The chip on the node followed (existing work-item → node mirror).
    expect(node(step.nodeId).data.axWorkStatus).toBe('in-progress');
  });

  test('a step node may steer from its anchor controls', async () => {
    const flow = await materialize();
    const result = (await executeOperation('ax.interaction.submit', {
      type: 'ax.steer',
      sourceNodeId: flow.steps[0].nodeId,
      sourceSurface: 'native-node',
      payload: { message: 'focus on the failing case' },
    })) as unknown as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(canvasState.getAxSteering().at(-1)?.message).toBe('focus on the failing case');
  });
});

describe('bounded flow loop', () => {
  test('does not advance while the loop is not running', async () => {
    const flow = await materialize();
    setStatus(flow.steps[0].workItemId, 'done');
    expect(statuses(flow)).toEqual(['done', 'todo', 'todo']);
  });

  test('opens the next step exactly once per completion', async () => {
    const flow = await materialize(THREE_STEPS, { enabled: true, maxRuns: 5 });
    await setLoop(flow, { running: true });

    setStatus(flow.steps[0].workItemId, 'done');
    expect(statuses(flow)).toEqual(['done', 'in-progress', 'todo']);
    // A repeat of the same completion must not skip ahead.
    setStatus(flow.steps[0].workItemId, 'done');
    expect(statuses(flow)).toEqual(['done', 'in-progress', 'todo']);

    setStatus(flow.steps[1].workItemId, 'done');
    expect(statuses(flow)).toEqual(['done', 'done', 'in-progress']);
    expect(loopState(flow).run).toBe(0);
  });

  test('a completed run reopens the flow at step 1 and increments the run counter', async () => {
    const flow = await materialize(THREE_STEPS, { enabled: true, maxRuns: 3 });
    await setLoop(flow, { running: true });
    for (const step of flow.steps) setStatus(step.workItemId, 'done');

    expect(statuses(flow)).toEqual(['in-progress', 'todo', 'todo']);
    expect(loopState(flow)).toEqual({ running: true, run: 1, maxRuns: 3 });
  });

  test('the final run stops the loop instead of opening run N+1', async () => {
    const flow = await materialize(THREE_STEPS, { enabled: true, maxRuns: 2 });
    await setLoop(flow, { running: true });

    // Run 1 completes → run 2 opens.
    for (const step of flow.steps) setStatus(step.workItemId, 'done');
    expect(loopState(flow)).toEqual({ running: true, run: 1, maxRuns: 2 });
    expect(statuses(flow)).toEqual(['in-progress', 'todo', 'todo']);

    // Run 2 completes → the cap is reached: no run 3, and the steps stay done.
    for (const step of flow.steps) setStatus(step.workItemId, 'done');
    expect(loopState(flow)).toEqual({ running: false, run: 2, maxRuns: 2 });
    expect(statuses(flow)).toEqual(['done', 'done', 'done']);

    // A further completion changes nothing — the loop is disarmed.
    setStatus(flow.steps[2].workItemId, 'done');
    expect(loopState(flow).running).toBe(false);
    expect(statuses(flow)).toEqual(['done', 'done', 'done']);
  });

  test('a stamped maxRuns above the hard cap cannot exceed 20 runs', async () => {
    const flow = await materialize(THREE_STEPS, { enabled: true });
    await setLoop(flow, { running: true, run: AX_FLOW_LOOP_HARD_CAP - 1, maxRuns: 999 });
    for (const step of flow.steps) setStatus(step.workItemId, 'done');

    const state = loopState(flow);
    expect(state.running).toBe(false);
    expect(state.run).toBe(AX_FLOW_LOOP_HARD_CAP);
    expect(state.maxRuns).toBeLessThanOrEqual(AX_FLOW_LOOP_HARD_CAP);
  });

  test('Stop prevents the next advance, durably', async () => {
    const flow = await materialize(THREE_STEPS, { enabled: true, maxRuns: 5 });
    await setLoop(flow, { running: true });
    setStatus(flow.steps[0].workItemId, 'done');
    expect(statuses(flow)).toEqual(['done', 'in-progress', 'todo']);

    await setLoop(flow, { running: false });
    setStatus(flow.steps[1].workItemId, 'done');

    expect(statuses(flow)).toEqual(['done', 'done', 'todo']);
    // The stop is persisted on the node, not just held in memory.
    expect(node(flow.steps[0].nodeId).data.axFlow).toMatchObject({ loop: { running: false } });
  });

  test('a blocked step halts advancement without disarming the loop', async () => {
    const flow = await materialize(THREE_STEPS, { enabled: true, maxRuns: 5 });
    await setLoop(flow, { running: true });
    setStatus(flow.steps[1].workItemId, 'blocked');
    setStatus(flow.steps[0].workItemId, 'done');

    expect(statuses(flow)).toEqual(['done', 'blocked', 'todo']);
    expect(loopState(flow).running).toBe(true);

    // Unblocking resumes on the next completion signal.
    setStatus(flow.steps[1].workItemId, 'todo');
    expect(statuses(flow)).toEqual(['done', 'in-progress', 'todo']);
  });

  test('stops the loop when a step work item no longer exists', async () => {
    const flow = await materialize(THREE_STEPS, { enabled: true, maxRuns: 5 });
    const anchorId = flow.steps[0].nodeId;
    const current = readAxFlow(node(anchorId).data);
    if (!current) throw new Error('anchor is not a flow anchor');
    await executeOperation('node.update', {
      id: anchorId,
      data: {
        axFlow: {
          ...current,
          steps: current.steps.map((step) => ({ ...step, workItemId: `${step.workItemId}-gone` })),
          loop: { ...current.loop, running: true },
        },
      },
    });

    // Any later work-item change finds the flow undrivable and disarms it.
    canvasState.addWorkItem({ title: 'unrelated' });
    expect(loopState(flow).running).toBe(false);
  });

  test("the loop's own writes re-enter the listener without cascading", async () => {
    const flow = await materialize(THREE_STEPS, { enabled: true, maxRuns: 5 });
    await setLoop(flow, { running: true });
    setStatus(flow.steps[0].workItemId, 'done');
    setStatus(flow.steps[1].workItemId, 'done');

    const original = canvasState.updateWorkItem.bind(canvasState);
    const calls: string[] = [];
    canvasState.updateWorkItem = (id, patch, options) => {
      calls.push(`${id}:${patch.status ?? '-'}`);
      return original(id, patch, options);
    };
    try {
      // Completing the last step closes the run. Every write below re-enters the
      // work-item listener; the guard must keep it to ONE advance: the trigger,
      // three resets, and one re-open — not a recursive cascade.
      setStatus(flow.steps[2].workItemId, 'done');
    } finally {
      canvasState.updateWorkItem = original;
    }

    expect(calls).toEqual([
      `${flow.steps[2].workItemId}:done`,
      `${flow.steps[0].workItemId}:todo`,
      `${flow.steps[1].workItemId}:todo`,
      `${flow.steps[2].workItemId}:todo`,
      `${flow.steps[0].workItemId}:in-progress`,
    ]);
    expect(loopState(flow).run).toBe(1);
  });

  test('loop bookkeeping stays out of undo history', async () => {
    // Differential, deliberately: `canvasState.onMutation` is a SINGLE slot that
    // `server.ts` claims whenever a server starts, so whether completing a step
    // records history at all depends on which test files ran first. Asserting an
    // absolute "zero new entries" passed this file in isolation and failed in the
    // full suite. What we actually care about is that the LOOP'S OWN writes add
    // nothing — so complete a step with the loop disarmed, then armed, and
    // require the two deltas to match.
    const idle = await materialize(THREE_STEPS, { enabled: true, maxRuns: 5 });
    const beforeIdle = mutationHistory.getSummaries().length;
    setStatus(idle.steps[0].workItemId, 'done');
    const idleDelta = mutationHistory.getSummaries().length - beforeIdle;

    const running = await materialize(THREE_STEPS, { enabled: true, maxRuns: 5 });
    await setLoop(running, { running: true });
    const beforeRunning = mutationHistory.getSummaries().length;
    setStatus(running.steps[0].workItemId, 'done');
    const runningDelta = mutationHistory.getSummaries().length - beforeRunning;

    // The armed run advanced the flow (proving the loop actually fired)…
    expect(statusOf(running.steps[1].workItemId)).toBe('in-progress');
    // …yet contributed no extra undo entries of its own.
    expect(runningDelta).toBe(idleDelta);
  });
});
