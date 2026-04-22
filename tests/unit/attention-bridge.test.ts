import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { resetAttentionBridge, syncAttentionFromSse } from '../../src/client/state/attention-bridge.ts';
import {
  attentionHistory,
  attentionHistoryOpen,
  attentionHistoryUnread,
  attentionPrimaryNodeIds,
  attentionRegions,
  attentionSecondaryNodeIds,
  attentionToast,
} from '../../src/client/state/attention-store.ts';
import { makeNode } from './helpers.ts';

function makeLayout(
  nodes: Parameters<typeof makeNode>[0][],
  edges: Array<{
    id: string;
    from: string;
    to: string;
    type: 'relation' | 'depends-on' | 'flow' | 'references';
  }> = [],
) {
  return {
    viewport: { x: 0, y: 0, scale: 1 },
    nodes: nodes.map((node) => makeNode(node)),
    edges: edges.map((edge) => ({ ...edge })),
  };
}

describe('attention bridge', () => {
  beforeEach(() => {
    resetAttentionBridge();
  });

  afterEach(() => {
    resetAttentionBridge();
  });

  test('emits context feedback and focus state from server pin changes', () => {
    syncAttentionFromSse({
      event: 'canvas-layout-update',
      data: {
        layout: makeLayout([
          { id: 'a', type: 'markdown', data: { title: 'Bug report' } },
          { id: 'b', type: 'file', data: { title: 'auth.ts' }, position: { x: 860, y: 80 } },
        ]),
        timestamp: '2026-04-18T10:00:00.000Z',
      },
    });

    syncAttentionFromSse({
      event: 'context-pins-changed',
      data: {
        nodeIds: ['a'],
        count: 1,
        timestamp: '2026-04-18T10:00:01.000Z',
      },
    });

    expect(Array.from(attentionPrimaryNodeIds.value)).toEqual(['a']);
    expect(Array.from(attentionSecondaryNodeIds.value)).toEqual([]);
    expect(attentionRegions.value).toHaveLength(1);
    expect(attentionToast.value?.title).toBe('Context updated');
    expect(attentionToast.value?.detail).toContain('Bug report');
    expect(attentionHistory.value[0]?.title).toBe('Context updated');
    expect(attentionHistoryOpen.value).toBe(false);
    expect(attentionHistoryUnread.value).toBe(1);
  });

  test('promotes nearby nodes into the focus field when neighborhood semantics change', () => {
    syncAttentionFromSse({
      event: 'canvas-layout-update',
      data: {
        layout: makeLayout([
          { id: 'a', type: 'markdown', data: { title: 'Bug report' }, position: { x: 0, y: 0 } },
          { id: 'b', type: 'file', data: { title: 'auth.ts' }, position: { x: 1100, y: 0 } },
        ]),
        timestamp: '2026-04-18T10:01:00.000Z',
      },
    });

    syncAttentionFromSse({
      event: 'context-pins-changed',
      data: {
        nodeIds: ['a'],
        count: 1,
        timestamp: '2026-04-18T10:01:01.000Z',
      },
    });

    syncAttentionFromSse({
      event: 'canvas-layout-update',
      data: {
        layout: makeLayout([
          { id: 'a', type: 'markdown', data: { title: 'Bug report' }, position: { x: 0, y: 0 } },
          { id: 'b', type: 'file', data: { title: 'auth.ts' }, position: { x: 220, y: 10 } },
        ]),
        timestamp: '2026-04-18T10:01:02.000Z',
      },
    });

    expect(Array.from(attentionPrimaryNodeIds.value)).toEqual(['a']);
    expect(Array.from(attentionSecondaryNodeIds.value)).toEqual(['b']);
    expect(attentionRegions.value[0]?.nodeIds).toEqual(['a', 'b']);
    expect(attentionHistory.value[0]?.title).toBe('Neighborhood changed');
    expect(attentionHistory.value[0]?.detail).toContain('auth.ts');
  });
});
