import { afterEach, describe, expect, test } from 'bun:test';
import { buildSnapCache, clearSnapCache, snapToGuides } from '../../src/client/canvas/snap-guides.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

function makeNode(id: string, overrides: Partial<CanvasNodeState> = {}): CanvasNodeState {
  return {
    id,
    type: overrides.type ?? 'markdown',
    position: overrides.position ?? { x: 0, y: 0 },
    size: overrides.size ?? { width: 320, height: 180 },
    zIndex: overrides.zIndex ?? 1,
    collapsed: overrides.collapsed ?? false,
    pinned: overrides.pinned ?? false,
    dockPosition: overrides.dockPosition ?? null,
    data: overrides.data ?? {},
  };
}

describe('snap guides', () => {
  afterEach(() => {
    clearSnapCache();
  });

  test('group drags ignore descendant nodes when building snap references', () => {
    const group = makeNode('group-1', {
      type: 'group',
      position: { x: 280, y: 148 },
      size: { width: 840, height: 312 },
      data: { children: ['child-1'] },
    });
    const child = makeNode('child-1', {
      position: { x: 320, y: 220 },
      data: { parentGroup: 'group-1' },
    });
    const unrelated = makeNode('other-1', {
      position: { x: 1180, y: 220 },
      size: { width: 320, height: 180 },
    });

    buildSnapCache(group.id, [group, child, unrelated]);

    expect(snapToGuides(316, 148, group.size.width, group.size.height).x).toBe(316);
    expect(snapToGuides(1176, 148, group.size.width, group.size.height).x).toBe(1180);
  });

  test('child drags ignore ancestor group frames when building snap references', () => {
    const group = makeNode('group-1', {
      type: 'group',
      position: { x: 280, y: 148 },
      size: { width: 840, height: 312 },
      data: { children: ['child-1'] },
    });
    const child = makeNode('child-1', {
      position: { x: 320, y: 220 },
      data: { parentGroup: 'group-1' },
    });
    const unrelated = makeNode('other-1', {
      position: { x: 720, y: 220 },
      size: { width: 320, height: 180 },
    });

    buildSnapCache(child.id, [group, child, unrelated]);

    expect(snapToGuides(284, 220, child.size.width, child.size.height).x).toBe(284);
    expect(snapToGuides(716, 220, child.size.width, child.size.height).x).toBe(720);
  });
});
