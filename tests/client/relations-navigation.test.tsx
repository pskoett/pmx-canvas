import { afterAll, afterEach, expect, test, spyOn } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { GroupBreadcrumbs, GroupOutsideLinks } from '../../src/client/canvas/GroupNavigation.tsx';
import { EdgeEditor } from '../../src/client/canvas/EdgeEditor.tsx';
import { RelationLegend } from '../../src/client/canvas/EdgeLayer.tsx';
import { activeBoardId, boardList } from '../../src/client/state/boards-store.ts';
import {
  activeNodeId,
  edges,
  groupPath,
  nodes,
  openGroup,
  selectedNodeIds,
  viewport,
  resetCanvasInteractionState,
  cancelViewportAnimation,
  focusNode,
} from '../../src/client/state/canvas-store.ts';
import { showRelationsOnCanvas, relationHighlight } from '../../src/client/state/relation-store.ts';
import type { CanvasNodeState, CanvasEdge } from '../../src/client/types.ts';

const card = (id: string, children?: string[]): CanvasNodeState => ({
  id,
  type: children ? 'group' : 'markdown',
  position: { x: 200, y: 180 },
  size: { width: 280, height: 160 },
  pinned: false,
  collapsed: false,
  zIndex: 1,
  data: { title: id, ...(children ? { children } : {}) },
});
let refused = false;
const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(
  Object.assign(
    async () =>
      refused ? Response.json({ ok: false, error: 'Locked' }, { status: 409 }) : Response.json({ ok: true }),
    { preconnect: globalThis.fetch.preconnect },
  ),
);
afterAll(() => fetchMock.mockRestore());
afterEach(() => {
  cleanup();
  resetCanvasInteractionState();
  nodes.value = new Map();
  edges.value = new Map();
  activeBoardId.value = null;
  boardList.value = [];
  refused = false;
});

test('nested group navigation restores parent selection and camera and outside stubs target originals', async () => {
  const list = [
    card('outer', ['inner', 'sibling']),
    card('inner', ['child']),
    card('child'),
    card('sibling'),
    card('outside'),
  ];
  nodes.value = new Map(list.map((node) => [node.id, node]));
  edges.value = new Map([['crossing', { id: 'crossing', from: 'child', to: 'outside', type: 'relation' }]]);
  viewport.value = { x: 57, y: -19, scale: 0.7 };
  selectedNodeIds.value = new Set(['outer']);
  activeNodeId.value = 'outer';
  const { getByRole, queryByRole } = render(
    <>
      <GroupBreadcrumbs />
      <GroupOutsideLinks />
    </>,
  );
  openGroup('outer');
  await waitFor(() => expect(getByRole('navigation', { name: 'Group navigation' })).toBeTruthy());
  cancelViewportAnimation();
  viewport.value = { x: -330, y: 290, scale: 0.5 };
  selectedNodeIds.value = new Set(['inner']);
  activeNodeId.value = 'inner';
  openGroup('inner');
  await waitFor(() => expect(getByRole('button', { name: 'inner' }).getAttribute('aria-current')).toBe('location'));
  fireEvent.click(getByRole('button', { name: 'Leave group' }));
  expect(viewport.value).toEqual({ x: -330, y: 290, scale: 0.5 });
  expect([...selectedNodeIds.value]).toEqual(['inner']);
  fireEvent.click(getByRole('button', { name: 'Board', exact: true }));
  expect(viewport.value).toEqual({ x: 57, y: -19, scale: 0.7 });
  expect([...selectedNodeIds.value]).toEqual(['outer']);
  openGroup('outer');
  await waitFor(() => expect(getByRole('button', { name: /outside.*Show on canvas/ })).toBeTruthy());
  fireEvent.click(getByRole('button', { name: /outside.*Show on canvas/ }));
  expect(activeNodeId.value).toBe('outside');
  await waitFor(() => expect(queryByRole('navigation', { name: 'Group navigation' })).toBeNull());
  expect([...nodes.value.keys()]).toEqual(list.map((node) => node.id));
  expect(nodes.value.get('outside')?.position).toEqual({ x: 200, y: 180 });
  openGroup('outer');
  selectedNodeIds.value = new Set(['sibling']);
  activeNodeId.value = 'sibling';
  nodes.value = new Map(
    [...nodes.value].map(([id, node]) => [
      id,
      id === 'outer' ? { ...node, data: { ...node.data, children: ['inner'] } } : node,
    ]),
  );
  expect([...selectedNodeIds.value]).toEqual([]);
  expect(activeNodeId.value).toBeNull();
  nodes.value = new Map([...nodes.value].filter(([id]) => id !== 'outer'));
  expect(groupPath.value).toEqual([]);
});

test('outside links reveal collapsed ancestors without rewriting collapse flags', async () => {
  const source = card('source');
  const target = { ...card('target'), data: { title: 'Target', parentGroup: 'folded' } };
  const folded = { ...card('folded', ['target']), collapsed: true };
  nodes.value = new Map([card('open', ['source']), source, target, folded].map((node) => [node.id, node]));
  edges.value = new Map([['link', { id: 'link', from: 'source', to: 'target', type: 'relation' }]]);
  const { getByRole } = render(
    <>
      <GroupBreadcrumbs />
      <GroupOutsideLinks />
    </>,
  );
  openGroup('open');
  await waitFor(() => expect(getByRole('button', { name: /Target.*Show on canvas/ })).toBeTruthy());
  fireEvent.click(getByRole('button', { name: /Target.*Show on canvas/ }));
  await waitFor(() => expect(getByRole('button', { name: 'folded' }).getAttribute('aria-current')).toBe('location'));
  expect(activeNodeId.value).toBe('target');
  expect(nodes.value.get('folded')?.collapsed).toBe(true);
});

test('explicit focus cancels queued group fit and a board reset cancels pending navigation', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  const raf = spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++next, callback);
    return next;
  });
  const cancel = spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id);
  });
  try {
    const far = { ...card('far'), position: { x: 4000, y: 180 } };
    nodes.value = new Map([card('group', ['target', 'far']), card('target'), far].map((node) => [node.id, node]));
    viewport.value = { x: 0, y: 0, scale: 1 };
    openGroup('group');
    focusNode('target', { persistStacking: false });
    expect(frames.size).toBe(1);
    for (let i = 0; i < 2; i++) {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(performance.now() + 1000);
    }
    expect(viewport.value.scale).toBe(1);
    expect(activeNodeId.value).toBe('target');
    focusNode('far', { persistStacking: false });
    expect(frames.size).toBe(1);
    resetCanvasInteractionState();
    expect(frames.size).toBe(0);
    expect(groupPath.value).toEqual([]);
  } finally {
    cancelViewportAnimation();
    raf.mockRestore();
    cancel.mockRestore();
  }
});

test('dependency counts exclude flow loops and citations; lineage stays distinct from direct connections', async () => {
  activeBoardId.value = 'board';
  boardList.value = [{ id: 'board', name: 'Plan', folder: null, createdAt: '', lastOpenedAt: null, nodeCount: 6 }];
  const links: CanvasEdge[] = [
    { id: 'ab', from: 'a', to: 'b', type: 'relation', kind: 'depends-on' },
    { id: 'ba', from: 'b', to: 'a', type: 'relation', kind: 'depends-on' },
    { id: 'ca', from: 'c', to: 'a', type: 'relation', kind: 'depends-on' },
    { id: 'dc', from: 'd', to: 'c', type: 'relation', kind: 'depends-on' },
    { id: 'cf', from: 'c', to: 'f', type: 'relation', kind: 'loop' },
    { id: 'fc', from: 'f', to: 'c', type: 'relation', kind: 'if-fails' },
    { id: 'ea', from: 'e', to: 'a', type: 'relation', kind: 'cites' },
  ];
  nodes.value = new Map(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => [id, card(id)]));
  edges.value = new Map(links.map((edge) => [edge.id, edge]));
  activeNodeId.value = 'a';
  const { getByText } = render(<RelationLegend />);
  expect(getByText('⚠ 1 dependency cycles')).toBeTruthy();
  expect(getByText('Change selection → 3 affected')).toBeTruthy();
  showRelationsOnCanvas('a', 'lineage');
  expect(relationHighlight.value?.cards).toEqual(new Set(['a', 'b', 'c', 'd']));
  showRelationsOnCanvas('a', 'connections');
  expect(relationHighlight.value?.cards).toEqual(new Set(['a', 'b', 'c', 'e']));
});

test('inline relation editor retains refused draft and sends marked writes', async () => {
  activeBoardId.value = 'origin';
  refused = true;
  const { getByRole, getByLabelText } = render(
    <EdgeEditor
      edge={{ id: 'edge', from: 'a', to: 'b', type: 'relation', kind: 'depends-on' }}
      point={{ x: 300, y: 200 }}
    />,
  );
  fireEvent.click(getByRole('button', { name: 'Why', exact: true }));
  fireEvent.input(getByLabelText('Why this relation?'), { target: { value: 'Needs a reviewed schema' } });
  fireEvent.click(getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(getByRole('alert').textContent).toContain('Your draft is still here'));
  expect((getByLabelText('Why this relation?') as HTMLInputElement).value).toBe('Needs a reviewed schema');
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/canvas/edge/edge'));
  expect(new Headers(call?.[1]?.headers).get('X-PMX-Workbench')).toBe('1');
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ reason: 'Needs a reviewed schema', expectedBoardId: 'origin' });
  refused = false;
  fireEvent.click(getByRole('button', { name: 'Save', exact: true }));
  // Poll a boolean: formatting a live Happy DOM element on the first failure can exhaust the test timeout.
  await waitFor(() => expect(document.querySelector('.edge-editor-field') === null).toBe(true));
});
