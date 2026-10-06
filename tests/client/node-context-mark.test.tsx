import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { NearPinMark, NodeContextMark, isAgentPin } from '../../src/client/canvas/NodeContextMark.tsx';
import { contextPinnedNodeIds, nodes } from '../../src/client/state/canvas-store.ts';
import { applyContextStatus } from '../../src/client/state/context-status-store.ts';
import type { CanvasNodeState, NodeActor } from '../../src/client/types.ts';

// docs/design/AgentContext.dc.html: one chip per node saying what agents did
// with it. Pinned nodes answer "did the agent read what I pinned, and is its
// copy current?"; unpinned nodes carry the agent's byline until a person edits.

const agent: NodeActor = { actor: 'agent', source: 'mcp', agentId: 'claude' };
const human: NodeActor = { actor: 'human', source: 'browser' };

function node(overrides: Partial<CanvasNodeState> = {}): CanvasNodeState {
  return {
    id: 'n1',
    type: 'markdown',
    position: { x: 0, y: 0 },
    size: { width: 360, height: 200 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    contentRevision: 5,
    data: { title: 'Note' },
    ...overrides,
  };
}

function markOf(props: { node: CanvasNodeState; pinned: boolean }): string | null {
  const { container } = render(<NodeContextMark {...props} />);
  return container.querySelector('.node-context-mark')?.getAttribute('data-mark') ?? null;
}

afterEach(() => {
  cleanup();
  applyContextStatus({});
});

describe('pinned nodes: read, not read, changed since read', () => {
  test('a pin no agent has read says "not read"', () => {
    applyContextStatus({ pins: { n1: { pinnedBy: human, pinnedAt: '2026-10-05T10:00:00.000Z' } } });
    expect(markOf({ node: node(), pinned: true })).toBe('not read');
  });

  test('a read at the current revision says "read"; a newer revision says "changed since read"', () => {
    applyContextStatus({
      nodes: [
        { nodeId: 'n1', lastReadAt: '2026-10-05T10:05:00.000Z', lastReadBy: 'claude', readRevision: 5, readCount: 1 },
      ],
      pins: { n1: { pinnedBy: human, pinnedAt: '2026-10-05T10:00:00.000Z' } },
    });
    expect(markOf({ node: node({ contentRevision: 5 }), pinned: true })).toBe('read');
    cleanup();
    expect(markOf({ node: node({ contentRevision: 6 }), pinned: true })).toBe('changed since read');
  });

  test('a read from before the pin does not count: the agent has not loaded it since you pinned it', () => {
    applyContextStatus({
      nodes: [
        { nodeId: 'n1', lastReadAt: '2026-10-05T09:00:00.000Z', lastReadBy: 'claude', readRevision: 5, readCount: 1 },
      ],
      pins: { n1: { pinnedBy: human, pinnedAt: '2026-10-05T10:00:00.000Z' } },
    });
    expect(markOf({ node: node(), pinned: true })).toBe('not read');
  });

  test('an agent pin gets the violet dot; a person pin does not', () => {
    applyContextStatus({
      pins: {
        n1: { pinnedBy: agent, pinnedAt: '2026-10-05T10:00:00.000Z', reason: 'the chart' },
        n2: { pinnedBy: human, pinnedAt: '2026-10-05T10:00:00.000Z' },
      },
    });
    expect(isAgentPin('n1')).toBe(true);
    expect(isAgentPin('n2')).toBe(false);
  });
});

describe('unpinned nodes: the agent byline until a person edits', () => {
  test('created by an agent reads "by <agent>"; a person edit ends it', () => {
    expect(markOf({ node: node({ createdBy: agent, lastEditedBy: agent }), pinned: false })).toBe('by claude');
    cleanup();
    expect(markOf({ node: node({ createdBy: agent, lastEditedBy: human }), pinned: false })).toBeNull();
  });

  test('a person-made node an agent edited reads "edited"', () => {
    expect(markOf({ node: node({ createdBy: human, lastEditedBy: agent }), pinned: false })).toBe('edited');
  });

  test('a person-made, person-edited node has no mark', () => {
    expect(markOf({ node: node({ createdBy: human, lastEditedBy: human }), pinned: false })).toBeNull();
  });
});

describe('near a pin', () => {
  test('an unpinned node within 600 px of pins says "near" (or "near N"); a far or pinned node does not', () => {
    const pinA = node({ id: 'pin-a', data: { title: 'Release runbook' } });
    const pinB = node({ id: 'pin-b', position: { x: 300, y: 0 }, data: { title: 'Rollout' } });
    const close = node({ id: 'close', position: { x: 150, y: 0 } });
    const far = node({ id: 'far', position: { x: 3000, y: 0 } });
    nodes.value = new Map([pinA, pinB, close, far].map((entry) => [entry.id, entry]));
    contextPinnedNodeIds.value = new Set(['pin-a', 'pin-b']);
    const nearOf = (target: CanvasNodeState, pinned = false) => {
      const { container } = render(<NearPinMark node={target} pinned={pinned} />);
      const text = container.querySelector('.node-near-mark')?.textContent ?? null;
      cleanup();
      return text;
    };
    expect(nearOf(close)).toBe('near 2');
    // At rest the node must not contain the pins' titles; hovering the chip names them.
    const { container } = render(<NearPinMark node={close} pinned={false} />);
    expect(container.textContent).not.toContain('Release runbook');
    fireEvent.mouseEnter(container.querySelector('.node-near-mark') as Element);
    expect(container.textContent).toContain('Release runbook');
    cleanup();
    expect(nearOf(far)).toBeNull();
    expect(nearOf(pinA, true)).toBeNull();
    nodes.value = new Map();
    contextPinnedNodeIds.value = new Set();
  });
});
