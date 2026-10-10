import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { signal } from '@preact/signals';
import { fireEvent } from '@testing-library/preact';
import { render } from 'preact';
import { EdgeHint, EdgeLayer } from '../../src/client/canvas/EdgeLayer.tsx';
import {
  selectedEdgeId,
  edges as storeEdges,
  nodes as storeNodes,
  viewport,
} from '../../src/client/state/canvas-store.ts';
import { applyContextStatus, linksChanged } from '../../src/client/state/context-status-store.ts';
import { applyPresenceSnapshot, resetPresence } from '../../src/client/state/presence-store.ts';
import type { CanvasEdge, CanvasNodeState } from '../../src/client/types.ts';
import { type AgentPresence, HUMAN_STARTED_SESSION_LABEL } from '../../src/shared/agent-presence.ts';

// Link marks (docs/design/LinkAuthorship.dc.html): who drew the link (a violet ✦
// for an agent, until a person changes it) and whether the agent has seen a
// person's new link (until the next read carries it), both on the link's pill.

function card(id: string, x: number): CanvasNodeState {
  return {
    id,
    type: 'markdown',
    position: { x, y: 0 },
    size: { width: 200, height: 100 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data: { title: id },
  };
}

const human = { actor: 'human' as const, source: 'browser' };
const codex = { actor: 'agent' as const, source: 'mcp', agentId: 'codex' };

function presence(label: string, source: string): AgentPresence {
  return {
    sessionId: source,
    source,
    agentId: null,
    label,
    phase: 'idle',
    detail: null,
    focusNodeId: null,
    cursor: null,
    attached: true,
    opCount: 0,
    contextUsage: null,
    lastSeenAt: '2026-10-08T00:00:00.000Z',
  };
}

function draw(list: CanvasEdge[]): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(
    <>
      <EdgeLayer nodes={signal(storeNodes.value)} edges={signal(new Map(list.map((e) => [e.id, e])))} part="lines" />
      <EdgeLayer nodes={signal(storeNodes.value)} edges={signal(new Map(list.map((e) => [e.id, e])))} part="pills" />
    </>,
    host,
  );
  return host;
}

const spark = (host: HTMLElement) => host.querySelectorAll('[data-testid="edge-link-agent"]').length;
const notSeen = (host: HTMLElement) =>
  [...host.querySelectorAll('[data-testid="edge-link-mark"]')].map((mark) => mark.textContent);

beforeEach(() => {
  storeNodes.value = new Map([
    ['a', card('a', 0)],
    ['b', card('b', 800)],
    ['c', card('c', 1600)],
  ]);
  viewport.value = { x: 0, y: 0, scale: 1 };
  applyContextStatus({});
  resetPresence();
});
afterEach(() => {
  document.body.innerHTML = '';
  applyContextStatus({});
  resetPresence();
});

describe('link marks', () => {
  test('an agent-drawn link keeps its ✦ whether or not a read has carried it; it is never "not seen"', () => {
    const agentLink: CanvasEdge = {
      id: 'e1',
      from: 'a',
      to: 'b',
      type: 'relation',
      label: 'supports',
      revision: 9,
      changedBy: codex,
    };
    expect(spark(draw([agentLink]))).toBe(1);
    document.body.innerHTML = '';
    applyContextStatus({ links: { a: 12, b: 12 } });
    const host = draw([agentLink]);
    expect(spark(host)).toBe(1);
    expect(notSeen(host)).toEqual([]);
  });

  test("a person's new link says which agent has not seen it, until a read carries it; old links are quiet", () => {
    applyContextStatus({ links: { a: 4, b: 4, c: 4 } });
    applyPresenceSnapshot({ presences: [presence('Copilot', 'copilot')] });
    const host = draw([
      { id: 'mine', from: 'a', to: 'b', type: 'relation', label: 'supports', revision: 9, changedBy: human },
      { id: 'old', from: 'a', to: 'c', type: 'relation', label: 'informs', revision: 3, changedBy: human },
    ]);
    expect(notSeen(host)).toEqual(['not seen by Copilot']);
    expect(spark(host)).toBe(0);
  });

  test('quiet on a board no agent has read; "the agent" when none is attached or only a placeholder session', () => {
    const link: CanvasEdge = { id: 'e1', from: 'a', to: 'b', type: 'relation', revision: 9, changedBy: human };
    expect(notSeen(draw([link]))).toEqual([]);
    document.body.innerHTML = '';
    applyContextStatus({ links: { a: 4 } });
    expect(notSeen(draw([link]))).toEqual(['not seen by the agent']);
    document.body.innerHTML = '';
    applyPresenceSnapshot({ presences: [presence(HUMAN_STARTED_SESSION_LABEL, 'browser')] });
    expect(notSeen(draw([link]))).toEqual(['not seen by the agent']);
  });

  test('below 60% zoom "not seen" keeps only its glyph; below 35% the label goes and the marks stay', () => {
    applyContextStatus({ links: { a: 4 } });
    const list: CanvasEdge[] = [
      { id: 'mine', from: 'a', to: 'b', type: 'relation', label: 'supports', revision: 9, changedBy: human },
      { id: 'theirs', from: 'b', to: 'c', type: 'relation', label: 'informs', revision: 10, changedBy: codex },
    ];
    viewport.value = { x: 0, y: 0, scale: 0.5 };
    let host = draw(list);
    expect(notSeen(host)).toEqual(['']);
    expect(host.querySelector('[data-testid="edge-link-mark"] path')).toBeTruthy();
    expect([...host.querySelectorAll('.edge-label')].map((label) => label.textContent)).toEqual([
      'supports',
      'informs',
    ]);
    document.body.innerHTML = '';
    viewport.value = { x: 0, y: 0, scale: 0.3 };
    host = draw(list);
    expect(host.querySelectorAll('.edge-label').length).toBe(0);
    expect(spark(host)).toBe(1);
    expect(host.querySelectorAll('[data-testid="edge-link-mark"]').length).toBe(1);
  });

  test('hovering the pill names who drew the link and when, and who took it over', () => {
    const taken: CanvasEdge = {
      id: 'taken',
      from: 'a',
      to: 'b',
      type: 'relation',
      label: 'informs',
      revision: 9,
      changedBy: human,
      changedAt: '2026-10-08T14:20:00.000Z',
      createdBy: codex,
      createdAt: '2026-10-08T14:06:00.000Z',
    };
    const legacy: CanvasEdge = { id: 'legacy', from: 'b', to: 'c', type: 'relation', label: 'cites' };
    storeEdges.value = new Map([
      ['taken', taken],
      ['legacy', legacy],
    ]);
    const hintHost = document.createElement('div');
    document.body.appendChild(hintHost);
    render(<EdgeHint />, hintHost);
    const host = draw([taken, legacy]);
    const [pill, legacyPill] = [...host.querySelectorAll('[data-testid="edge-pill"]')] as Element[];
    const hint = () => document.querySelector('[data-testid="edge-hint"]')?.textContent ?? null;
    fireEvent.pointerEnter(pill as Element);
    expect(hint()).toMatch(/^You relabelled it · .+ \(drawn by codex · .+\)$/);
    fireEvent.pointerLeave(pill as Element);
    expect(hint()).toBeNull();

    // A link from before authorship was recorded names no one.
    fireEvent.pointerEnter(legacyPill as Element);
    expect(hint()).toBeNull();

    // A hint whose link goes away under a resting pointer goes with it.
    fireEvent.pointerEnter(pill as Element);
    expect(hint()).not.toBeNull();
    storeEdges.value = new Map([['legacy', legacy]]);
    render(<EdgeHint />, hintHost);
    expect(hint()).toBeNull();
    storeEdges.value = new Map();
  });

  test('clicking a pill selects its link; double-click opens the link menu (pills sit above group frames)', () => {
    const opened: string[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const list = signal(
      new Map<string, CanvasEdge>([
        ['e1', { id: 'e1', from: 'a', to: 'b', type: 'relation', label: 'supports', revision: 9, changedBy: codex }],
      ]),
    );
    render(
      <EdgeLayer
        nodes={signal(storeNodes.value)}
        edges={list}
        part="pills"
        onEdgeContextMenu={(_e, id) => opened.push(id)}
      />,
      host,
    );
    const svg = host.querySelector('svg') as SVGElement;
    expect(svg.style.zIndex).toBe('1');
    const pill = host.querySelector('[data-testid="edge-pill"]') as Element;
    fireEvent.click(pill);
    expect(selectedEdgeId.value).toBe('e1');
    fireEvent.dblClick(pill);
    expect(opened).toEqual(['e1']);
    selectedEdgeId.value = null;
  });

  test("a card's links changed after the read: a person's link or a removal counts, an agent's own link does not", () => {
    applyContextStatus({ links: { a: 4, b: 4 } });
    storeEdges.value = new Map();
    expect(linksChanged('a', 9)).toBe(true); // nothing left on an edge: a removal
    expect(linksChanged('a', 4)).toBe(false);
    expect(linksChanged('c', 9)).toBe(false); // never carried by a read

    storeEdges.value = new Map([
      ['e1', { id: 'e1', from: 'a', to: 'b', type: 'relation', revision: 9, changedBy: codex }],
    ]);
    expect(linksChanged('a', 9)).toBe(false);

    storeEdges.value = new Map([
      ['e1', { id: 'e1', from: 'a', to: 'b', type: 'relation', revision: 9, changedBy: codex }],
      ['e2', { id: 'e2', from: 'b', to: 'a', type: 'relation', revision: 7, changedBy: human }],
    ]);
    expect(linksChanged('a', 9)).toBe(true);
    storeEdges.value = new Map();
  });
});
