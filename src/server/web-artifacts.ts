import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ensureArtifactsDir, getWorkspaceRoot } from './artifact-paths.js';
import { canvasState, type CanvasNodeState } from './canvas-state.js';
import { findOpenCanvasPosition } from './placement.js';
import { emitPrimaryWorkbenchEvent } from './server.js';

const BUNDLED_WEB_ARTIFACT_SCRIPTS_DIR = join(import.meta.dir, 'web-artifacts', 'scripts');
const LEGACY_SKILL_WEB_ARTIFACT_SCRIPTS_DIR = join(
  import.meta.dir,
  '..',
  '..',
  'skills',
  'web-artifacts-builder',
  'scripts',
);
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_PACKAGE_MANAGER = 'pnpm@10.33.0';
const DEFAULT_WEB_ARTIFACT_NODE_SIZE = { width: 960, height: 720 };
const FALLBACK_PATH_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];

export interface WebArtifactBuildInput {
  title: string;
  appTsx: string;
  indexCss?: string;
  mainTsx?: string;
  indexHtml?: string;
  files?: Record<string, string>;
  projectPath?: string;
  outputPath?: string;
  initScriptPath?: string;
  bundleScriptPath?: string;
  timeoutMs?: number;
}

export interface WebArtifactBuildOutput {
  filePath: string;
  fileSize: number;
  projectPath: string;
  metadata: Record<string, unknown>;
  logs?: {
    stdout?: WebArtifactLogSummary;
    stderr?: WebArtifactLogSummary;
  };
  stdout?: string;
  stderr?: string;
}

export interface WebArtifactLogSummary {
  lineCount: number;
  excerpt: string[];
  truncated: boolean;
  suppressedNoiseCount: number;
}

export interface WebArtifactCanvasOpenResult {
  nodeId: string;
  url: string;
}

export interface WebArtifactCanvasBuildResult extends WebArtifactBuildOutput {
  openedInCanvas: boolean;
  nodeId?: string;
  url?: string;
}

function currentWorkspaceRoot(): string {
  return canvasState.getWorkspaceRoot();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function defaultIndexHtml(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug.length > 0 ? slug : 'web-artifact';
}

function isPathInside(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  if (rel === '') return true;
  return !rel.startsWith('..') && rel !== '..' && !isAbsolute(rel);
}

export function resolveWorkspacePath(pathLike: string, cwd?: string): string {
  const workspace = getWorkspaceRoot(cwd ?? currentWorkspaceRoot());
  const resolved = resolve(workspace, pathLike);
  if (!isPathInside(workspace, resolved)) {
    throw new Error(`Path "${pathLike}" resolves outside workspace.`);
  }
  return resolved;
}

async function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<{ stdout: string; stderr: string }> {
  const pathEntries = new Set(
    String(process.env.PATH ?? '')
      .split(delimiter)
      .filter(Boolean),
  );
  for (const entry of FALLBACK_PATH_DIRS) {
    pathEntries.add(entry);
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => {
      if (typeof value !== 'string' || value.length === 0) return false;
      return new Set([
        'PATH',
        'HOME',
        'SHELL',
        'LANG',
        'LC_ALL',
        'TERM',
        'USER',
        'TMPDIR',
        'TMP',
        'TEMP',
        'http_proxy',
        'https_proxy',
        'HTTP_PROXY',
        'HTTPS_PROXY',
        'NO_PROXY',
        'no_proxy',
        'SSL_CERT_FILE',
        'NODE_EXTRA_CA_CERTS',
      ]).has(key);
    }),
  );
  // Spawn in its own process group (POSIX only — Windows has a different model).
  // This lets us kill every descendant — pnpm, bun, parcel, swc, lmdb, etc. —
  // if the build hangs or times out, instead of leaving orphans that accumulate
  // file descriptors and processes across retries (seen as later
  // `fork: Resource temporarily unavailable` in end-user reports).
  const isPosix = process.platform !== 'win32';
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: {
      ...env,
      PATH: [...pathEntries].join(delimiter),
      CI: '1',
      npm_config_yes: 'true',
      pnpm_config_yes: 'true',
      // Cap pnpm's internal child concurrency so installs don't blow past
      // macOS default ulimit -u (often 256-2048) when resolving the ~30
      // radix-ui dependencies in one `pnpm add` call.
      pnpm_config_child_concurrency: '2',
      NPM_CONFIG_CHILD_CONCURRENCY: '2',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: isPosix,
  });

  const killTree = (signal: NodeJS.Signals): void => {
    if (isPosix && typeof child.pid === 'number') {
      try {
        // Negative pid = send to the whole process group.
        process.kill(-child.pid, signal);
        return;
      } catch {
        // fall through to direct kill
      }
    }
    try {
      child.kill(signal);
    } catch {
      // ignore
    }
  };

  let stdout = '';
  let stderr = '';
  let timedOut = false;

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      timedOut = true;
      killTree('SIGKILL');
      rejectPromise(new Error(`Command timed out after ${options.timeoutMs}ms: ${command}`));
    }, options.timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      killTree('SIGKILL');
      rejectPromise(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code !== 0) {
        const trimmedStderr = stderr.trim();
        const stderrTail = trimmedStderr.split('\n').slice(-20).join('\n');
        const trimmedStdout = stdout.trim();
        const stdoutTail = trimmedStdout.split('\n').slice(-20).join('\n');
        rejectPromise(
          new Error(
            [
              `Command failed (${code}): ${command} ${args.join(' ')}`,
              stderrTail && `stderr:\n${stderrTail}`,
              !trimmedStderr && stdoutTail && `stdout:\n${stdoutTail}`,
            ]
              .filter(Boolean)
              .join('\n'),
          ),
        );
        return;
      }
      resolvePromise();
    });
  });

  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

export function resolveWebArtifactScriptPath(kind: 'init' | 'bundle'): string {
  const scriptFile = kind === 'init' ? 'init-artifact.sh' : 'bundle-artifact.sh';
  const candidates = [
    join(currentWorkspaceRoot(), 'skills', 'web-artifacts-builder', 'scripts', scriptFile),
    join(BUNDLED_WEB_ARTIFACT_SCRIPTS_DIR, scriptFile),
    join(LEGACY_SKILL_WEB_ARTIFACT_SCRIPTS_DIR, scriptFile),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return resolve(candidate);
  }

  throw new Error(
    `No web-artifact ${kind} script found. Expected one of: ${candidates.join(', ')}`,
  );
}

function writeProjectFiles(
  projectPath: string,
  input: Pick<
    WebArtifactBuildInput,
    'title' | 'appTsx' | 'indexCss' | 'mainTsx' | 'indexHtml' | 'files'
  >,
): void {
  const writes = new Map<string, string>();
  writes.set(join(projectPath, 'src', 'App.tsx'), input.appTsx);
  writes.set(join(projectPath, 'index.html'), input.indexHtml ?? defaultIndexHtml(input.title));
  if (typeof input.indexCss === 'string') {
    writes.set(join(projectPath, 'src', 'index.css'), input.indexCss);
  }
  if (typeof input.mainTsx === 'string') {
    writes.set(join(projectPath, 'src', 'main.tsx'), input.mainTsx);
  }
  for (const [relativePath, content] of Object.entries(input.files ?? {})) {
    writes.set(join(projectPath, relativePath), content);
  }

  for (const [filePath, content] of writes.entries()) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
  }
}

function ensurePackageManagerBoundary(dirPath: string): void {
  const packageJsonPath = join(dirPath, 'package.json');
  mkdirSync(dirPath, { recursive: true });
  let nextPackageJson: Record<string, unknown> = {};
  if (existsSync(packageJsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        nextPackageJson = parsed as Record<string, unknown>;
      }
    } catch (error) {
      console.warn('[web-artifacts] failed to parse existing package.json boundary', {
        error,
        packageJsonPath,
      });
      nextPackageJson = {};
    }
  }
  nextPackageJson.private = true;
  nextPackageJson.packageManager = DEFAULT_PACKAGE_MANAGER;
  writeFileSync(packageJsonPath, JSON.stringify(nextPackageJson, null, 2), 'utf-8');
}

function summarizeArtifactLog(text: string): WebArtifactLogSummary | undefined {
  if (!text.trim()) return undefined;

  const lines = text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return undefined;

  const noisyPatterns = [
    /\/dev\/tty/i,
    /no such device or address/i,
  ];
  const filteredLines = lines.filter((line) => !noisyPatterns.some((pattern) => pattern.test(line)));
  const suppressedNoiseCount = lines.length - filteredLines.length;
  const visibleLines = filteredLines.length > 0 ? filteredLines : lines;
  const excerpt = visibleLines.slice(-6);

  return {
    lineCount: visibleLines.length,
    excerpt,
    truncated: visibleLines.length > excerpt.length,
    suppressedNoiseCount,
  };
}

export async function executeWebArtifactBuild(
  input: WebArtifactBuildInput,
): Promise<WebArtifactBuildOutput> {
  const workspaceRoot = currentWorkspaceRoot();
  const artifactsDir = ensureArtifactsDir(workspaceRoot);
  const slug = slugify(input.title);
  const projectPath = resolve(input.projectPath ?? join(artifactsDir, '.web-artifacts', slug));
  const outputPath = resolve(input.outputPath ?? join(artifactsDir, `${slug}.html`));
  const initScriptPath = resolve(input.initScriptPath ?? resolveWebArtifactScriptPath('init'));
  const bundleScriptPath = resolve(
    input.bundleScriptPath ?? resolveWebArtifactScriptPath('bundle'),
  );
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!existsSync(initScriptPath)) {
    throw new Error(`Web-artifact init script not found: ${initScriptPath}`);
  }
  if (!existsSync(bundleScriptPath)) {
    throw new Error(`Web-artifact bundle script not found: ${bundleScriptPath}`);
  }

  const parentDir = dirname(projectPath);
  mkdirSync(parentDir, { recursive: true });
  ensurePackageManagerBoundary(parentDir);

  let stdout = '';
  let stderr = '';
  const needsInit =
    !existsSync(projectPath) ||
    !existsSync(join(projectPath, 'package.json')) ||
    !existsSync(join(projectPath, 'src'));

  if (needsInit) {
    const initResult = await runProcess('bash', [initScriptPath, basename(projectPath)], {
      cwd: parentDir,
      timeoutMs,
    });
    stdout = [stdout, initResult.stdout].filter(Boolean).join('\n');
    stderr = [stderr, initResult.stderr].filter(Boolean).join('\n');
  }

  writeProjectFiles(projectPath, input);

  const bundleResult = await runProcess('bash', [bundleScriptPath], {
    cwd: projectPath,
    timeoutMs,
  });
  stdout = [stdout, bundleResult.stdout].filter(Boolean).join('\n');
  stderr = [stderr, bundleResult.stderr].filter(Boolean).join('\n');

  const bundlePath = join(projectPath, 'bundle.html');
  if (!existsSync(bundlePath)) {
    throw new Error(`Expected bundled artifact at ${bundlePath}`);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  copyFileSync(bundlePath, outputPath);

  return {
    filePath: outputPath,
    fileSize: statSync(outputPath).size,
    projectPath,
    metadata: {
      title: input.title,
      bundlePath,
      projectPath,
      hasIndexCss: typeof input.indexCss === 'string',
      extraFileCount: Object.keys(input.files ?? {}).length,
      outputPreview: readFileSync(outputPath, 'utf-8').slice(0, 200),
    },
    logs: {
      ...(summarizeArtifactLog(stdout) ? { stdout: summarizeArtifactLog(stdout) } : {}),
      ...(summarizeArtifactLog(stderr) ? { stderr: summarizeArtifactLog(stderr) } : {}),
    },
    stdout: stdout || undefined,
    stderr: stderr || undefined,
  };
}

export function openWebArtifactInCanvas(input: {
  title: string;
  filePath: string;
}): WebArtifactCanvasOpenResult {
  const width = DEFAULT_WEB_ARTIFACT_NODE_SIZE.width;
  const height = DEFAULT_WEB_ARTIFACT_NODE_SIZE.height;
  const pos = findOpenCanvasPosition(canvasState.getLayout().nodes, width, height);
  const id = `artifact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const url = `/artifact?path=${encodeURIComponent(input.filePath)}`;
  const node: CanvasNodeState = {
    id,
    type: 'mcp-app',
    position: pos,
    size: { width, height },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data: {
      title: input.title,
      url,
      path: input.filePath,
      trustedDomain: true,
      sourceServer: 'pmx-canvas',
      hostMode: 'hosted',
    },
  };

  canvasState.addNode(node);
  emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  return { nodeId: id, url };
}

export async function buildWebArtifactOnCanvas(input: WebArtifactBuildInput & {
  openInCanvas?: boolean;
}): Promise<WebArtifactCanvasBuildResult> {
  const build = await executeWebArtifactBuild(input);
  if (input.openInCanvas === false) {
    return { ...build, openedInCanvas: false };
  }
  const opened = openWebArtifactInCanvas({
    title: input.title,
    filePath: build.filePath,
  });
  return {
    ...build,
    openedInCanvas: true,
    nodeId: opened.nodeId,
    url: opened.url,
  };
}
