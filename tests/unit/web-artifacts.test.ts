import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { canvasState } from '../../src/server/canvas-state.ts';
import {
  buildWebArtifactOnCanvas,
  executeWebArtifactBuild,
  resolveWebArtifactScriptPath,
} from '../../src/server/web-artifacts.ts';
import {
  createFakeWebArtifactScripts,
  createTestWorkspace,
  removeTestWorkspace,
  resetCanvasForTests,
} from './helpers.ts';

describe('web artifact builders', () => {
  let workspaceRoot = '';

  beforeEach(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-web-artifact-');
    resetCanvasForTests(workspaceRoot);
  });

  afterEach(() => {
    canvasState.withSuppressedRecording(() => {
      canvasState.clear();
    });
    removeTestWorkspace(workspaceRoot);
  });

  test('finds workspace skill scripts first', () => {
    const { initScriptPath, bundleScriptPath } = createFakeWebArtifactScripts(workspaceRoot);

    const originalCwd = process.cwd();
    process.chdir(workspaceRoot);
    try {
      expect(realpathSync(resolveWebArtifactScriptPath('init'))).toBe(realpathSync(initScriptPath));
      expect(realpathSync(resolveWebArtifactScriptPath('bundle'))).toBe(
        realpathSync(bundleScriptPath),
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('scaffolds project files and emits bundled html', async () => {
    const { initScriptPath, bundleScriptPath } = createFakeWebArtifactScripts(workspaceRoot);

    const originalCwd = process.cwd();
    process.chdir(workspaceRoot);
    try {
      const result = await executeWebArtifactBuild({
        title: 'Opportunity Tree',
        appTsx: 'export default function App() { return <main>Opportunity Tree</main>; }',
        indexCss: 'body { background: #123456; }',
        files: {
          'src/components/Card.tsx': 'export function Card() { return <section>Card</section>; }',
        },
        projectPath: join(workspaceRoot, 'artifacts', '.web-artifacts', 'opportunity-tree'),
        outputPath: join(workspaceRoot, 'artifacts', 'opportunity-tree.html'),
        initScriptPath,
        bundleScriptPath,
      });

      expect(existsSync(result.projectPath)).toBe(true);
      expect(existsSync(result.filePath)).toBe(true);
      expect(readFileSync(join(result.projectPath, 'src', 'App.tsx'), 'utf-8')).toContain(
        'Opportunity Tree',
      );
      expect(
        readFileSync(join(result.projectPath, 'src', 'components', 'Card.tsx'), 'utf-8'),
      ).toContain('Card');
      expect(readFileSync(result.filePath, 'utf-8')).toContain('Opportunity Tree');
      expect(result.fileSize).toBeGreaterThan(0);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('can open the built artifact as an mcp-app canvas node', async () => {
    const { initScriptPath, bundleScriptPath } = createFakeWebArtifactScripts(workspaceRoot);

    const originalCwd = process.cwd();
    process.chdir(workspaceRoot);
    try {
      const result = await buildWebArtifactOnCanvas({
        title: 'Skill Demo',
        appTsx: 'export default function App() { return <main>Skill Demo</main>; }',
        projectPath: join(workspaceRoot, 'artifacts', '.web-artifacts', 'skill-demo'),
        outputPath: join(workspaceRoot, 'artifacts', 'skill-demo.html'),
        initScriptPath,
        bundleScriptPath,
      });

      expect(result.openedInCanvas).toBe(true);
      expect(typeof result.nodeId).toBe('string');
      const node = result.nodeId ? canvasState.getNode(result.nodeId) : undefined;
      expect(node?.type).toBe('mcp-app');
      expect(node?.data.title).toBe('Skill Demo');
      expect(String(node?.data.url ?? '')).toContain('/artifact?path=');
      expect(readFileSync(result.filePath, 'utf-8')).toContain('Skill Demo');
    } finally {
      process.chdir(originalCwd);
    }
  });
});
