import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { CanvasNode } from '../../src/client/canvas/CanvasNode.tsx';
import { canvasTool, nodes, selectedNodeIds, viewport } from '../../src/client/state/canvas-store.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (async () => new Response('{}')) as unknown as typeof fetch;
  selectedNodeIds.value = new Set(['other']);
  canvasTool.value = 'select';
  viewport.value = { x: 0, y: 0, scale: 0.5 };
});
afterEach(cleanup);
afterAll(() => {
  globalThis.fetch = realFetch;
});

function titlebar(type: CanvasNodeState['type'] = 'markdown', collapsed = false) {
  const node: CanvasNodeState = {
    id: 'target',
    type,
    position: { x: 100, y: 100 },
    size: { width: 300, height: 180 },
    zIndex: 1,
    collapsed,
    pinned: false,
    data: { title: 'Target', strictSize: true },
  };
  nodes.value = new Map([[node.id, node]]);
  return render(<CanvasNode node={node}>Body</CanvasNode>).container.querySelector('.node-titlebar')!;
}

for (const [type, collapsed] of [
  ['markdown', false],
  ['group', false],
  ['group', true],
] as const) {
  test(`${type} collapsed=${collapsed}: plain release selects, shift toggles`, () => {
    const bar = titlebar(type, collapsed);
    fireEvent.pointerDown(bar, { button: 0, clientX: 100, clientY: 100 });
    expect([...selectedNodeIds.value]).toEqual(['other']);
    fireEvent.pointerMove(document, { clientX: 102, clientY: 102 });
    fireEvent.pointerUp(document, { clientX: 102, clientY: 102 });
    expect([...selectedNodeIds.value]).toEqual(['target']);
    expect(nodes.value.get('target')?.position).toEqual({ x: 100, y: 100 });
    fireEvent.pointerDown(bar, { button: 0, shiftKey: true });
    fireEvent.pointerUp(document);
    expect([...selectedNodeIds.value]).toEqual([]);
    fireEvent.pointerDown(bar, { button: 0, shiftKey: true });
    fireEvent.pointerUp(document);
    expect([...selectedNodeIds.value]).toEqual(['target']);
  });
}

test('crossing the drag threshold preserves selection even after returning to the origin', () => {
  const bar = titlebar();
  fireEvent.pointerDown(bar, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(document, { clientX: 104, clientY: 100 });
  fireEvent.pointerMove(document, { clientX: 100, clientY: 100 });
  fireEvent.pointerUp(document, { clientX: 100, clientY: 100 });
  expect([...selectedNodeIds.value]).toEqual(['other']);
});

test('cancel and titlebar controls do not select', () => {
  const bar = titlebar();
  fireEvent.pointerDown(bar, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerCancel(document);
  expect([...selectedNodeIds.value]).toEqual(['other']);
  fireEvent.pointerDown(bar.querySelector('button')!, { button: 0 });
  fireEvent.pointerUp(document);
  expect([...selectedNodeIds.value]).toEqual(['other']);
});
