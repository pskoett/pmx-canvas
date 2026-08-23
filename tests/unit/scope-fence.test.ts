import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { canvasState } from '../../src/server/canvas-state.ts';
import { createCanvas } from '../../src/server/index.ts';
import { getOperation } from '../../src/server/operations/index.ts';
import { checkScopeFence, checkScopeOwnership, scopeFenceRect } from '../../src/server/scope-fence.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

// Design item 4: the human grants a region; agent WRITES outside it are refused,
// reads are never fenced. Safe default: an unknown write is refused, and so is
// any write this module cannot resolve (fail closed, never a bypass).

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
    expect(check('edge.add', { from: 'in-a', to: 'out' })).toMatch(/node "out" is outside/);
    expect(check('group.create', { childIds: ['in-a', 'out'] })).toMatch(/node "out" is outside/);
  });

  test('search-resolved edge endpoints cannot be checked before resolution — refused, not bypassed', () => {
    canvasState.setPolicy({ scope: { nodeIds: ['in-a', 'in-b'] } });
    expect(check('edge.add', { fromSearch: 'in-a', to: 'in-b' })).toMatch(/node "" is outside/);
  });

  test('removing an edge is fenced by its endpoints', () => {
    canvasState.addEdge({ id: 'e-in', from: 'in-a', to: 'in-b', type: 'flow' });
    canvasState.addEdge({ id: 'e-out', from: 'in-a', to: 'out', type: 'flow' });
    canvasState.setPolicy({ scope: { nodeIds: ['in-a', 'in-b'] } });
    expect(check('edge.remove', { id: 'e-in' })).toBeNull();
    expect(check('edge.remove', { id: 'e-out' })).toMatch(/node "out" is outside/);
    expect(check('edge.remove', { id: 'missing' })).toBeNull(); // 404s on its own
  });

  test('group membership is a write to the children: node.add / node.update carry them', () => {
    canvasState.setPolicy({ scope: { nodeIds: ['in-a', 'in-b'], padding: 40 } });
    expect(check('node.add', { type: 'group', x: 120, y: 120, children: ['in-a'] })).toBeNull();
    expect(check('node.add', { type: 'group', x: 120, y: 120, children: ['out'] })).toMatch(/node "out" is outside/);
    expect(check('node.add', { type: 'group', x: 120, y: 120, childIds: ['out'] })).toMatch(/node "out" is outside/);
    expect(check('node.add', { type: 'group', x: 120, y: 120, data: { children: ['out'] } })).toMatch(
      /node "out" is outside/,
    );
    expect(check('node.update', { id: 'in-a', children: ['out'] })).toMatch(/node "out" is outside/);
    expect(check('node.update', { id: 'in-a', data: { children: ['in-b'] } })).toBeNull();
  });

  test('jsonrender.stream appends to an existing node by nodeId, else creates at x/y', () => {
    canvasState.setPolicy({ scope: { nodeIds: ['in-a', 'in-b'], padding: 40 } });
    expect(check('jsonrender.stream', { nodeId: 'in-a', chunk: '{}' })).toBeNull();
    expect(check('jsonrender.stream', { nodeId: 'out', chunk: '{}' })).toMatch(/node "out" is outside/);
    expect(check('jsonrender.stream', { chunk: '{}', x: 300, y: 120 })).toBeNull();
    expect(check('jsonrender.stream', { chunk: '{}', x: 3000, y: 120 })).toMatch(/position \(3000, 120\)/);
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
    ).toMatch(/position \(900, 150\)/);
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

  test('the fence belongs to the human: an agent policy patch that touches scope is refused', () => {
    expect(checkScopeOwnership({ tools: { excluded: ['shell'] } })).toBeNull();
    expect(checkScopeOwnership({ scope: { nodeIds: ['in-a'] } })).toMatch(/set and cleared by the human/);
    expect(checkScopeOwnership({ scope: null })).toMatch(/set and cleared by the human/);
  });
});

describe('scope fence in the SDK', () => {
  // SDK methods bypass the operation registry and describe their own targets.
  test('fenced writes throw, reads and in-fence writes work', () => {
    const canvas = createCanvas({ port: 4790 });
    canvasState.setPolicy({ scope: { nodeIds: ['in-a', 'in-b'], padding: 40 } });

    expect(() => canvas.updateNode('out', { title: 'x' })).toThrow(/Outside the agent scope: node "out"/);
    expect(() => canvas.removeNode('out')).toThrow(/Outside the agent scope/);
    expect(() => canvas.addNode({ type: 'markdown', title: 'far', x: 3000, y: 3000 })).toThrow(
      /position \(3000, 3000\) is outside/,
    );
    expect(() => canvas.addNode({ type: 'markdown', title: 'unplaced' })).toThrow(/need an explicit x\/y/);
    expect(() => canvas.addEdge({ from: 'in-a', to: 'out', type: 'flow' })).toThrow(/node "out" is outside/);
    expect(() => canvas.createGroup({ title: 'g', childIds: ['out'] })).toThrow(/node "out" is outside/);
    expect(() => canvas.arrange('grid')).toThrow(/rewrites the whole board/);
    expect(() => canvas.clear()).toThrow(/rewrites the whole board/);

    canvas.updateNode('in-a', { title: 'renamed' });
    expect(canvas.getNode('in-a')?.data.title).toBe('renamed');
    expect(canvas.getNode('out')?.data.title).toBe('out');
    const near = canvas.addNode({ type: 'markdown', title: 'near', x: 300, y: 120 });
    expect(canvas.getNode(near.id)).toBeDefined();
  });
});
