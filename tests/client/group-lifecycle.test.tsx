import { afterEach, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { CanvasNode } from '../../src/client/canvas/CanvasNode.tsx';
import { activeBoardId } from '../../src/client/state/boards-store.ts';
import { nodes } from '../../src/client/state/canvas-store.ts';
import { knowledge, lifecycleTarget } from '../../src/client/state/knowledge-store.ts';
import { workspaceSettings } from '../../src/client/state/workspace-settings.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';
import { memoryKey } from '../../src/shared/memory-graph.ts';

afterEach(() => {
  cleanup();
  knowledge.value = null;
  lifecycleTarget.value = null;
  workspaceSettings.value = null;
  activeBoardId.value = null;
  nodes.value = new Map();
});

for (const sourceWarning of [false, true]) {
  test(`group ${sourceWarning ? 'source warning' : 'explicit review due'} is frame chrome, not body content`, () => {
    activeBoardId.value = 'board';
    workspaceSettings.value = { agentSessions: false, knowledgeLifecycle: true };
    const node: CanvasNodeState = {
      id: 'group',
      type: 'group',
      position: { x: 60, y: 100 },
      size: { width: 1160, height: 320 },
      zIndex: 0,
      collapsed: false,
      pinned: false,
      data: { title: 'Research', children: ['child'] },
    };
    nodes.value = new Map([[node.id, node]]);
    knowledge.value = {
      ok: true,
      categories: [],
      folders: [],
      relationPresets: [],
      reviewCards: [],
      resolvedFolders: {},
      cards: {
        [memoryKey({ boardId: 'board', cardId: node.id })]: {
          retired: false,
          unknown: false,
          due: !sourceWarning,
          reasons: ['No evidence-backed validation'],
          changedSinceRead: false,
          lastReadAt: null,
          lastValidatedAt: null,
          contentRevision: 1,
          contentChangedAt: null,
          observations: {},
          relevance: 'not-selected',
          sources: sourceWarning
            ? [{ boardId: 'board', cardId: 'source', title: 'Source', reasons: ['Source changed'] }]
            : [],
        },
      },
    };
    const { container, getByRole } = render(<CanvasNode node={node}>{null}</CanvasNode>);
    const footer = getByRole('button', { name: sourceWarning ? /source needs review/ : /review due/ });
    // A populated group's renderer returns null. Inserting the footer into its
    // body made it the first child and the content flex rule stretched it over
    // the children. Keep the action in the frame's bottom chrome instead.
    expect(container.querySelector('.node-body')?.contains(footer)).toBe(false);
    expect(footer.closest('.group-node')).not.toBeNull();
    fireEvent.click(footer);
    expect(lifecycleTarget.value?.nodeId).toBe(node.id);
    expect(lifecycleTarget.value?.boardId).toBe('board');
  });
}
