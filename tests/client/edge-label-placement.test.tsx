import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { EdgeLayer } from '../../src/client/canvas/EdgeLayer.tsx';
import { edges, nodes, selectedEdgeId, viewport } from '../../src/client/state/canvas-store.ts';
import { applyContextStatus } from '../../src/client/state/context-status-store.ts';
import type { CanvasEdge, CanvasNodeState } from '../../src/client/types.ts';
import demo from '../../src/server/demo-state.json';

function card(id: string, x: number, y: number, type: CanvasNodeState['type'] = 'markdown'): CanvasNodeState {
  return {
    id,
    type,
    position: { x, y },
    size: { width: 280, height: 180 },
    zIndex: 10,
    collapsed: false,
    pinned: true,
    data: { title: id },
  };
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function rect(element: Element): Bounds {
  return {
    x: Number(element.getAttribute('x')),
    y: Number(element.getAttribute('y')),
    width: Number(element.getAttribute('width')),
    height: Number(element.getAttribute('height')),
  };
}

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  applyContextStatus({});
  selectedEdgeId.value = null;
  viewport.value = { x: 0, y: 0, scale: 1 };
});
afterEach(() => {
  render(null, host);
  host.remove();
  edges.value = new Map();
  nodes.value = new Map();
  selectedEdgeId.value = null;
  viewport.value = { x: 0, y: 0, scale: 1 };
});

function draw(cards: CanvasNodeState[], links: CanvasEdge[]) {
  nodes.value = new Map(cards.map((node) => [node.id, node]));
  edges.value = new Map(links.map((edge) => [edge.id, edge]));
  render(<EdgeLayer nodes={nodes} edges={edges} />, host);
}

// Happy DOM does not lay out SVG. Inspect the emitted paint/hit rectangles,
// not a placement helper's return value; real stacking/hit testing is an E2E gate.
function assertClearLabels(cards: CanvasNodeState[], links: CanvasEdge[]): Bounds[] {
  const painted: Bounds[] = [];
  const pills = [...host.querySelectorAll('.edge-pill')];
  expect(pills).toHaveLength(links.length);
  pills.forEach((pill, index) => {
    const [x, y] = (pill.getAttribute('transform')?.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const background = rect(pill.querySelector('.edge-label-bg')!);
    const paint = { ...background, x: background.x + x, y: background.y + y };
    expect(pill.textContent).toContain(links[index].label!);
    const hit = host.querySelector(`.edge-pill-hit[data-edge-id="${links[index].id}"]`)!;
    expect(rect(hit)).toEqual(paint);
    for (const node of cards) {
      expect(overlaps(paint, { ...node.position, ...node.size })).toBe(false);
      for (const handle of handles(node)) expect(overlaps(paint, handle)).toBe(false);
    }
    for (const previous of painted) expect(overlaps(paint, previous)).toBe(false);
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(selectedEdgeId.value).toBe(links[index].id);
    painted.push(paint);
  });
  return painted;
}

// Match the four .node-port CSS rectangles, not a padded envelope that
// incorrectly consumes the entire row gap at fractional zoom.
function handles(node: CanvasNodeState): Bounds[] {
  if (node.type === 'group') return [];
  const reach = 32 / viewport.value.scale;
  const { x, y } = node.position;
  const { width, height } = node.size;
  return [
    { x: x + width / 2 - reach / 2, y: y - reach, width: reach, height: reach },
    { x: x + width / 2 - reach / 2, y: y + height, width: reach, height: reach },
    { x: x - reach, y: y + height / 2 - reach / 2, width: reach, height: reach },
    { x: x + width, y: y + height / 2 - reach / 2, width: reach, height: reach },
  ];
}

describe('relation label placement', () => {
  test('paint and hit bounds use measured glyph widths and update when the font finishes loading', async () => {
    let fontMultiplier = 1;
    const context = {
      font: '',
      measureText(text: string) {
        const width = text.length * (text.includes('W') ? 10 : 2) * fontMultiplier;
        return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width } as TextMetrics;
      },
    } as CanvasRenderingContext2D;
    const getContext = spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const fonts = new EventTarget();
    const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    try {
      const cards = [card('a', 0, 0), card('b', 1000, 0)];
      const links: CanvasEdge[] = ['iiiiiiii', 'WWWWWWWW'].map((label) => ({
        id: label,
        label,
        from: 'a',
        to: 'b',
        type: 'relation',
      }));
      viewport.value = { x: 0, y: 0, scale: 0.5 };
      draw(cards, links);
      const before = assertClearLabels(cards, links);
      expect(before[0].width).toBeLessThan(before[1].width);
      for (const [index, link] of links.entries()) {
        const glyphWidth = context.measureText(`${link.label} · ×2`).width * 2;
        expect(before[index].width).toBeGreaterThan(glyphWidth);
        expect(before[index].width).toBeLessThanOrEqual(glyphWidth + 36);
      }
      expect(context.font).toContain('11px');
      await act(() => {
        fontMultiplier = 1.5;
        fonts.dispatchEvent(new Event('loadingdone'));
      });
      const after = assertClearLabels(cards, links);
      expect(after[0].width).toBeGreaterThan(before[0].width);
      expect(after[1].width).toBeGreaterThan(before[1].width);
    } finally {
      render(null, host);
      getContext.mockRestore();
      if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
      else Reflect.deleteProperty(document, 'fonts');
    }
  });

  test('the populated demo keeps changed-in in the nearby row gap at fractional zoom', async () => {
    const cards = demo.nodes as CanvasNodeState[];
    const links = (demo.edges as CanvasEdge[]).map((edge) => ({
      ...edge,
      revision: 9,
      changedBy: { actor: 'human' as const, source: 'browser' },
    }));
    applyContextStatus({ links: { 'file-ts': 4 } });
    const source = cards.find((node) => node.id === 'file-ts')!;
    const target = cards.find((node) => node.id === 'diff')!;
    const nextRow = cards.find((node) => node.id === 'label-diagrams')!;
    draw(cards, links);
    for (const scale of [0.39, 0.6, 0.41, 0.35, 0.28, 0.39]) {
      await act(() => {
        viewport.value = { x: 0, y: 0, scale };
      });
      const hit = host.querySelector('.edge-pill-hit[data-edge-id="edge-changed-in"]')!;
      const paint = rect(hit);
      expect(paint.x).toBeGreaterThanOrEqual(source.position.x);
      expect(paint.x + paint.width).toBeLessThanOrEqual(target.position.x + target.size.width);
      expect(paint.y).toBeGreaterThanOrEqual(source.position.y + source.size.height);
      expect(paint.y + paint.height).toBeLessThanOrEqual(nextRow.position.y);
      for (const node of cards) {
        expect(overlaps(paint, { ...node.position, ...node.size })).toBe(false);
        for (const handle of handles(node)) expect(overlaps(paint, handle)).toBe(false);
      }
      const pill = host.querySelector('.edge-pill[data-edge-id="edge-changed-in"]')!;
      expect(pill.querySelector('[data-testid="edge-link-mark"]')).not.toBeNull();
      expect(pill.querySelectorAll('.edge-label')).toHaveLength(scale < 0.35 ? 0 : 1);
      const [x, y] = pill
        .getAttribute('transform')!
        .match(/-?\d+(?:\.\d+)?/g)!
        .map(Number);
      const background = rect(pill.querySelector('.edge-label-bg')!);
      expect(paint).toEqual({ ...background, x: background.x + x, y: background.y + y });
      await act(() => {
        viewport.value = { x: 510, y: -320, scale };
      });
      expect(rect(host.querySelector('.edge-pill-hit[data-edge-id="edge-changed-in"]')!)).toEqual(paint);
    }
  });

  test('short gaps and long labels clear endpoint and unrelated iframe cards through zoom/pan cycles', () => {
    const cards = [card('source', 0, 0, 'file'), card('target', 330, 0, 'diff'), card('viewer', 160, -240, 'html')];
    const links: CanvasEdge[] = [
      { id: 'change', from: 'source', to: 'target', type: 'relation', label: 'changed in the implementation review' },
    ];
    const saved = JSON.stringify(cards);
    for (const scale of [1, 0.6, 0.35, 1.5, 0.5, 1]) {
      viewport.value = { x: 91, y: -47, scale };
      draw(cards, links);
      const beforePan = assertClearLabels(cards, links);
      viewport.value = { x: -250, y: 320, scale };
      draw(cards, links);
      expect(assertClearLabels(cards, links)).toEqual(beforePan);
      expect(host.querySelector('[data-testid="edge-label-leader"]')?.getAttribute('data-edge-id')).toBe('change');
    }
    expect(JSON.stringify(cards)).toBe(saved);
  });

  test('parallel long labels have separate paint and hit space, including selected edges', () => {
    const cards = [card('sequence', 100, 100, 'mermaid'), card('approval', 410, 100, 'html')];
    const links: CanvasEdge[] = ['supports', 'cites', 'depends-on'].map((kind) => ({
      id: kind,
      from: 'sequence',
      to: 'approval',
      type: 'relation',
      kind,
      label: `${kind}: approval from the review team`,
    }));
    selectedEdgeId.value = 'cites';
    draw(cards, links);
    assertClearLabels(cards, links);
    expect(host.querySelector('#edge-path-cites')?.classList.contains('edge-selected')).toBe(true);
    const leaders = host.querySelectorAll('[data-testid="edge-label-leader"]');
    expect(leaders).toHaveLength(3);
    for (const leader of leaders) {
      const line = host.querySelector(`[id="edge-path-${leader.getAttribute('data-edge-id')}"]`)!;
      expect(leader.getAttribute('stroke')).toBe(line.getAttribute('stroke'));
      expect(leader.hasAttribute('marker-end')).toBe(false);
    }
  });

  test('a clear midpoint stays on its curve without a leader', () => {
    const cards = [card('a', 0, 0), card('b', 1000, 0)];
    const links: CanvasEdge[] = [{ id: 'e', from: 'a', to: 'b', type: 'relation', label: 'supports' }];
    draw(cards, links);
    const [paint] = assertClearLabels(cards, links);
    expect(paint.x + paint.width / 2).toBe(640);
    expect(paint.y + paint.height / 2).toBe(90);
    expect(host.querySelector('[data-testid="edge-label-leader"]')).toBeNull();
  });

  test('an unrelated card covering a long edge midpoint cannot cover its label', () => {
    const cards = [card('a', 0, 0), card('b', 1000, 240), card('unrelated', 500, 100, 'mcp-app')];
    const links: CanvasEdge[] = [{ id: 'diagonal', from: 'b', to: 'a', type: 'relation', label: 'WWW cited evidence' }];
    draw(cards, links);
    assertClearLabels(cards, links);
    expect(host.querySelector('[data-testid="edge-label-leader"]')).not.toBeNull();
  });

  test('expanded group interiors remain usable label space', () => {
    const children = [card('a', 100, 100), card('b', 700, 100)];
    const group = card('group', 0, 0, 'group');
    group.size = { width: 1100, height: 500 };
    group.data.children = ['a', 'b'];
    const links: CanvasEdge[] = [{ id: 'inside', from: 'a', to: 'b', type: 'relation', label: 'supports' }];
    draw([group, ...children], links);
    const [paint] = assertClearLabels(children, links);
    expect(paint.x).toBeGreaterThan(group.position.x);
    expect(paint.x + paint.width).toBeLessThan(group.size.width);
    expect(paint.y).toBeGreaterThan(group.position.y + 12);
    expect(paint.y + paint.height).toBeLessThan(group.size.height);
    expect(host.querySelector('[data-testid="edge-label-leader"]')).toBeNull();
  });
});
