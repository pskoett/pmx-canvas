import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { sweepExpiredGates, startGateTtlSweeper, stopGateTtlSweeper } from '../../src/server/ax-gate-ttl.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import { clampGateTtlMs, formatCountdown, gateRemainingMs, MAX_GATE_TTL_MS } from '../../src/shared/approval-gates.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

// Design item 3: unattended approval policy. A gate nobody answers auto-holds —
// the safe default — leaves a policy entry in the timeline, and can be reopened.

let workspaceRoot = '';

beforeEach(() => {
  workspaceRoot = createTestWorkspace('pmx-gate-ttl-');
  resetCanvasForTests(workspaceRoot);
  canvasState.addNode({
    id: 'gate-node',
    type: 'markdown',
    position: { x: 0, y: 0 },
    size: { width: 300, height: 200 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data: { title: 'Gate target' },
  });
});

afterEach(() => {
  stopGateTtlSweeper();
  resetCanvasForTests(workspaceRoot);
  removeTestWorkspace(workspaceRoot);
});

describe('approval gate TTL', () => {
  test('a new gate carries an expiresAt from its ttlMs, clamped to the policy bounds', () => {
    const gate = canvasState.requestApproval(
      { title: 'Ship?', nodeIds: ['gate-node'], ttlMs: 90_000 },
      { source: 'mcp' },
    );
    const remaining = gateRemainingMs(gate);
    expect(remaining).not.toBeNull();
    expect(remaining!).toBeGreaterThan(85_000);
    expect(remaining!).toBeLessThanOrEqual(90_000);
    expect(clampGateTtlMs(10)).toBe(1_000);
    expect(clampGateTtlMs(MAX_GATE_TTL_MS * 5)).toBe(MAX_GATE_TTL_MS);
    expect(clampGateTtlMs('nope', 42_000)).toBe(42_000);
  });

  test('an unanswered gate auto-holds once its TTL elapses; an unexpired one is untouched', () => {
    const frames: string[] = [];
    startGateTtlSweeper((event) => frames.push(event));
    const soon = canvasState.requestApproval(
      { title: 'Ship?', nodeIds: ['gate-node'], ttlMs: 1_000 },
      { source: 'mcp' },
    );
    const later = canvasState.requestApproval(
      { title: 'Later', nodeIds: ['gate-node'], ttlMs: 60_000 },
      { source: 'mcp' },
    );

    expect(sweepExpiredGates(Date.now())).toEqual([]);
    const held = sweepExpiredGates(Date.now() + 1_500);
    expect(held).toEqual([soon.id]);

    const gates = canvasState.getApprovalGates();
    expect(gates.find((g) => g.id === soon.id)).toMatchObject({
      status: 'held',
      resolution: 'auto-held: no answer within 0:01',
    });
    expect(gates.find((g) => g.id === later.id)?.status).toBe('pending');
    // Both the gate change and the policy event reached the workbench.
    expect(frames).toEqual(['ax-state-changed', 'ax-event-created']);
    const policy = canvasState.getAxTimeline({ limit: 5 }).events.find((event) => event.kind === 'policy');
    expect(policy?.summary).toContain('Auto-held "Ship?"');
    expect(policy?.data).toMatchObject({ gateId: soon.id, outcome: 'held' });
  });

  test('a held gate is a non-approval for whoever awaits it, and reopening restarts the clock', () => {
    const gate = canvasState.requestApproval(
      { title: 'Ship?', nodeIds: ['gate-node'], ttlMs: 1_000 },
      { source: 'mcp' },
    );
    sweepExpiredGates(Date.now() + 2_000);
    expect(canvasState.getApprovalGates()[0]?.status).toBe('held');

    // Already resolved: the normal decision path refuses, reopen is the only way back.
    expect(canvasState.resolveApproval(gate.id, 'approved', { source: 'browser' })).toBeNull();
    const reopened = canvasState.reopenApproval(gate.id, { ttlMs: 30_000, source: 'browser' });
    expect(reopened).toMatchObject({ status: 'pending', resolvedAt: null, resolution: null });
    expect(gateRemainingMs(reopened!)).toBeGreaterThan(25_000);
    expect(canvasState.reopenApproval(gate.id)).toBeNull(); // pending gates cannot be reopened
  });
});

describe('formatCountdown', () => {
  test('renders M:SS, rounding up partial seconds, never negative', () => {
    expect(formatCountdown(271_000)).toBe('4:31');
    expect(formatCountdown(59_400)).toBe('1:00');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});
