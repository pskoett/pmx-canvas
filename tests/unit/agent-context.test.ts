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
      viewerType: 'web-artifact',
      hostMode: 'hosted',
      content: 'Web artifact: Canvas comparison artifact\nApp source preview:\nexport default function App() { return <main>Compare old and new canvas states</main>; }',
      sourceFiles: ['src/App.tsx', 'src/index.css'],
      sourceFileCount: 2,
      artifactBytes: 12345,
      path: '/tmp/canvas-comparison.html',
      url: '/artifact?path=%2Ftmp%2Fcanvas-comparison.html',
    });

    const serialized = serializeNodeForAgentContext(node, { includePosition: true });
    expect(serialized.type).toBe('mcp-app');
    expect(serialized.kind).toBe('web-artifact');
    expect(serialized.title).toBe('Canvas comparison artifact');
    expect(serialized.content).toContain('Web artifact: Canvas comparison artifact');
    expect(serialized.content).toContain('Compare old and new canvas states');
    expect(serialized.content).toContain('Path: /tmp/canvas-comparison.html');
    expect(serialized.content).not.toContain('<!DOCTYPE html>');
    expect(serialized.metadata).toEqual(expect.objectContaining({
      path: '/tmp/canvas-comparison.html',
      url: '/artifact?path=%2Ftmp%2Fcanvas-comparison.html',
      hostMode: 'hosted',
      viewerType: 'web-artifact',
      sourceFiles: ['src/App.tsx', 'src/index.css'],
      sourceFileCount: 2,
      artifactBytes: 12345,
    }));
    expect(serialized.position).toEqual({ x: 120, y: 80 });
  });

  test('serializes external app kind for pinned context consumers', () => {
    const node = makeNode({
      title: 'Excalidraw app',
      mode: 'ext-app',
      serverName: 'Excalidraw',
      toolName: 'create_view',
      resourceUri: 'ui://excalidraw/app.html',
    });

    const serialized = serializeNodeForAgentContext(node);
    expect(serialized.type).toBe('mcp-app');
    expect(serialized.kind).toBe('external-app');
  });
});
