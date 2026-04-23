import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canvasState } from '../../src/server/canvas-state.ts';
import {
  buildCodeGraphSummary,
  formatCodeGraph,
  parseImports,
  recomputeCodeGraph,
} from '../../src/server/code-graph.ts';
import {
  createTestWorkspace,
  makeNode,
  removeTestWorkspace,
  resetCanvasForTests,
} from './helpers.ts';

describe('code graph', () => {
  let workspaceRoot = '';
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
    if (workspaceRoot) {
      resetCanvasForTests(workspaceRoot);
      removeTestWorkspace(workspaceRoot);
      workspaceRoot = '';
    }
  });

  test('parseImports handles JS/TS, Python, Go, and Rust sources with deduplication', () => {
    expect(parseImports(`
      import foo from './foo';
      export { bar } from "./bar";
      import "./side-effect";
      const baz = require('./baz');
      await import('./lazy');
      import fooAgain from './foo';
    `, '/tmp/example.ts')).toEqual(['./foo', './bar', './side-effect', './lazy', './baz']);

    expect(parseImports('import os\nfrom pkg.module import thing\nimport os\n', '/tmp/example.py')).toEqual(['os', 'pkg.module']);

    expect(parseImports(`
      import "fmt"
      import (
        "net/http"
        "example/internal/app"
      )
    `, '/tmp/example.go')).toEqual(['fmt', 'net/http', 'example/internal/app']);

    expect(parseImports('mod parser;\nuse crate::graph::node;\nmod parser;\n', '/tmp/example.rs')).toEqual(['parser', 'graph::node;']);
  });

  test('recomputeCodeGraph resolves imports, skips self and packages, and removes stale auto edges', () => {
    workspaceRoot = createTestWorkspace('pmx-canvas-codegraph-');
    resetCanvasForTests(workspaceRoot);
    const srcDir = join(workspaceRoot, 'src');
    mkdirSync(srcDir, { recursive: true });

    const appPath = join(srcDir, 'app.ts');
    const utilPath = join(srcDir, 'util.ts');
    const helperPath = join(srcDir, 'helper.ts');
    const isolatedPath = join(srcDir, 'isolated.py');

    writeFileSync(appPath, `
      import util from './util.js';
      import helper from './helper';
      import 'react';
      import './app';
      import utilAgain from './util.js';
    `, 'utf-8');
    writeFileSync(utilPath, 'export const util = true;\n', 'utf-8');
    writeFileSync(helperPath, 'export const helper = true;\n', 'utf-8');
    writeFileSync(isolatedPath, 'print("isolated")\n', 'utf-8');

    canvasState.addNode(makeNode({
      id: 'app-node',
      type: 'file',
      data: { title: 'app.ts', path: appPath, fileContent: read(appPath) },
    }));
    canvasState.addNode(makeNode({
      id: 'util-node',
      type: 'file',
      data: { title: 'util.ts', path: utilPath, fileContent: read(utilPath) },
    }));
    canvasState.addNode(makeNode({
      id: 'helper-node',
      type: 'file',
      data: { title: 'helper.ts', path: helperPath, fileContent: read(helperPath) },
    }));
    canvasState.addNode(makeNode({
      id: 'isolated-node',
      type: 'file',
      data: { title: 'isolated.py', path: isolatedPath, fileContent: read(isolatedPath) },
    }));

    const firstPass = recomputeCodeGraph();
    expect(firstPass).toEqual([
      {
        fromNodeId: 'app-node',
        toNodeId: 'util-node',
        fromPath: appPath,
        toPath: utilPath,
        importSpecifier: './util.js',
      },
      {
        fromNodeId: 'app-node',
        toNodeId: 'helper-node',
        fromPath: appPath,
        toPath: helperPath,
        importSpecifier: './helper',
      },
    ]);

    const autoEdges = canvasState.getEdges().filter((edge) => edge.id.startsWith('codegraph-'));
    expect(autoEdges).toHaveLength(2);
    expect(autoEdges.every((edge) => edge.type === 'depends-on' && edge.style === 'dashed')).toBe(true);

    canvasState.updateNode('app-node', {
      data: {
        title: 'app.ts',
        path: appPath,
        fileContent: `import helper from './helper';`,
      },
    });

    const secondPass = recomputeCodeGraph();
    expect(secondPass).toEqual([
      {
        fromNodeId: 'app-node',
        toNodeId: 'helper-node',
        fromPath: appPath,
        toPath: helperPath,
        importSpecifier: './helper',
      },
    ]);

    const updatedAutoEdges = canvasState.getEdges().filter((edge) => edge.id.startsWith('codegraph-'));
    expect(updatedAutoEdges).toHaveLength(1);
    expect(updatedAutoEdges[0]?.from).toBe('app-node');
    expect(updatedAutoEdges[0]?.to).toBe('helper-node');
  });

  test('buildCodeGraphSummary and formatCodeGraph describe central and isolated files', () => {
    workspaceRoot = createTestWorkspace('pmx-canvas-codegraph-summary-');
    resetCanvasForTests(workspaceRoot);
    const srcDir = join(workspaceRoot, 'src');
    mkdirSync(srcDir, { recursive: true });

    const appPath = join(srcDir, 'app.ts');
    const featurePath = join(srcDir, 'feature.ts');
    const utilPath = join(srcDir, 'util.ts');
    const lonePath = join(srcDir, 'lone.ts');

    writeFileSync(appPath, `import './util';\n`, 'utf-8');
    writeFileSync(featurePath, `import './util';\n`, 'utf-8');
    writeFileSync(utilPath, 'export const util = true;\n', 'utf-8');
    writeFileSync(lonePath, 'export const lone = true;\n', 'utf-8');

    canvasState.addNode(makeNode({ id: 'app', type: 'file', data: { title: 'App', path: appPath, fileContent: read(appPath) } }));
    canvasState.addNode(makeNode({ id: 'feature', type: 'file', data: { title: 'Feature', path: featurePath, fileContent: read(featurePath) } }));
    canvasState.addNode(makeNode({ id: 'util', type: 'file', data: { title: 'Util', path: utilPath, fileContent: read(utilPath) } }));
    canvasState.addNode(makeNode({ id: 'lone', type: 'file', data: { title: 'Lone', path: lonePath, fileContent: read(lonePath) } }));

    recomputeCodeGraph();
    const summary = buildCodeGraphSummary();

    expect(summary.totalFileNodes).toBe(4);
    expect(summary.totalAutoEdges).toBe(2);
    expect(summary.centralFiles[0]?.title).toBe('Util');
    expect(summary.centralFiles[0]?.inDegree).toBe(2);
    expect(summary.centralFiles[0]?.path.endsWith('/src/util.ts') || summary.centralFiles[0]?.path === 'src/util.ts').toBe(true);
    expect(summary.isolatedFiles).toHaveLength(1);
    expect(summary.isolatedFiles[0]?.title).toBe('Lone');
    expect(summary.isolatedFiles[0]?.path.endsWith('/src/lone.ts') || summary.isolatedFiles[0]?.path === 'src/lone.ts').toBe(true);

    const appNode = summary.nodes.find((node) => node.id === 'app');
    expect(appNode?.imports).toEqual(['./util']);
    expect(appNode?.outDegree).toBe(1);

    const utilNode = summary.nodes.find((node) => node.id === 'util');
    expect(utilNode?.importedBy).toHaveLength(2);
    expect(utilNode?.importedBy.every((path) => path.endsWith('/src/app.ts') || path.endsWith('/src/feature.ts') || path === 'src/app.ts' || path === 'src/feature.ts')).toBe(true);
    expect(utilNode?.inDegree).toBe(2);

    const text = formatCodeGraph(summary);
    expect(text).toContain('Code Graph: 4 files, 2 dependency edges');
    expect(text).toContain('Central files (most depended on):');
    expect(text).toContain('Util — imported by 2 file(s)');
    expect(text).toContain('Isolated files (1): Lone');
    expect(text).toContain('imports: ./util');
    expect(text).toContain('app.ts');
    expect(text).toContain('feature.ts');
  });

  test('formatCodeGraph reports an empty canvas cleanly', () => {
    expect(formatCodeGraph(buildCodeGraphSummary())).toBe(
      'Code Graph: no file nodes on canvas. Add file nodes to see auto-detected dependencies.',
    );
  });
});

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}
