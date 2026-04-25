import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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

  test('falls back to bundled runtime scripts when no workspace skill scripts exist', () => {
    const originalCwd = process.cwd();
    process.chdir(workspaceRoot);
    try {
      expect(realpathSync(resolveWebArtifactScriptPath('init'))).toBe(
        realpathSync(join(import.meta.dir, '..', '..', 'src', 'server', 'web-artifacts', 'scripts', 'init-artifact.sh')),
      );
      expect(realpathSync(resolveWebArtifactScriptPath('bundle'))).toBe(
        realpathSync(join(import.meta.dir, '..', '..', 'src', 'server', 'web-artifacts', 'scripts', 'bundle-artifact.sh')),
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

  test('fails instead of emitting a zero-byte artifact', async () => {
    const initScriptPath = join(workspaceRoot, 'init-empty.sh');
    const bundleScriptPath = join(workspaceRoot, 'bundle-empty.sh');
    writeFileSync(initScriptPath, `#!/bin/bash
set -e
PROJECT_NAME="$1"
mkdir -p "$PROJECT_NAME/src"
cat > "$PROJECT_NAME/package.json" <<'EOF'
{"name":"empty-artifact"}
EOF
cat > "$PROJECT_NAME/index.html" <<'EOF'
<!DOCTYPE html><html><body><div id="root"></div></body></html>
EOF
`, 'utf-8');
    writeFileSync(bundleScriptPath, `#!/bin/bash
set -e
: > bundle.html
`, 'utf-8');
    chmodSync(initScriptPath, 0o755);
    chmodSync(bundleScriptPath, 0o755);

    const originalCwd = process.cwd();
    process.chdir(workspaceRoot);
    try {
      await expect(executeWebArtifactBuild({
        title: 'Empty Artifact',
        appTsx: 'export default function App() { return null; }',
        projectPath: join(workspaceRoot, 'artifacts', '.web-artifacts', 'empty-artifact'),
        outputPath: join(workspaceRoot, 'artifacts', 'empty-artifact.html'),
        initScriptPath,
        bundleScriptPath,
      })).rejects.toThrow(/empty/);
      expect(canvasState.getLayout().nodes).toHaveLength(0);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('records requested artifact dependencies in metadata', async () => {
    const { initScriptPath, bundleScriptPath } = createFakeWebArtifactScripts(workspaceRoot);
    const fakePnpmPath = join(workspaceRoot, 'pnpm');
    writeFileSync(fakePnpmPath, '#!/bin/bash\nexit 0\n', 'utf-8');
    chmodSync(fakePnpmPath, 0o755);
    const originalCwd = process.cwd();
    const originalPath = process.env.PATH ?? '';
    process.env.PATH = `${workspaceRoot}:${originalPath}`;
    process.chdir(workspaceRoot);
    try {
      const result = await executeWebArtifactBuild({
        title: 'Deps Artifact',
        appTsx: 'export default function App() { return <main>Deps</main>; }',
        deps: ['recharts', 'recharts'],
        projectPath: join(workspaceRoot, 'artifacts', '.web-artifacts', 'deps-artifact'),
        outputPath: join(workspaceRoot, 'artifacts', 'deps-artifact.html'),
        initScriptPath,
        bundleScriptPath,
      });
      expect(result.metadata.deps).toEqual(['recharts']);
    } finally {
      process.chdir(originalCwd);
      process.env.PATH = originalPath;
    }
  });

  test('rejects option-like artifact dependencies before package manager execution', async () => {
    const { initScriptPath, bundleScriptPath } = createFakeWebArtifactScripts(workspaceRoot);

    const originalCwd = process.cwd();
    process.chdir(workspaceRoot);
    try {
      await expect(executeWebArtifactBuild({
        title: 'Bad Deps Artifact',
        appTsx: 'export default function App() { return <main>Bad Deps</main>; }',
        deps: ['--global'],
        projectPath: join(workspaceRoot, 'artifacts', '.web-artifacts', 'bad-deps-artifact'),
        outputPath: join(workspaceRoot, 'artifacts', 'bad-deps-artifact.html'),
        initScriptPath,
        bundleScriptPath,
      })).rejects.toThrow(/Invalid web-artifact dependency name/);
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

  test('log summaries suppress known build noise while keeping actionable lines', async () => {
    const initScriptPath = join(workspaceRoot, 'emit-noisy-init.sh');
    const bundleScriptPath = join(workspaceRoot, 'emit-noisy-bundle.sh');
    writeFileSync(initScriptPath, `#!/bin/bash
set -e
PROJECT_NAME="$1"
mkdir -p "$PROJECT_NAME/src"
cat > "$PROJECT_NAME/package.json" <<'EOF'
{"name":"noisy-artifact"}
EOF
cat > "$PROJECT_NAME/index.html" <<'EOF'
<!DOCTYPE html><html><body><div id="root"></div></body></html>
EOF
cat > "$PROJECT_NAME/src/main.tsx" <<'EOF'
console.log("main");
EOF
cat > "$PROJECT_NAME/src/App.tsx" <<'EOF'
export default function App() { return null; }
EOF
`, 'utf-8');
    writeFileSync(bundleScriptPath, `#!/bin/bash
set -e
echo 'Opening \`/dev/tty\` failed (6): Device not configured' 1>&2
echo 'useful warning line' 1>&2
echo '<!DOCTYPE html><html><body>artifact</body></html>' > bundle.html
`, 'utf-8');
    chmodSync(initScriptPath, 0o755);
    chmodSync(bundleScriptPath, 0o755);

    const originalCwd = process.cwd();
    process.chdir(workspaceRoot);
    try {
      const result = await executeWebArtifactBuild({
        title: 'Noisy Artifact',
        appTsx: 'export default function App() { return <main>Noisy Artifact</main>; }',
        projectPath: join(workspaceRoot, 'artifacts', '.web-artifacts', 'noisy-artifact'),
        outputPath: join(workspaceRoot, 'artifacts', 'noisy-artifact.html'),
        initScriptPath,
        bundleScriptPath,
      });

      expect(result.logs?.stderr?.suppressedNoiseCount).toBe(1);
      expect(result.logs?.stderr?.excerpt).toContain('useful warning line');
      expect(result.logs?.stderr?.excerpt.some((line) => line.includes('/dev/tty'))).toBe(false);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
