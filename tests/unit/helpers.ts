import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canvasState, type CanvasNodeState } from '../../src/server/canvas-state.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { stopCanvasServer } from '../../src/server/server.ts';

export function createTestWorkspace(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content, 'utf-8');
  chmodSync(path, 0o755);
}

export function createFakeWebArtifactScripts(root: string): {
  initScriptPath: string;
  bundleScriptPath: string;
} {
  const scriptsDir = join(root, 'skills', 'web-artifacts-builder', 'scripts');
  mkdirSync(scriptsDir, { recursive: true });

  const initScriptPath = join(scriptsDir, 'init-artifact.sh');
  writeExecutable(
    initScriptPath,
    `#!/bin/bash
set -e
PROJECT_NAME="$1"
mkdir -p "$PROJECT_NAME/src"
cat > "$PROJECT_NAME/package.json" <<'EOF'
{"name":"fake-web-artifact"}
EOF
cat > "$PROJECT_NAME/index.html" <<'EOF'
<!DOCTYPE html>
<html>
  <body>
    <div id="root"></div>
  </body>
</html>
EOF
cat > "$PROJECT_NAME/src/main.tsx" <<'EOF'
console.log("main");
EOF
cat > "$PROJECT_NAME/src/App.tsx" <<'EOF'
export default function App() { return null; }
EOF
`,
  );

  const bundleScriptPath = join(scriptsDir, 'bundle-artifact.sh');
  writeExecutable(
    bundleScriptPath,
    `#!/bin/bash
set -e
{
  echo '<!DOCTYPE html><html><body><style>'
  if [ -f src/index.css ]; then cat src/index.css; fi
  echo '</style><pre>'
  cat src/App.tsx
  echo '</pre></body></html>'
} > bundle.html
`,
  );

  return { initScriptPath, bundleScriptPath };
}

export function removeTestWorkspace(workspaceRoot: string): void {
  rmSync(workspaceRoot, { recursive: true, force: true });
}

export function readPersistedCanvasState(workspaceRoot: string): {
  nodes: CanvasNodeState[];
  edges: Array<{ id: string; from: string; to: string; type: string }>;
  contextPins: string[];
} {
  return JSON.parse(readFileSync(join(workspaceRoot, '.pmx-canvas.json'), 'utf-8')) as {
    nodes: CanvasNodeState[];
    edges: Array<{ id: string; from: string; to: string; type: string }>;
    contextPins: string[];
  };
}

export function makeNode(
  overrides: Partial<CanvasNodeState> & Pick<CanvasNodeState, 'id' | 'type'>,
): CanvasNodeState {
  return {
    id: overrides.id,
    type: overrides.type,
    position: overrides.position ?? { x: 40, y: 80 },
    size: overrides.size ?? { width: 360, height: 200 },
    zIndex: overrides.zIndex ?? (overrides.type === 'group' ? 0 : 1),
    collapsed: overrides.collapsed ?? false,
    pinned: overrides.pinned ?? false,
    dockPosition: overrides.dockPosition ?? null,
    data: overrides.data ?? {},
  };
}

export function resetCanvasForTests(workspaceRoot: string): void {
  stopCanvasServer();
  canvasState.withSuppressedRecording(() => {
    canvasState.clear();
  });
  mutationHistory.reset();
  canvasState.setWorkspaceRoot(workspaceRoot);
}

export async function waitForPersistence(ms = 650): Promise<void> {
  await Bun.sleep(ms);
}
