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
      expect(result.sourceContext.content).toContain('Web artifact: Opportunity Tree');
      expect(result.sourceContext.content).toContain('Source files: src/App.tsx, src/index.css, src/components/Card.tsx');
      expect(result.sourceContext.content).toContain('App source preview:');
      expect(result.sourceContext.content).toContain('Opportunity Tree');
      expect(result.sourceContext.content).not.toContain('<!DOCTYPE html>');
      expect(result.metadata.sourceFiles).toEqual(['src/App.tsx', 'src/index.css', 'src/components/Card.tsx']);
      expect(result.metadata.sourceFileCount).toBe(3);
      expect(result.metadata.sourcePreview).toContain('Opportunity Tree');
      expect(result.metadata).not.toHaveProperty('outputPreview');
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('removes literal macOS sed backup artifacts from initialized projects', async () => {
    const initScriptPath = join(workspaceRoot, 'init-with-sed-backup.sh');
    const bundleScriptPath = join(workspaceRoot, 'bundle-sed-backup.sh');
    writeFileSync(initScriptPath, `#!/bin/bash
set -e
PROJECT_NAME="$1"
mkdir -p "$PROJECT_NAME/src"
cat > "$PROJECT_NAME/package.json" <<'EOF'
{"name":"sed-backup-artifact"}
EOF
cat > "$PROJECT_NAME/index.html" <<'EOF'
<!DOCTYPE html><html><body><div id="root"></div></body></html>
EOF
cat > "$PROJECT_NAME/index.html''" <<'EOF'
stale sed backup
EOF
cat > "$PROJECT_NAME/src/App.tsx" <<'EOF'
export default function App() { return null; }
EOF
`, 'utf-8');
    writeFileSync(bundleScriptPath, `#!/bin/bash
set -e
echo '<!DOCTYPE html><html><body>sed backup</body></html>' > bundle.html
`, 'utf-8');
    chmodSync(initScriptPath, 0o755);
    chmodSync(bundleScriptPath, 0o755);

    const projectPath = join(workspaceRoot, 'artifacts', '.web-artifacts', 'sed-backup-artifact');
    const originalCwd = process.cwd();
    process.chdir(workspaceRoot);
    try {
      await executeWebArtifactBuild({
        title: 'Sed Backup Artifact',
        appTsx: 'export default function App() { return <main>Sed Backup</main>; }',
        projectPath,
        outputPath: join(workspaceRoot, 'artifacts', 'sed-backup-artifact.html'),
        initScriptPath,
        bundleScriptPath,
      });
      expect(existsSync(join(projectPath, "index.html''"))).toBe(false);
      expect(existsSync(join(projectPath, 'index.html'))).toBe(true);
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
      expect(node?.data.viewerType).toBe('web-artifact');
      expect(node?.data.title).toBe('Skill Demo');
      expect(node?.data.content).toContain('Web artifact: Skill Demo');
      expect(node?.data.content).toContain('App source preview:');
      expect(node?.data.content).not.toContain('<!DOCTYPE html>');
      expect(node?.data.sourceFiles).toEqual(['src/App.tsx']);
      expect(node?.data.sourceFileCount).toBe(1);
      expect(node?.data.sourcePreview).toContain('Skill Demo');
      expect(node?.data.artifactBytes).toBeGreaterThan(0);
      expect(node?.data.projectPath).toBe(result.projectPath);
      expect(String(node?.data.url ?? '')).toContain('/artifact?path=');
      expect(readFileSync(result.filePath, 'utf-8')).toContain('Skill Demo');
      expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('caps stored source file metadata while keeping total count in context', async () => {
    const { initScriptPath, bundleScriptPath } = createFakeWebArtifactScripts(workspaceRoot);
    const files = Object.fromEntries(
      Array.from({ length: 50 }, (_, index) => [
        `src/components/Generated${index}.tsx`,
        `export function Generated${index}() { return <span>${index}</span>; }`,
      ]),
    );

    const originalCwd = process.cwd();
    process.chdir(workspaceRoot);
    try {
      const result = await buildWebArtifactOnCanvas({
        title: 'Large Source Map',
        appTsx: 'export default function App() { return <main>Large Source Map</main>; }',
        files,
        projectPath: join(workspaceRoot, 'artifacts', '.web-artifacts', 'large-source-map'),
        outputPath: join(workspaceRoot, 'artifacts', 'large-source-map.html'),
        initScriptPath,
        bundleScriptPath,
      });

      expect(result.sourceContext.sourceFiles).toHaveLength(32);
      expect(result.sourceContext.sourceFileCount).toBe(51);
      expect(result.sourceContext.content).toContain('+43 more');
      const node = result.nodeId ? canvasState.getNode(result.nodeId) : undefined;
      expect(node?.data.sourceFiles).toHaveLength(32);
      expect(node?.data.sourceFileCount).toBe(51);
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
