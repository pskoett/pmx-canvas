import { describe, expect, test } from 'bun:test';
import { serializeNodeForAgentContext, summarizeNodeForAgentContext } from '../../src/server/agent-context.ts';
import type { CanvasNodeState } from '../../src/server/canvas-state.ts';

function makeNode(data: Record<string, unknown>): CanvasNodeState {
  return {
    id: 'node-1',
    type: 'mcp-app',
    position: { x: 120, y: 80 },
    size: { width: 720, height: 500 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data,
  };
}

describe('agent-context mcp-app summaries', () => {
  test('summarizes ext-app nodes with source and diagram hints', () => {
    const node = makeNode({
      title: 'Excalidraw - collaboration flow',
      mode: 'ext-app',
      hostMode: 'hosted',
      serverName: 'excalidraw',
      toolName: 'open_diagram',
      resourceUri: 'ui://excalidraw/app.html',
      sessionStatus: 'ready',
      toolInput: {
        elements: [{ type: 'rectangle' }, { type: 'arrow' }, { type: 'text' }],
      },
    });

    const summary = summarizeNodeForAgentContext(node);
    expect(summary).toContain('App: Excalidraw - collaboration flow');
    expect(summary).toContain('Source: excalidraw / open_diagram');
    expect(summary).toContain('Diagram elements: 3');
    expect(summary).toContain('Session: ready');
  });

  test('serializes web artifact metadata for pinned context consumers', () => {
    const node = makeNode({
      title: 'Canvas comparison artifact',
      hostMode: 'hosted',
      path: '/tmp/canvas-comparison.html',
      url: '/artifact?path=%2Ftmp%2Fcanvas-comparison.html',
    });

    const serialized = serializeNodeForAgentContext(node, { includePosition: true });
    expect(serialized.title).toBe('Canvas comparison artifact');
    expect(serialized.content).toContain('Path: /tmp/canvas-comparison.html');
    expect(serialized.metadata).toEqual(expect.objectContaining({
      path: '/tmp/canvas-comparison.html',
      url: '/artifact?path=%2Ftmp%2Fcanvas-comparison.html',
      hostMode: 'hosted',
    }));
    expect(serialized.position).toEqual({ x: 120, y: 80 });
  });
});
