import { describe, expect, test } from 'bun:test';
import type { CanvasEdge, CanvasLayout, CanvasNodeState } from '../../src/client/types.ts';
import {
  formatCompactWatchEvent,
  SemanticWatchReducer,
  type SemanticWatchEvent,
  type SseMessage,
} from '../../src/shared/semantic-attention.ts';

// Geometry reference for fixtures (all nodes are 100x100):
// - proximity clusters use edge-to-edge gap <= 200px
// - pinned neighborhoods use center distance <= 600px

interface NodeSpec {
  id: string;
  type?: CanvasNodeState['type'];
  x?: number;
  y?: number;
  title?: string;
  data?: Record<string, unknown>;
}

function makeNode(spec: NodeSpec): CanvasNodeState {
  return {
    id: spec.id,
    type: spec.type ?? 'markdown',
    position: { x: spec.x ?? 0, y: spec.y ?? 0 },
    size: { width: 100, height: 100 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data: { ...(spec.title !== undefined ? { title: spec.title } : {}), ...spec.data },
  };
}

function makeLayout(nodes: NodeSpec[], edges: CanvasEdge[] = []): CanvasLayout {
  return {
    viewport: { x: 0, y: 0, scale: 1 },
    nodes: nodes.map(makeNode),
    edges,
  };
}

function layoutMessage(layout: CanvasLayout, meta: Record<string, unknown> = {}): SseMessage {
  return { event: 'canvas-layout-update', data: { layout, ...meta } };
}

function pinsMessage(nodeIds: unknown[], meta: Record<string, unknown> = {}): SseMessage {
  return { event: 'context-pins-changed', data: { nodeIds, ...meta } };
}

function eventTypes(events: SemanticWatchEvent[]): string[] {
  return events.map((event) => event.type);
}

/** Asserts the batch contains exactly one event of the given type and returns it narrowed. */
function single<T extends SemanticWatchEvent['type']>(
  events: SemanticWatchEvent[],
  type: T,
): Extract<SemanticWatchEvent, { type: T }> {
  expect(eventTypes(events)).toEqual([type]);
  return events[0] as Extract<SemanticWatchEvent, { type: T }>;
}

describe('SemanticWatchReducer message routing', () => {
  test('ignores SSE events it does not understand', () => {
    const reducer = new SemanticWatchReducer();

    expect(reducer.handleMessage({ event: 'viewport-changed', data: { layout: makeLayout([{ id: 'a' }]) } })).toEqual(
      [],
    );
    expect(reducer.handleMessage({ event: 'node-hover', data: null })).toEqual([]);
    // The layout embedded in an unknown event must not become the baseline.
    expect(reducer.getAttentionSnapshot().layout).toBeNull();
  });

  test('treats the first layout update as a silent baseline even when it contains nodes and edges', () => {
    const reducer = new SemanticWatchReducer();

    const events = reducer.handleMessage(
      layoutMessage(
        makeLayout(
          [
            { id: 'a', title: 'Spec' },
            { id: 'b', x: 150 },
          ],
          [{ id: 'e1', from: 'a', to: 'b', type: 'flow' }],
        ),
      ),
    );

    expect(events).toEqual([]);
    expect(reducer.getAttentionSnapshot().layout).not.toBeNull();
  });

  test('ignores malformed layout payloads without disturbing the baseline', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage(layoutMessage(makeLayout([{ id: 'a' }, { id: 'b', x: 900 }])));

    expect(reducer.handleMessage({ event: 'canvas-layout-update', data: null })).toEqual([]);
    expect(reducer.handleMessage({ event: 'canvas-layout-update', data: { layout: 'bogus' } })).toEqual([]);

    // The next valid update still diffs against the original baseline.
    const events = reducer.handleMessage(
      layoutMessage(
        makeLayout([{ id: 'a' }, { id: 'b', x: 900 }], [{ id: 'e1', from: 'a', to: 'b', type: 'relation' }]),
      ),
    );
    expect(eventTypes(events)).toEqual(['connect']);
  });
});

describe('SemanticWatchReducer context pin reduction', () => {
  test('emits pin deltas with titles resolved from the layout, treating blank titles as null', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage(
      layoutMessage(
        makeLayout([
          { id: 'doc', title: 'Bug report' },
          { id: 'blank', title: '   ', type: 'file', x: 900 },
        ]),
      ),
    );

    const added = single(reducer.handleMessage(pinsMessage(['doc', 'blank'])), 'context-pin');
    expect(added.added).toEqual([
      { id: 'blank', title: null, nodeType: 'file' },
      { id: 'doc', title: 'Bug report', nodeType: 'markdown' },
    ]);
    expect(added.removed).toEqual([]);

    const removed = single(reducer.handleMessage(pinsMessage(['doc'])), 'context-pin');
    expect(removed.added).toEqual([]);
    expect(removed.removed).toEqual([{ id: 'blank', title: null, nodeType: 'file' }]);
  });

  test('re-broadcasting the same pin set, in any order, emits nothing', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage(layoutMessage(makeLayout([{ id: 'a' }, { id: 'b', x: 900 }])));
    reducer.handleMessage(pinsMessage(['a', 'b']));

    expect(reducer.handleMessage(pinsMessage(['a', 'b']))).toEqual([]);
    expect(reducer.handleMessage(pinsMessage(['b', 'a']))).toEqual([]);
  });

  test('setInitialPins seeds the baseline so only the delta is announced', () => {
    const reducer = new SemanticWatchReducer();
    reducer.setInitialPins(['a']);
    reducer.handleMessage(
      layoutMessage(
        makeLayout([
          { id: 'a', title: 'Known' },
          { id: 'b', title: 'New', x: 900 },
        ]),
      ),
    );

    const event = single(reducer.handleMessage(pinsMessage(['a', 'b'])), 'context-pin');
    expect(event.added).toEqual([{ id: 'b', title: 'New', nodeType: 'markdown' }]);
    expect(event.removed).toEqual([]);
  });

  test('pin changes before any layout are silent but land in the next attention snapshot', () => {
    const reducer = new SemanticWatchReducer();

    expect(reducer.handleMessage(pinsMessage(['a']))).toEqual([]);
    expect(reducer.getAttentionSnapshot().pinnedNodeIds).toEqual([]);

    reducer.handleMessage(layoutMessage(makeLayout([{ id: 'a', title: 'Anchor' }])));
    const snapshot = reducer.getAttentionSnapshot();
    expect(snapshot.pinnedNodeIds).toEqual(['a']);
    expect(snapshot.primaryFocusNodeIds).toEqual(['a']);
  });

  test('drops non-string pin ids and summarizes unknown ids with fallback defaults', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage(layoutMessage(makeLayout([{ id: 'real', title: 'Doc', type: 'file' }])));

    const event = single(reducer.handleMessage(pinsMessage(['ghost', 42, null, 'real'])), 'context-pin');
    expect(event.added).toEqual([
      { id: 'ghost', title: null, nodeType: 'markdown' },
      { id: 'real', title: 'Doc', nodeType: 'file' },
    ]);
  });

  test('carries string timestamp and sessionId meta onto events and drops non-string meta', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage(layoutMessage(makeLayout([{ id: 'a' }, { id: 'b', x: 900 }])));

    const pin = single(
      reducer.handleMessage(pinsMessage(['a'], { timestamp: '2026-07-10T09:00:00.000Z', sessionId: 'sess-1' })),
      'context-pin',
    );
    expect(pin.timestamp).toBe('2026-07-10T09:00:00.000Z');
    expect(pin.sessionId).toBe('sess-1');

    const connect = single(
      reducer.handleMessage(
        layoutMessage(
          makeLayout([{ id: 'a' }, { id: 'b', x: 900 }], [{ id: 'e1', from: 'a', to: 'b', type: 'flow' }]),
          { timestamp: 12345 },
        ),
      ),
      'connect',
    );
    expect(connect.timestamp).toBeUndefined();
    expect(connect.sessionId).toBeUndefined();
  });
});

describe('SemanticWatchReducer layout diff reduction', () => {
  test('emits connect for added edges with endpoint titles from the new layout', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage(
      layoutMessage(
        makeLayout([
          { id: 'a', title: 'Spec' },
          { id: 'b', x: 900 },
        ]),
      ),
    );

    const event = single(
      reducer.handleMessage(
        layoutMessage(
          makeLayout(
            [
              { id: 'a', title: 'Spec' },
              { id: 'b', x: 900 },
            ],
            [{ id: 'e1', from: 'a', to: 'b', type: 'depends-on' }],
          ),
        ),
      ),
      'connect',
    );

    expect(event.edges).toEqual([
      { id: 'e1', edgeType: 'depends-on', fromId: 'a', toId: 'b', fromTitle: 'Spec', toTitle: null },
    ]);
  });

  test('emits one remove event covering deleted nodes and their edges, titled from the previous layout', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage(
      layoutMessage(
        makeLayout(
          [
            { id: 'a', title: 'Spec' },
            { id: 'b', title: 'Impl', x: 900 },
            { id: 'c', x: 1800 },
          ],
          [
            { id: 'e1', from: 'a', to: 'b', type: 'flow' },
            { id: 'e2', from: 'b', to: 'c', type: 'relation' },
          ],
        ),
      ),
    );

    const event = single(
      reducer.handleMessage(
        layoutMessage(
          makeLayout([
            { id: 'a', title: 'Spec' },
            { id: 'c', x: 1800 },
          ]),
        ),
      ),
      'remove',
    );

    expect(event.nodes).toEqual([{ id: 'b', title: 'Impl', nodeType: 'markdown' }]);
    expect(event.edges).toEqual([
      { id: 'e1', edgeType: 'flow', fromId: 'a', toId: 'b', fromTitle: 'Spec', toTitle: 'Impl' },
      { id: 'e2', edgeType: 'relation', fromId: 'b', toId: 'c', fromTitle: 'Impl', toTitle: null },
    ]);
  });

  test('re-broadcasting a structurally identical layout emits nothing', () => {
    const reducer = new SemanticWatchReducer();
    const build = () =>
      makeLayout(
        [
          { id: 'a', title: 'One' },
          { id: 'b', x: 150 },
          { id: 'g', type: 'group', x: 2000, data: { children: ['a', 'b'] } },
        ],
        [{ id: 'e1', from: 'a', to: 'b', type: 'flow' }],
      );

    reducer.handleMessage(layoutMessage(build()));
    expect(reducer.handleMessage(layoutMessage(build()))).toEqual([]);
  });

  test('a single layout update can yield multiple events, connect before remove', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage(
      layoutMessage(
        makeLayout(
          [{ id: 'a' }, { id: 'b', x: 900 }, { id: 'c', x: 1800 }],
          [{ id: 'e1', from: 'a', to: 'b', type: 'flow' }],
        ),
      ),
    );

    const events = reducer.handleMessage(
      layoutMessage(
        makeLayout([{ id: 'a' }, { id: 'c', x: 1800 }], [{ id: 'e2', from: 'a', to: 'c', type: 'references' }]),
      ),
    );

    expect(eventTypes(events)).toEqual(['connect', 'remove']);
  });

  test('reports created groups with their title and only string children counted', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage(layoutMessage(makeLayout([{ id: 'a' }, { id: 'b', x: 150 }])));

    const event = single(
      reducer.handleMessage(
        layoutMessage(
          makeLayout([
            { id: 'a' },
            { id: 'b', x: 150 },
            { id: 'g', type: 'group', title: 'Research', y: 900, data: { children: ['b', 'a', 7] } },
          ]),
        ),
      ),
      'group',
    );

    expect(event.created).toEqual([{ id: 'g', title: 'Research', childCount: 2 }]);
    expect(event.updated).toEqual([]);
  });

  test('reports group membership deltas and ignores pure child reordering', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage(
      layoutMessage(
        makeLayout([
          { id: 'g1', type: 'group', title: 'Sprint', data: { children: ['a', 'b'] } },
          { id: 'g2', type: 'group', x: 2000, data: { children: ['c', 'd'] } },
        ]),
      ),
    );

    const event = single(
      reducer.handleMessage(
        layoutMessage(
          makeLayout([
            { id: 'g1', type: 'group', title: 'Sprint', data: { children: ['a', 'c'] } },
            { id: 'g2', type: 'group', x: 2000, data: { children: ['d', 'c'] } },
          ]),
        ),
      ),
      'group',
    );

    expect(event.created).toEqual([]);
    expect(event.updated).toEqual([
      { id: 'g1', title: 'Sprint', addedChildIds: ['c'], removedChildIds: ['b'], childCount: 2 },
    ]);
  });
});

describe('SemanticWatchReducer move-end semantics', () => {
  test('suppresses moves that change neither clusters nor pinned neighborhoods', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage(layoutMessage(makeLayout([{ id: 'a' }, { id: 'b', x: 150 }, { id: 'c', x: 5000, y: 5000 }])));

    // b shifts within its cluster, c drifts while staying isolated: no semantic change.
    const events = reducer.handleMessage(
      layoutMessage(makeLayout([{ id: 'a' }, { id: 'b', x: 170 }, { id: 'c', x: 6000, y: 6000 }])),
    );

    expect(events).toEqual([]);
  });

  test('reports joined cluster and left cluster as a node moves in and out', () => {
    const reducer = new SemanticWatchReducer();
    const withNomadAt = (x: number) => makeLayout([{ id: 'a' }, { id: 'b', x: 150 }, { id: 'c', title: 'Nomad', x }]);
    reducer.handleMessage(layoutMessage(withNomadAt(1000)));

    const joined = single(reducer.handleMessage(layoutMessage(withNomadAt(320))), 'move-end');
    expect(joined.nodes).toEqual([{ id: 'c', title: 'Nomad', nodeType: 'markdown', reasons: ['joined cluster'] }]);

    const left = single(reducer.handleMessage(layoutMessage(withNomadAt(1000))), 'move-end');
    expect(left.nodes).toEqual([{ id: 'c', title: 'Nomad', nodeType: 'markdown', reasons: ['left cluster'] }]);
  });

  test('names the pin when a node enters or leaves its pinned neighborhood', () => {
    const reducer = new SemanticWatchReducer();
    reducer.setInitialPins(['p']);
    const withNotesAt = (x: number) =>
      makeLayout([
        { id: 'p', title: 'Anchor' },
        { id: 'n', title: 'Notes', x },
      ]);
    reducer.handleMessage(layoutMessage(withNotesAt(900)));

    const entered = single(reducer.handleMessage(layoutMessage(withNotesAt(400))), 'move-end');
    expect(entered.nodes).toEqual([
      { id: 'n', title: 'Notes', nodeType: 'markdown', reasons: ['entered pinned neighborhood of "Anchor"'] },
    ]);

    const left = single(reducer.handleMessage(layoutMessage(withNotesAt(900))), 'move-end');
    expect(left.nodes).toEqual([
      { id: 'n', title: 'Notes', nodeType: 'markdown', reasons: ['left pinned neighborhood of "Anchor"'] },
    ]);
  });
});

describe('SemanticWatchReducer attention snapshot', () => {
  test('is empty before any layout arrives, even with pins staged', () => {
    const reducer = new SemanticWatchReducer();
    reducer.setInitialPins(['a']);

    const snapshot = reducer.getAttentionSnapshot();
    expect(snapshot.layout).toBeNull();
    expect(snapshot.spatial).toBeNull();
    expect(snapshot.pinnedNodeIds).toEqual([]);
    expect(snapshot.primaryFocusNodeIds).toEqual([]);
    expect(snapshot.secondaryFocusNodeIds).toEqual([]);
    expect(snapshot.regions).toEqual([]);
  });

  test('exposes pinned primaries, neighborhood secondaries, and a region per pin', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage(
      layoutMessage(
        makeLayout([
          { id: 'pin', title: 'Anchor' },
          { id: 'near', x: 400 },
          { id: 'far', x: 3000, y: 3000 },
        ]),
      ),
    );
    reducer.handleMessage(pinsMessage(['pin']));

    const snapshot = reducer.getAttentionSnapshot();
    expect(snapshot.pinnedNodeIds).toEqual(['pin']);
    expect(snapshot.primaryFocusNodeIds).toEqual(['pin']);
    expect(snapshot.secondaryFocusNodeIds).toEqual(['near']);
    expect(snapshot.regions).toEqual([{ id: 'region-pin', primaryNodeId: 'pin', nodeIds: ['near', 'pin'] }]);
  });

  test('filters stale pinned ids and empties focus once the pinned node is deleted', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage(
      layoutMessage(
        makeLayout([
          { id: 'pin', title: 'Anchor' },
          { id: 'other', x: 3000 },
        ]),
      ),
    );
    reducer.handleMessage(pinsMessage(['pin', 'ghost']));

    const pinned = reducer.getAttentionSnapshot();
    expect(pinned.pinnedNodeIds).toEqual(['pin']);
    // An isolated pin still gets its own single-node region.
    expect(pinned.regions).toEqual([{ id: 'region-pin', primaryNodeId: 'pin', nodeIds: ['pin'] }]);

    reducer.handleMessage(layoutMessage(makeLayout([{ id: 'other', x: 3000 }])));
    const afterDelete = reducer.getAttentionSnapshot();
    expect(afterDelete.pinnedNodeIds).toEqual([]);
    expect(afterDelete.primaryFocusNodeIds).toEqual([]);
    expect(afterDelete.regions).toEqual([]);
  });
});

describe('formatCompactWatchEvent', () => {
  test('formats context-pin events with added counts and removed titles', () => {
    expect(
      formatCompactWatchEvent({
        type: 'context-pin',
        added: [{ id: 'a', title: 'Doc', nodeType: 'markdown' }],
        removed: [{ id: 'b', title: null, nodeType: 'file' }],
      }),
    ).toBe('context-pin +1: "Doc" | removed: "b"');
  });

  test('formats connect events with pluralized counts and id fallback for untitled nodes', () => {
    expect(
      formatCompactWatchEvent({
        type: 'connect',
        edges: [{ id: 'e1', edgeType: 'flow', fromId: 'a', toId: 'b', fromTitle: 'Spec', toTitle: null }],
      }),
    ).toBe('connect 1 edge: "Spec" -> "b" (flow)');

    expect(
      formatCompactWatchEvent({
        type: 'connect',
        edges: [
          { id: 'e1', edgeType: 'flow', fromId: 'a', toId: 'b', fromTitle: 'Spec', toTitle: null },
          { id: 'e2', edgeType: 'relation', fromId: 'b', toId: 'c', fromTitle: null, toTitle: 'C side' },
        ],
      }),
    ).toStartWith('connect 2 edges:');
  });

  test('formats remove and group events with singular and plural counts', () => {
    expect(
      formatCompactWatchEvent({
        type: 'remove',
        nodes: [{ id: 'b', title: 'Impl', nodeType: 'markdown' }],
        edges: [
          { id: 'e1', edgeType: 'flow', fromId: 'a', toId: 'b', fromTitle: null, toTitle: null },
          { id: 'e2', edgeType: 'relation', fromId: 'b', toId: 'c', fromTitle: null, toTitle: null },
        ],
      }),
    ).toBe('remove 1 node: "Impl" | 2 edges');

    expect(
      formatCompactWatchEvent({
        type: 'group',
        created: [{ id: 'g', title: 'Research', childCount: 1 }],
        updated: [{ id: 'h', title: null, addedChildIds: ['x'], removedChildIds: [], childCount: 3 }],
      }),
    ).toBe('group created: "Research" (1 child) | updated: "h" +1 -0 children');
  });

  test('formats move-end events by joining each node reason list', () => {
    expect(
      formatCompactWatchEvent({
        type: 'move-end',
        nodes: [
          {
            id: 'n',
            title: 'Notes',
            nodeType: 'markdown',
            reasons: ['entered pinned neighborhood of "Anchor"', 'joined cluster'],
          },
        ],
      }),
    ).toBe('move-end: "Notes" entered pinned neighborhood of "Anchor"; joined cluster');
  });
});
