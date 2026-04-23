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
