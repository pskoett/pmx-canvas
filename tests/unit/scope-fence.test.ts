import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { canvasState } from '../../src/server/canvas-state.ts';
import { getOperation } from '../../src/server/operations/index.ts';
import { checkScopeFence, scopeFenceRect } from '../../src/server/scope-fence.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

// Design item 4: the human grants a region; agent WRITES outside it are refused,
// reads are never fenced. Safe default: an unknown write is refused.

let workspaceRoot = '';

function addNode(id: string, x: number, y: number): void {
  canvasState.addNode({
    id,
    type: 'markdown',
    position: { x, y },
    size: { width: 200, height: 100 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data: { title: id },
  });
}

const check = (name: string, input: unknown) => checkScopeFence(getOperation(name), input);

beforeEach(() => {
  workspaceRoot = createTestWorkspace('pmx-fence-');
  resetCanvasForTests(workspaceRoot);
  addNode('in-a', 100, 100);
  addNode('in-b', 400, 100);
  addNode('out', 2000, 2000);
});

afterEach(() => {
  resetCanvasForTests(workspaceRoot);
  removeTestWorkspace(workspaceRoot);
});

describe('scope fence', () => {
  test('no fence → nothing is checked', () => {
    expect(check('node.update', { id: 'out' })).toBeNull();
    expect(check('arrange', {})).toBeNull();
  });

  test("the fence rect is the fenced nodes' bounding box plus padding", () => {
    canvasState.setPolicy({ scope: { nodeIds: ['in-a', 'in-b'], padding: 40 } });
    expect(scopeFenceRect(canvasState.getPolicy().scope!)).toEqual({ x: 60, y: 60, width: 580, height: 180 });
  });

  test('existing-node writes: fenced ids pass, others are refused with a reason that names the node', () => {
    canvasState.setPolicy({ scope: { nodeIds: ['in-a', 'in-b'] } });
    expect(check('node.update', { id: 'in-a', title: 'x' })).toBeNull();
    expect(check('node.remove', { id: 'in-b' })).toBeNull();
    expect(check('node.update', { id: 'out', title: 'x' })).toMatch(
      /node "out" is outside the agent scope fence \(2 nodes\)/,
    );
    expect(check('edge.add', { from: 'in-a', to: 'in-b' })).toBeNull();
    expect(check('edge.add', { from: 'in-a', to: 'out' })).toMatch(/edge endpoint "out"/);
    expect(check('group.create', { childIds: ['in-a', 'out'] })).toMatch(/group child "out"/);
  });

  test('new nodes must land inside the fence rect, and must say where', () => {
    canvasState.setPolicy({ scope: { nodeIds: ['in-a', 'in-b'], padding: 40 } });
    expect(check('node.add', { type: 'markdown', x: 300, y: 120 })).toBeNull();
    expect(check('node.add', { type: 'markdown', x: 1500, y: 120 })).toMatch(/position \(1500, 120\) is outside/);
    expect(check('node.add', { type: 'markdown' })).toMatch(/need an explicit x\/y/);
    expect(
      check('annotation.add', {
        points: [
          { x: 120, y: 120 },
          { x: 200, y: 150 },
        ],
      }),
    ).toBeNull();
    expect(
      check('annotation.add', {
        points: [
          { x: 120, y: 120 },
          { x: 900, y: 150 },
        ],
      }),
    ).toMatch(/annotation point \(900, 150\)/);
  });

  test('board-wide and unknown writes are refused; navigation passes', () => {
    canvasState.setPolicy({ scope: { nodeIds: ['in-a'] } });
    expect(check('arrange', {})).toMatch(/rewrites the whole board/);
    expect(check('canvas.clear', {})).toMatch(/rewrites the whole board/);
    expect(check('node.focus', { id: 'out' })).toBeNull();
  });

  test('a fence whose nodes were all removed still blocks creates (no rect to place near)', () => {
    canvasState.setPolicy({ scope: { nodeIds: ['in-a'] } });
    canvasState.removeNode('in-a');
    expect(check('node.add', { type: 'markdown', x: 100, y: 100 })).toMatch(/no fenced node exists/);
  });

  test('setPolicy drops unknown node ids from the fence and null clears it', () => {
    canvasState.setPolicy({ scope: { nodeIds: ['in-a', 'ghost-node'] } });
    expect(canvasState.getPolicy().scope).toEqual({ nodeIds: ['in-a'], padding: 40 });
    canvasState.setPolicy({ scope: null });
    expect(canvasState.getPolicy().scope).toBeNull();
  });
});
