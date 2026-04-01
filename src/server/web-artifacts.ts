import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ensureArtifactsDir, getWorkspaceRoot } from './artifact-paths.js';
import { canvasState, type CanvasNodeState } from './canvas-state.js';
import { findOpenCanvasPosition } from './placement.js';
import { emitPrimaryWorkbenchEvent } from './server.js';

const SOURCE_WEB_ARTIFACT_SCRIPTS_DIR = join(
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
  stdout?: string;
  stderr?: string;
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
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: {
      ...env,
      CI: '1',
      npm_config_yes: 'true',
      pnpm_config_yes: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

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
      child.kill('SIGKILL');
      rejectPromise(new Error(`Command timed out after ${options.timeoutMs}ms: ${command}`));
    }, options.timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code !== 0) {
        rejectPromise(
          new Error(
            [`Command failed (${code}): ${command} ${args.join(' ')}`, stderr.trim()]
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
    join(SOURCE_WEB_ARTIFACT_SCRIPTS_DIR, scriptFile),
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
    } catch {
      nextPackageJson = {};
    }
  }
  nextPackageJson.private = true;
  nextPackageJson.packageManager = DEFAULT_PACKAGE_MANAGER;
  writeFileSync(packageJsonPath, JSON.stringify(nextPackageJson, null, 2), 'utf-8');
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
