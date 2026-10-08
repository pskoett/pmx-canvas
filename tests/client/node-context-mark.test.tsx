import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { NearPinMark, NodeContextMark, NodeTypeIcon, isAgentPin } from '../../src/client/canvas/NodeContextMark.tsx';
import { contextPinnedNodeIds, nodes } from '../../src/client/state/canvas-store.ts';
import { nearPins } from '../../src/client/state/near-pin-store.ts';
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

// docs/design/HeaderMarks.dc.html: authorship is not state. The byline never
// takes a chip; it is a violet sparkle on the type icon, its words in the hint.
function iconOf(target: CanvasNodeState, fold: 'word' | 'glyph' | 'hidden' = 'word', pinned = false) {
  const { container } = render(
    <NodeTypeIcon node={target} pinned={pinned} title="Release plan" fold={fold}>
      <svg />
    </NodeTypeIcon>,
  );
  const result = {
    spark: !!container.querySelector('.node-type-spark'),
    hint: container.querySelector('.toolbar-tooltip')?.textContent ?? '',
  };
  cleanup();
  return result;
}

describe('the agent byline: a sparkle on the type icon until a person edits', () => {
  test('written by an agent: sparkle, "Written by <agent>" in the icon hint, and never a chip', () => {
    const written = node({ createdBy: agent, lastEditedBy: agent });
    expect(iconOf(written)).toEqual({ spark: true, hint: 'Release plan✦ Written by claude · MD' });
    expect(markOf({ node: written, pinned: false })).toBeNull();
    expect(iconOf(node({ createdBy: agent, lastEditedBy: human })).spark).toBe(false);
  });

  test('a person-made node an agent edited says "Edited by <agent>"; person-only has no sparkle', () => {
    expect(iconOf(node({ createdBy: human, lastEditedBy: agent })).hint).toContain('✦ Edited by claude');
    expect(iconOf(node({ createdBy: human, lastEditedBy: human })).spark).toBe(false);
  });

  test('pinned and written by an agent: the sparkle stays beside the read chip', () => {
    applyContextStatus({ pins: { n1: { pinnedBy: human, pinnedAt: '2026-10-05T10:00:00.000Z' } } });
    expect(iconOf(node({ createdBy: agent, lastEditedBy: agent }), 'word', true).spark).toBe(true);
  });
});

describe('folding a chip so the title keeps its room', () => {
  test('glyph keeps only the icon; hidden moves the words into the type icon hint', () => {
    applyContextStatus({ pins: { n1: { pinnedBy: human, pinnedAt: '2026-10-05T10:00:00.000Z' } } });
    const { container } = render(<NodeContextMark node={node()} pinned fold="glyph" />);
    const chip = container.querySelector('.node-context-mark') as HTMLElement;
    expect(chip.className).toContain('is-glyph');
    expect(chip.getAttribute('aria-label')).toBe('not read');
    expect(chip.textContent).toBe('');
    expect(chip.querySelector('svg')).toBeTruthy();
    cleanup();
    expect(markOf({ node: node(), pinned: true })).toBe('not read');
    const hidden = render(<NodeContextMark node={node()} pinned fold="hidden" />);
    expect(hidden.container.querySelector('.node-context-mark')).toBeNull();
    cleanup();
    expect(iconOf(node(), 'hidden', true).hint).toContain('Not read yet');
  });

  test('amber "changed since read" never folds', () => {
    applyContextStatus({
      nodes: [
        { nodeId: 'n1', lastReadAt: '2026-10-05T10:05:00.000Z', lastReadBy: 'claude', readRevision: 5, readCount: 1 },
      ],
      pins: { n1: { pinnedBy: human, pinnedAt: '2026-10-05T10:00:00.000Z' } },
    });
    const { container } = render(<NodeContextMark node={node({ contentRevision: 6 })} pinned fold="hidden" />);
    expect(container.querySelector('.node-context-mark')?.textContent).toBe('changed since read');
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

describe('near a pin: performance', () => {
  test('moving a node keeps the near map identity unless a neighbourhood changes', () => {
    const pin = node({ id: 'pin', data: { title: 'Release runbook' } });
    const close = node({ id: 'close', position: { x: 200, y: 0 } });
    const far = node({ id: 'far', position: { x: 3000, y: 0 } });
    const put = (...list: CanvasNodeState[]) => {
      nodes.value = new Map(list.map((entry) => [entry.id, entry]));
    };
    put(pin, close, far);
    contextPinnedNodeIds.value = new Set(['pin']);
    const first = nearPins.value;
    // Drag frames: the far node and the near node move, no neighbourhood changes.
    put(pin, { ...close, position: { x: 230, y: 10 } }, { ...far, position: { x: 2800, y: 0 } });
    expect(nearPins.value).toBe(first);
    // The far node comes within 600 px: now the map changes.
    put(pin, close, { ...far, position: { x: 400, y: 0 } });
    expect(nearPins.value).not.toBe(first);
    expect([...nearPins.value.keys()].sort()).toEqual(['close', 'far']);
    nodes.value = new Map();
    contextPinnedNodeIds.value = new Set();
  });
});
