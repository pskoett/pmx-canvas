import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { NearPinMark, NodeContextMark, NodeTypeIcon, isAgentPin } from '../../src/client/canvas/NodeContextMark.tsx';
import { NearPinCard, NearPinLayer } from '../../src/client/canvas/NearPinLayer.tsx';
import { contextPinnedNodeIds, nodes, selectedNodeIds } from '../../src/client/state/canvas-store.ts';
import { grabbingNodeId } from '../../src/client/state/human-store.ts';
import {
  hoveredNodeId,
  nearCard,
  nearChange,
  nearPins,
  noteNearAtGrab,
  settleNearAfterDrop,
  shownPinsFor,
  tetherFocus,
} from '../../src/client/state/near-pin-store.ts';
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
    expect(markOf({ node: node({ contentRevision: 6 }), pinned: true })).toBe('changed');
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
    expect(container.querySelector('.node-context-mark')?.textContent).toBe('changed');
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
    // At rest the node must not contain the pins' titles; the chip's card (over the canvas) names them.
    const { container } = render(<NearPinMark node={close} pinned={false} />);
    expect(container.textContent).not.toContain('Release runbook');
    cleanup();
    nearCard.value = null;
    expect(nearOf(far)).toBeNull();
    expect(nearOf(pinA, true)).toBeNull();
    nodes.value = new Map();
    contextPinnedNodeIds.value = new Set();
  });
});

function nearScene() {
  const pinA = node({ id: 'pin-a', data: { title: 'Release runbook' } });
  const pinB = node({ id: 'pin-b', position: { x: 300, y: 0 }, data: { title: 'Rollout' } });
  const close = node({ id: 'close', position: { x: 150, y: 0 }, data: { title: 'Price page copy' } });
  const farther = node({ id: 'farther', position: { x: 0, y: 400 }, data: { title: 'Pricing notes' } });
  nodes.value = new Map([pinA, pinB, close, farther].map((entry) => [entry.id, entry]));
  contextPinnedNodeIds.value = new Set(['pin-a', 'pin-b']);
  return { close };
}

function resetNear() {
  nodes.value = new Map();
  contextPinnedNodeIds.value = new Set();
  selectedNodeIds.value = new Set();
  hoveredNodeId.value = null;
  shownPinsFor.value = null;
  nearCard.value = null;
  nearChange.value = null;
  grabbingNodeId.value = null;
}

describe('near a pin: the card, tethers and the moment it changes (NearPin.dc.html §2–3)', () => {
  afterEach(resetNear);

  test('hovering the chip opens a card with each pin and its distance, then Pin / Show pins', () => {
    const { close } = nearScene();
    const { container } = render(
      <>
        <NearPinMark node={close} pinned={false} />
        <NearPinCard />
      </>,
    );
    fireEvent.pointerEnter(container.querySelector('.node-near-mark') as Element);
    const card = container.querySelector('.near-hint') as HTMLElement;
    expect(card.querySelector('.near-hint-label')?.textContent).toBe('Near 2 pins');
    const rows = [...card.querySelectorAll('.near-hint-row')].map((row) => row.textContent);
    expect(rows).toEqual(['Release runbook150 px', 'Rollout150 px']);
    fireEvent.click(card.querySelector('.near-hint-show') as Element);
    expect(shownPinsFor.value).toBe('close');
    expect(tetherFocus.value.pinIds.sort()).toEqual(['pin-a', 'pin-b']);
    fireEvent.click(card.querySelector('.near-hint-pin') as Element);
    expect(contextPinnedNodeIds.value.has('close')).toBe(true);
    expect(nearCard.value).toBeNull();
  });

  test('Enter on the chip opens its card; Escape in the card closes it', () => {
    const { close } = nearScene();
    const { container } = render(
      <>
        <NearPinMark node={close} pinned={false} />
        <NearPinCard />
      </>,
    );
    fireEvent.keyDown(container.querySelector('.node-near-mark') as Element, { key: 'Enter' });
    expect(nearCard.value?.nodeId).toBe('close');
    fireEvent.keyDown(container.querySelector('.near-hint') as Element, { key: 'Escape' });
    expect(nearCard.value).toBeNull();
  });

  test('the card opens above a chip in the lower half of the window, and scrolls if still too tall', () => {
    nearScene();
    const bottom = window.innerHeight - 40;
    nearCard.value = { nodeId: 'close', at: { left: 100, right: 160, top: bottom - 18, bottom }, view: '0,0,1' };
    const { container } = render(<NearPinCard />);
    const card = container.querySelector('.near-hint') as HTMLElement;
    expect(card.style.top).toBe('');
    expect(card.style.bottom).toBe(`${window.innerHeight - (bottom - 18) + 8}px`);
    expect(card.style.maxHeight).toBe(`${Math.max(120, bottom - 18 - 16)}px`);
  });

  test('a hovered pin draws numbered tethers to its neighbours, nearest first, and its 600 px radius', () => {
    nearScene();
    hoveredNodeId.value = 'pin-a';
    const { container } = render(<NearPinLayer />);
    expect(container.querySelector('[data-pin-id="pin-a"] .near-pin-radius')?.getAttribute('r')).toBe('600');
    const tethers = [...container.querySelectorAll('.near-pin-tether')].map((tether) => [
      (tether as HTMLElement).dataset.nearNode,
      tether.querySelector('.near-pin-number-label')?.textContent,
    ]);
    expect(tethers).toEqual([
      ['close', '1'],
      ['farther', '2'],
    ]);
  });

  test('nothing is drawn while no pin is hovered, selected, dragged or shown', () => {
    nearScene();
    const { container } = render(<NearPinLayer />);
    expect(container.querySelector('.near-pin-layer')).toBeNull();
  });

  test('dragging an unpinned node rings only the nearest pin and previews its chip', () => {
    const { close } = nearScene();
    nodes.value = new Map(nodes.value).set('close', { ...close, position: { x: 260, y: 0 } });
    grabbingNodeId.value = 'close';
    expect(tetherFocus.value).toEqual({ pinIds: ['pin-b'], ringOnly: true });
    const { container } = render(<NearPinMark node={nodes.value.get('close') as CanvasNodeState} pinned={false} />);
    expect(container.querySelector('.node-near-mark')?.classList.contains('is-preview')).toBe(true);
  });

  test('a drop inside pulses the chip once; a drop outside keeps it to fade out', () => {
    const { close } = nearScene();
    const far = { ...close, position: { x: 3000, y: 0 } };
    nodes.value = new Map(nodes.value).set('close', far);
    noteNearAtGrab('close');
    nodes.value = new Map(nodes.value).set('close', close);
    settleNearAfterDrop('close');
    expect(nearChange.value?.kind).toBe('in');
    const first = render(<NearPinMark node={close} pinned={false} />);
    const chip = first.container.querySelector('.node-near-mark') as Element;
    expect(chip.classList.contains('is-pulse')).toBe(true);
    fireEvent.animationEnd(chip);
    expect(nearChange.value).toBeNull();
    cleanup();

    noteNearAtGrab('close');
    nodes.value = new Map(nodes.value).set('close', far);
    settleNearAfterDrop('close');
    expect(nearChange.value?.kind).toBe('out');
    const { container } = render(<NearPinMark node={far} pinned={false} />);
    expect(container.querySelector('.node-near-mark')?.classList.contains('is-fading')).toBe(true);
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
