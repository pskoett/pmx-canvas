import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { canvasState, type CanvasAnnotation, type CanvasNodeState } from '../../src/server/canvas-state.ts';
import type { PmxAxState } from '../../src/server/ax-state.ts';
import type { CanvasTheme } from '../../src/server/canvas-db.ts';
import { loadStateFromDB } from '../../src/server/canvas-db.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { stopCanvasServer } from '../../src/server/server.ts';

export function createTestWorkspace(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Reserve an ephemeral port by binding and releasing it. Prefer
 * `startCanvasServer({ port: 0 })` + parsing the base URL where the same
 * process binds — reserve-then-rebind races parallel test files. Use this
 * only where a subprocess must be told its port up front.
 */
export async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to resolve an ephemeral port.'));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
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

// Windows releases the SQLite WAL/db handles asynchronously after close(),
// so an immediate rm can hit EBUSY. Retry briefly, then tolerate: the dir is
// an ephemeral temp dir — leaking it must never fail the suite.
export function removeTempDirWithRetry(dir: string): void {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      Bun.sleepSync(100);
    }
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    console.warn(`removeTempDirWithRetry: leaking ${dir} (${String(error)})`);
  }
}

export function removeTestWorkspace(workspaceRoot: string): void {
  canvasState.close();
  removeTempDirWithRetry(workspaceRoot);
}

export function readPersistedCanvasState(workspaceRoot: string): {
  nodes: CanvasNodeState[];
  edges: Array<{ id: string; from: string; to: string; type: string }>;
  annotations?: CanvasAnnotation[];
  contextPins: string[];
  theme?: CanvasTheme;
  ax?: PmxAxState;
} {
  // Try SQLite first (new persistence)
  const dbPath = join(workspaceRoot, '.pmx-canvas', 'canvas.db');
  if (existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true });
    try {
      const state = loadStateFromDB(db);
      if (state) {
        return {
          nodes: state.nodes,
          edges: state.edges,
          annotations: state.annotations,
          contextPins: state.contextPins,
          theme: state.theme,
          ax: state.ax,
        };
      }
    } finally {
      db.close();
    }
  }

  // Fallback to JSON (legacy tests)
  return JSON.parse(readFileSync(join(workspaceRoot, '.pmx-canvas', 'state.json'), 'utf-8')) as {
    nodes: CanvasNodeState[];
    edges: Array<{ id: string; from: string; to: string; type: string }>;
    annotations?: CanvasAnnotation[];
    contextPins: string[];
    theme?: CanvasTheme;
    ax?: PmxAxState;
  };
}

export function makeNode(overrides: Partial<CanvasNodeState> & Pick<CanvasNodeState, 'id' | 'type'>): CanvasNodeState {
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
  canvasState.setTheme('dark');
}

/**
 * Poll `check` until it holds, or throw a labeled timeout error. Replaces
 * fixed sleeps: waits exactly as long as the condition needs and fails loudly
 * (instead of asserting on stale state) when it never becomes true.
 */
export async function waitForCondition(
  check: () => boolean | Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const { timeoutMs = 3000, intervalMs = 25, label = 'condition' } = options;
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) {
      throw new Error(`waitForCondition: timed out after ${timeoutMs}ms waiting for ${label}.`);
    }
    await Bun.sleep(intervalMs);
  }
}

/**
 * Wait for the debounced canvas auto-save (SAVE_DEBOUNCE_MS in
 * canvas-state.ts) to flush to SQLite. `_saveTimer` is non-null while a save
 * is pending and is nulled in the same synchronous callback that performs the
 * write, so once a poll from the event loop observes null the persisted DB
 * reflects the last mutation. Polling the drain (instead of a fixed sleep)
 * keeps the mutation→scheduleSave→write path under test without racing it.
 */
export async function waitForPersistence(timeoutMs = 3000): Promise<void> {
  // biome-ignore lint/complexity/useLiteralKeys: reaches the private save timer — the real "save flushed" signal.
  await waitForCondition(() => canvasState['_saveTimer'] === null, {
    timeoutMs,
    label: 'the debounced canvas save to flush',
  });
}
