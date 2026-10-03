import { expect, test } from 'bun:test';
import { canvasAppContext } from '../../src/shared/canvas-app.js';

test('AX focus shares only existing curated nodes within its own budget', () => {
  const snapshot = {
    boardId: 'board',
    boardName: 'Focus context',
    pinnedNodeIds: ['n0'],
    nodes: Array.from({ length: 25 }, (_, i) => ({
      id: `n${i}`,
      type: 'context',
      title: `Source ${i}`,
      text: `${i}:`.padEnd(800, 'x'),
      contentRevision: i,
    })),
  };
  const context = canvasAppContext(snapshot, ['n1'], ['missing', ...snapshot.nodes.slice(2).map((node) => node.id)]);
  expect(context.focusedNodeIds).toHaveLength(20);
  expect(context.focusedNodeIds).not.toContain('missing');
  expect(context.nodes).toHaveLength(22);
  expect(context.nodes.every((node) => node.text.length === 700)).toBe(true);
  expect(context.nodes.some((node) => node.id === 'n22')).toBe(false);
  expect(canvasAppContext(snapshot, [], []).nodes.map((node) => node.id)).toEqual(['n0']);
});
