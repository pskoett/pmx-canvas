import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { canvasState } from '../../src/server/canvas-state.ts';
import {
  onFileNodeChanged,
  rewatchAllFileNodes,
  unwatchAll,
  unwatchFileForNode,
  watchFileForNode,
} from '../../src/server/file-watcher.ts';
import {
  createTestWorkspace,
  makeNode,
  removeTestWorkspace,
  resetCanvasForTests,
} from './helpers.ts';

async function waitFor(check: () => boolean, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await Bun.sleep(25);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for file watcher update.`);
}

describe('file watcher', () => {
  let workspaceRoot = '';

  afterEach(() => {
    onFileNodeChanged(() => {});
    unwatchAll();
    if (workspaceRoot) {
      resetCanvasForTests(workspaceRoot);
      removeTestWorkspace(workspaceRoot);
      workspaceRoot = '';
    }
  });

  test('updates watched file nodes and notifies listeners on disk change', async () => {
    workspaceRoot = createTestWorkspace('pmx-canvas-file-watch-');
    resetCanvasForTests(workspaceRoot);

    const filePath = join(workspaceRoot, 'watched.md');
    writeFileSync(filePath, 'line one\nline two', 'utf-8');

    canvasState.addNode(makeNode({
      id: 'file-node',
      type: 'file',
      data: {
        title: 'watched.md',
        path: filePath,
      },
    }));

    const changedNodeIds: string[] = [];
    onFileNodeChanged((nodeId) => {
      changedNodeIds.push(nodeId);
    });

    watchFileForNode('file-node', filePath);
    await Bun.sleep(30);
    writeFileSync(filePath, 'updated\ncontent\nhere', 'utf-8');

    await waitFor(() => String(canvasState.getNode('file-node')?.data.fileContent ?? '') === 'updated\ncontent\nhere');

    const node = canvasState.getNode('file-node');
    expect(node?.data.fileContent).toBe('updated\ncontent\nhere');
    expect(node?.data.lineCount).toBe(3);
    expect(typeof node?.data.updatedAt).toBe('string');
    expect(changedNodeIds).toContain('file-node');
  });

  test('unwatchFileForNode stops updates for removed node subscriptions', async () => {
    workspaceRoot = createTestWorkspace('pmx-canvas-file-unwatch-');
    resetCanvasForTests(workspaceRoot);

    const filePath = join(workspaceRoot, 'shared.md');
    writeFileSync(filePath, 'shared v1', 'utf-8');

    canvasState.addNode(makeNode({ id: 'file-a', type: 'file', data: { path: filePath } }));
    canvasState.addNode(makeNode({ id: 'file-b', type: 'file', data: { path: filePath } }));

    watchFileForNode('file-a', filePath);
    watchFileForNode('file-b', filePath);
    unwatchFileForNode('file-a', filePath);

    await Bun.sleep(30);
    writeFileSync(filePath, 'shared v2', 'utf-8');

    await waitFor(() => String(canvasState.getNode('file-b')?.data.fileContent ?? '') === 'shared v2');

    expect(canvasState.getNode('file-a')?.data.fileContent).toBeUndefined();
    expect(canvasState.getNode('file-b')?.data.fileContent).toBe('shared v2');
  });

  test('rewatchAllFileNodes reattaches watchers for file nodes already in canvas state', async () => {
    workspaceRoot = createTestWorkspace('pmx-canvas-file-rewatch-');
    resetCanvasForTests(workspaceRoot);

    const filePath = join(workspaceRoot, 'rewatch.md');
    writeFileSync(filePath, 'before', 'utf-8');

    canvasState.addNode(makeNode({
      id: 'rewatch-node',
      type: 'file',
      data: {
        title: 'rewatch.md',
        path: filePath,
      },
    }));

    rewatchAllFileNodes();

    await Bun.sleep(30);
    writeFileSync(filePath, 'after rewatch', 'utf-8');

    await waitFor(() => String(canvasState.getNode('rewatch-node')?.data.fileContent ?? '') === 'after rewatch');
    expect(canvasState.getNode('rewatch-node')?.data.lineCount).toBe(1);
  });
});
