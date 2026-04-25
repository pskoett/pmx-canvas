import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'bun:test';
import { serializeCanvasNode } from '../../src/server/canvas-serialization.ts';
import { makeNode } from './helpers.ts';

describe('canvas node provenance', () => {
  test('serializes normalized provenance for source-backed nodes', () => {
    const filePath = '/tmp/plan.md';
    const artifactPath = '/tmp/artifacts/dashboard.html';

    const fileNode = serializeCanvasNode(makeNode({
      id: 'file-1',
      type: 'file',
      data: {
        path: filePath,
        title: 'Plan',
        provenance: {
          sourceKind: 'workspace-file',
          sourceUri: 'file:///stale.md',
          refreshStrategy: 'file-watch',
          snapshotContent: true,
          details: { label: 'Keep me' },
        },
      },
    }));

    expect(fileNode.provenance).toEqual({
      sourceKind: 'workspace-file',
      sourceUri: pathToFileURL(filePath).toString(),
      refreshStrategy: 'file-watch',
      snapshotContent: true,
      details: {
        label: 'Keep me',
        path: filePath,
        nodeType: 'file',
      },
    });
    expect(fileNode.data.provenance).toEqual(fileNode.provenance);

    const webpageNode = serializeCanvasNode(makeNode({
      id: 'web-1',
      type: 'webpage',
      data: {
        title: 'Docs',
        url: 'https://example.com/docs',
        pageTitle: 'Example docs',
        fetchedAt: '2026-04-22T09:00:00.000Z',
      },
    }));

    expect(webpageNode.provenance).toEqual({
      sourceKind: 'webpage-url',
      sourceUri: 'https://example.com/docs',
      refreshStrategy: 'webpage-refresh',
      snapshotContent: true,
      syncedAt: '2026-04-22T09:00:00.000Z',
      details: {
        url: 'https://example.com/docs',
        pageTitle: 'Example docs',
        nodeType: 'webpage',
      },
    });

    const artifactNode = serializeCanvasNode(makeNode({
      id: 'app-1',
      type: 'mcp-app',
      data: {
        title: 'Artifact',
        path: artifactPath,
        url: `/artifact?path=${encodeURIComponent(artifactPath)}`,
        sourceServer: 'pmx-canvas',
      },
    }));

    expect(artifactNode.provenance).toEqual({
      sourceKind: 'artifact-file',
      sourceUri: pathToFileURL(artifactPath).toString(),
      refreshStrategy: 'artifact-reopen',
      snapshotContent: true,
      details: {
        path: artifactPath,
        url: `/artifact?path=${encodeURIComponent(artifactPath)}`,
        nodeType: 'mcp-app',
      },
    });
  });
});

describe('canvas node kind discriminator', () => {
  test('classifies fresh web-artifact nodes via viewerType', () => {
    const fresh = serializeCanvasNode(makeNode({
      id: 'wa-fresh',
      type: 'mcp-app',
      data: {
        title: 'Dashboard',
        viewerType: 'web-artifact',
        hostMode: 'hosted',
        path: '/tmp/dashboard.html',
      },
    }));
    expect(fresh.kind).toBe('web-artifact');
  });

  test('classifies future URL-only web-artifact nodes via viewerType alone', () => {
    // Forward-compat: a web-artifact rendered from a URL (no `data.path`)
    // must still classify as web-artifact rather than falling through to
    // the legacy hostMode+path heuristic.
    const urlOnly = serializeCanvasNode(makeNode({
      id: 'wa-url',
      type: 'mcp-app',
      data: {
        title: 'Hosted artifact',
        viewerType: 'web-artifact',
        hostMode: 'hosted',
        url: 'https://example.com/dashboard.html',
      },
    }));
    expect(urlOnly.kind).toBe('web-artifact');
  });

  test('classifies legacy v0.1.3 web-artifact nodes via hostMode+path fallback', () => {
    // Backwards-compat: state.json files persisted before v0.1.4 introduced
    // `viewerType` still need to round-trip. Older web-artifacts always
    // stored a `path`, so this heuristic safely covers existing data.
    const legacy = serializeCanvasNode(makeNode({
      id: 'wa-legacy',
      type: 'mcp-app',
      data: {
        title: 'Legacy artifact',
        hostMode: 'hosted',
        path: '/tmp/legacy.html',
      },
    }));
    expect(legacy.kind).toBe('web-artifact');
  });

  test('classifies external-app nodes by mode', () => {
    const extApp = serializeCanvasNode(makeNode({
      id: 'ea-1',
      type: 'mcp-app',
      data: {
        title: 'Excalidraw',
        mode: 'ext-app',
        toolCallId: 'abc',
      },
    }));
    expect(extApp.kind).toBe('external-app');
  });

  test('falls back to "mcp-app" for plain MCP-app nodes', () => {
    const plain = serializeCanvasNode(makeNode({
      id: 'mcp-1',
      type: 'mcp-app',
      data: { title: 'Generic mcp-app' },
    }));
    expect(plain.kind).toBe('mcp-app');
  });

  test('passes through every non-mcp-app type as its own kind', () => {
    for (const type of ['markdown', 'status', 'file', 'image', 'webpage', 'graph', 'group'] as const) {
      const node = serializeCanvasNode(makeNode({ id: `n-${type}`, type, data: { title: type } }));
      expect(node.kind).toBe(type);
    }
  });
});
