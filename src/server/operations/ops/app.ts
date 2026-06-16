/**
 * External / built-content app operations (plan-008 Wave 4):
 *   mcpapp.open      → canvas_open_mcp_app      → POST /api/canvas/mcp-app/open
 *   diagram.open     → canvas_add_diagram       → POST /api/canvas/diagram
 *   webartifact.build → canvas_build_web_artifact → POST /api/canvas/web-artifact
 *
 * These were deferred in plan-005/006 as "poor fits" (stateful external MCP
 * session + custom SSE; long-running build). On reflection they migrate cleanly:
 * `executeOperation` is async (the long-running build fits — its "long-running"
 * caveat is about MCP client timeouts, not registry fit), and their runtimes are
 * server-independent DOMAIN modules (mcp-app-runtime, diagram-presets,
 * web-artifacts), not server.ts. So the op handlers call those modules directly
 * — no runner injection needed.
 *
 * SSE parity (these are NOT canvas node/edge state mutations, so `mutates:false`
 * — the registry must NOT emit canvas-layout-update):
 *  - mcpapp.open / diagram.open emit `ext-app-open` + `ext-app-result` via
 *    ctx.emit, byte-identical to the legacy emitPrimaryWorkbenchEvent calls.
 *  - webartifact.build's node creation emits its own `canvas-layout-update` from
 *    inside web-artifacts.ts (the injected canvas-operations emitter), so the op
 *    must not re-emit.
 *
 * Local-vs-remote asymmetry (the only allowed unification — documented):
 * mcpapp.open's node-precondition failures THROW an OperationError here (404 for
 * a missing node, 400 for a non-ext-app node). Over HTTP that becomes
 * `{ ok:false, error }` with the right status (matching the legacy handler's
 * explicit 404/400 responses); over MCP it becomes a bare-message isError result.
 * The legacy SDK threw a plain Error for the same case; the registry's
 * OperationError carries the status so the HTTP surface is unchanged.
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { canvasState } from '../../canvas-state.js';
import {
  closeMcpAppSession,
  openMcpApp as openExternalMcpApp,
  type ExternalMcpTransportConfig,
} from '../../mcp-app-runtime.js';
import {
  buildExcalidrawOpenMcpAppInput,
  ensureExcalidrawCheckpointId,
  isExcalidrawCreateView,
} from '../../diagram-presets.js';
import { findCanvasExtAppNodeId } from '../../ext-app-lookup.js';
import {
  buildWebArtifactOnCanvas,
  resolveWorkspacePath,
  type WebArtifactCanvasBuildResult,
} from '../../web-artifacts.js';
import { isEmitSuppressed } from '../registry.js';
import { defineOperation, OperationError, type Operation, type OperationContext } from '../types.js';
import { isRecord } from './nodes.js';

// ── shared open-mcp-app core ──────────────────────────────────

export interface OpenMcpAppCoreInput {
  transport: ExternalMcpTransportConfig;
  toolName: string;
  toolArguments?: Record<string, unknown>;
  nodeId?: string;
  serverName?: string;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  timeoutMs?: number;
}

export interface OpenMcpAppCoreResult {
  ok: true;
  id?: string;
  nodeId: string | null;
  toolCallId: string;
  sessionId: string;
  resourceUri: string;
}

/**
 * Open an external MCP app: connect + call + read resource (openExternalMcpApp),
 * close any prior session on an in-place node, emit `ext-app-open` +
 * `ext-app-result`, then resolve the resulting canvas node id. This is the exact
 * legacy SDK `openMcpApp` body, relocated; both the mcpapp.open op AND the SDK
 * call it. The diagram.open op delegates here after building the Excalidraw input
 * (the SSE pair fires ONCE — diagram.open does not re-emit).
 */
export async function openMcpAppCore(
  input: OpenMcpAppCoreInput,
  ctx: OperationContext,
): Promise<OpenMcpAppCoreResult> {
  // The canvas node is created as a side-effect of the `ext-app-open` SSE event
  // (syncEventToCanvasState). Inside a suppressed-emit run (canvas.batch) that
  // event is dropped, so the node would never be created and the just-opened
  // external session would leak with a null nodeId. Reject loudly BEFORE opening
  // any session rather than silently corrupting. mcpapp.open / diagram.open are
  // not batchable — call canvas_open_mcp_app / canvas_add_diagram (or canvas_app).
  if (isEmitSuppressed()) {
    throw new OperationError(
      'mcpapp.open / diagram.open cannot run inside canvas_batch: the canvas node is created from the ext-app-open SSE event, which batch suppresses. Call the op directly (canvas_open_mcp_app / canvas_add_diagram, or canvas_app).',
    );
  }
  const targetNode = input.nodeId ? canvasState.getNode(input.nodeId) : undefined;
  if (input.nodeId && !targetNode) {
    throw new OperationError(`Node "${input.nodeId}" not found.`, 404);
  }
  if (targetNode && (targetNode.type !== 'mcp-app' || targetNode.data.mode !== 'ext-app')) {
    throw new OperationError(`Node "${input.nodeId}" is not an external app node.`);
  }

  const opened = await openExternalMcpApp({
    transport: input.transport,
    toolName: input.toolName,
    ...(input.toolArguments ? { toolArguments: input.toolArguments } : {}),
    ...(input.serverName ? { serverName: input.serverName } : {}),
    ...(typeof input.timeoutMs === 'number' ? { timeoutMs: input.timeoutMs } : {}),
  });
  const toolCallId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const previousSessionId = targetNode?.data.appSessionId;
  if (typeof previousSessionId === 'string' && previousSessionId.trim().length > 0) {
    closeMcpAppSession(previousSessionId);
  }
  const nodeIdSeed = input.nodeId ?? `ext-app-${toolCallId}`;
  const toolResult = isExcalidrawCreateView(opened.serverName, opened.toolName)
    ? ensureExcalidrawCheckpointId(opened.toolResult, nodeIdSeed)
    : opened.toolResult;
  ctx.emit('ext-app-open', {
    toolCallId,
    nodeId: nodeIdSeed,
    // Preserve an existing in-place node's title when no override is given (legacy
    // runAndEmitOpenMcpApp fallback order) — otherwise an in-place update with no
    // `title` would reset the node title to the external tool's name.
    title: input.title ?? (targetNode?.data.title as string | undefined) ?? opened.tool.title ?? opened.tool.name,
    html: opened.html,
    toolInput: opened.toolInput,
    serverName: opened.serverName,
    toolName: opened.toolName,
    appSessionId: opened.sessionId,
    transportConfig: input.transport,
    resourceUri: opened.resourceUri,
    toolDefinition: opened.tool,
    sessionStatus: 'ready',
    sessionError: null,
    ...(opened.resourceMeta ? { resourceMeta: opened.resourceMeta } : {}),
    ...(typeof input.x === 'number' ? { x: input.x } : {}),
    ...(typeof input.y === 'number' ? { y: input.y } : {}),
    ...(typeof input.width === 'number' ? { width: input.width } : {}),
    ...(typeof input.height === 'number' ? { height: input.height } : {}),
  });
  ctx.emit('ext-app-result', {
    toolCallId,
    nodeId: nodeIdSeed,
    serverName: opened.serverName,
    toolName: opened.toolName,
    success: toolResult.isError !== true,
    result: toolResult,
  });
  const nodeId = input.nodeId ?? findCanvasExtAppNodeId(toolCallId, {
    getNode: (id) => canvasState.getNode(id),
    listNodes: () => canvasState.getLayout().nodes,
  });
  return {
    ok: true,
    ...(nodeId ? { id: nodeId } : {}),
    nodeId,
    toolCallId,
    sessionId: opened.sessionId,
    resourceUri: opened.resourceUri,
  };
}

/** Build the OpenMcpAppCoreInput from a raw HTTP/MCP arg object (mcpapp.open). */
function buildOpenMcpAppInput(body: Record<string, unknown>): OpenMcpAppCoreInput {
  const transport = body.transport as ExternalMcpTransportConfig | undefined;
  if (!isRecord(transport)) {
    throw new OperationError('Missing valid transport or toolName.');
  }
  const toolName = typeof body.toolName === 'string' ? body.toolName.trim() : '';
  if (!toolName) {
    throw new OperationError('Missing valid transport or toolName.');
  }
  const toolArguments = isRecord(body.toolArguments) ? body.toolArguments : undefined;
  const serverName = typeof body.serverName === 'string' && body.serverName.trim().length > 0
    ? body.serverName.trim()
    : undefined;
  const title = typeof body.title === 'string' && body.title.trim().length > 0
    ? body.title.trim()
    : undefined;
  const nodeId = typeof body.nodeId === 'string' && body.nodeId.trim().length > 0
    ? body.nodeId.trim()
    : undefined;
  return {
    transport,
    toolName,
    ...(toolArguments ? { toolArguments } : {}),
    ...(serverName ? { serverName } : {}),
    ...(title ? { title } : {}),
    ...(nodeId ? { nodeId } : {}),
    ...(typeof body.x === 'number' ? { x: body.x } : {}),
    ...(typeof body.y === 'number' ? { y: body.y } : {}),
    ...(typeof body.width === 'number' ? { width: body.width } : {}),
    ...(typeof body.height === 'number' ? { height: body.height } : {}),
    ...(typeof body.timeoutMs === 'number' ? { timeoutMs: body.timeoutMs } : {}),
  };
}

// ── mcpapp.open ───────────────────────────────────────────────

const openMcpAppShape = {
  toolName: z.string().describe('Tool name on the external MCP server'),
  serverName: z.string().optional().describe('Optional display name for the external MCP server'),
  toolArguments: z.record(z.string(), z.unknown()).optional().describe('Arguments passed to the external tool call'),
  nodeId: z.string().optional().describe('Existing mcp-app node ID to update in place instead of creating a new node.'),
  title: z.string().optional().describe('Optional canvas node title override'),
  x: z.number().optional().describe('X position (auto-placed if omitted)'),
  y: z.number().optional().describe('Y position (auto-placed if omitted)'),
  width: z.number().optional().describe('Width in pixels (default: 720)'),
  height: z.number().optional().describe('Height in pixels (default: 500)'),
  timeoutMs: z.number().optional().describe('Optional MCP request timeout in milliseconds for cold external app servers'),
  transport: z.union([
    z.object({
      type: z.literal('stdio'),
      command: z.string().describe('Executable used to start the external MCP server'),
      args: z.array(z.string()).optional().describe('Arguments for the executable'),
      cwd: z.string().optional().describe('Optional working directory'),
      env: z.record(z.string(), z.string()).optional().describe('Optional environment overrides'),
    }),
    z.object({
      type: z.literal('http'),
      url: z.string().describe('Streamable HTTP MCP endpoint URL'),
      headers: z.record(z.string(), z.string()).optional().describe('Optional HTTP headers'),
    }),
  ]).describe('How PMX Canvas should connect to the external MCP server'),
};
const openMcpAppSchema = z.looseObject(openMcpAppShape);

const openMcpAppOperation = defineOperation<z.infer<typeof openMcpAppSchema>, OpenMcpAppCoreResult>({
  name: 'mcpapp.open',
  mutates: false,
  input: openMcpAppSchema,
  inputShape: openMcpAppShape,
  http: {
    method: 'POST',
    path: '/api/canvas/mcp-app/open',
  },
  mcp: {
    toolName: 'canvas_open_mcp_app',
    description:
      'Connect to an external MCP server that declares a ui:// app resource, call the specified tool, and open the resulting MCP App inside a canvas mcp-app node. This is a full external-MCP transport call, not the CLI kind shortcut; use canvas_add_diagram for the built-in Excalidraw preset.',
    formatResult: (result) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }),
  },
  handler: (input, ctx) => openMcpAppCore(buildOpenMcpAppInput(input), ctx),
});

// ── diagram.open (Excalidraw preset → mcpapp.open core) ───────

const diagramShape = {
  elements: z.union([
    z.string().describe('JSON array string of Excalidraw elements'),
    z.array(z.record(z.string(), z.unknown())).describe('Array of Excalidraw elements'),
  ]).describe('Excalidraw elements to render. See https://github.com/excalidraw/excalidraw-mcp for the element format.'),
  nodeId: z.string().optional().describe('Existing Excalidraw mcp-app node ID to update in place instead of creating a new node.'),
  title: z.string().optional().describe('Optional canvas node title override'),
  x: z.number().optional().describe('X position (auto-placed if omitted)'),
  y: z.number().optional().describe('Y position (auto-placed if omitted)'),
  width: z.number().optional().describe('Width in pixels (default: 720)'),
  height: z.number().optional().describe('Height in pixels (default: 500)'),
  timeoutMs: z.number().optional().describe('Optional MCP request timeout in milliseconds for Excalidraw cold starts. Client-side MCP hosts may still enforce their own total request timeout.'),
};
const diagramSchema = z.looseObject(diagramShape);

const diagramOperation = defineOperation<z.infer<typeof diagramSchema>, OpenMcpAppCoreResult>({
  name: 'diagram.open',
  mutates: false,
  input: diagramSchema,
  inputShape: diagramShape,
  http: {
    method: 'POST',
    path: '/api/canvas/diagram',
  },
  mcp: {
    toolName: 'canvas_add_diagram',
    description:
      'Draw a hand-drawn diagram on the canvas via the hosted Excalidraw MCP app. Pass an array of Excalidraw elements (rectangles, ellipses, diamonds, arrows, text). The diagram opens inside an mcp-app node that supports fullscreen editing. For other MCP apps, use canvas_open_mcp_app.',
    formatResult: (result) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }),
  },
  handler: (input, ctx) => {
    let built;
    try {
      built = buildExcalidrawOpenMcpAppInput(input);
    } catch (error) {
      throw new OperationError(error instanceof Error ? error.message : String(error));
    }
    // Delegate to the shared open core (the SSE pair fires once — diagram.open
    // does not re-emit).
    return openMcpAppCore({
      transport: built.transport,
      toolName: built.toolName,
      toolArguments: built.toolArguments,
      serverName: built.serverName,
      ...(built.nodeId ? { nodeId: built.nodeId } : {}),
      ...(built.title ? { title: built.title } : {}),
      ...(typeof built.x === 'number' ? { x: built.x } : {}),
      ...(typeof built.y === 'number' ? { y: built.y } : {}),
      ...(typeof built.width === 'number' ? { width: built.width } : {}),
      ...(typeof built.height === 'number' ? { height: built.height } : {}),
      ...(typeof built.timeoutMs === 'number' ? { timeoutMs: built.timeoutMs } : {}),
    }, ctx);
  },
});

// ── webartifact.build ─────────────────────────────────────────

const webArtifactShape = {
  title: z.string().describe('Artifact title used for default project and output paths'),
  appTsx: z.string().describe('Contents for src/App.tsx'),
  indexCss: z.string().optional().describe('Optional contents for src/index.css'),
  mainTsx: z.string().optional().describe('Optional contents for src/main.tsx'),
  indexHtml: z.string().optional().describe('Optional contents for index.html'),
  files: z.record(z.string(), z.string()).optional().describe('Optional map of additional project-relative file paths to file contents'),
  deps: z.array(z.string()).optional().describe('Optional npm dependencies to install before bundling (e.g. ["recharts", "framer-motion@^11"]). Validated against npm-name format; flags and shell metacharacters are rejected.'),
  projectPath: z.string().optional().describe('Optional workspace-relative reusable project path. Defaults to .pmx-canvas/artifacts/.web-artifacts/<slug>'),
  outputPath: z.string().optional().describe('Optional workspace-relative HTML output path. Defaults to .pmx-canvas/artifacts/<slug>.html'),
  openInCanvas: z.boolean().optional().describe('Open the generated artifact in canvas after build (default true)'),
  includeLogs: z.boolean().optional().describe('Include raw build stdout/stderr in the response (default false)'),
  initScriptPath: z.string().optional().describe('Optional script path override for tests/debugging. Must resolve inside the workspace.'),
  bundleScriptPath: z.string().optional().describe('Optional script path override for tests/debugging. Must resolve inside the workspace.'),
  timeoutMs: z.number().optional().describe('Optional timeout in milliseconds for init and bundle commands'),
};
const webArtifactSchema = z.looseObject(webArtifactShape);

/** Shape the byte-identical web-artifact response envelope from the build result. */
function webArtifactEnvelope(
  result: WebArtifactCanvasBuildResult,
  includeLogs: boolean,
): Record<string, unknown> {
  return {
    ok: true,
    path: result.filePath,
    bytes: result.fileSize,
    projectPath: result.projectPath,
    openedInCanvas: result.openedInCanvas,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationMs: result.durationMs,
    timeoutMs: result.timeoutMs,
    // `id` is the canvas node id alias used by every other add-style response.
    // It is only present when a canvas node was actually created (openInCanvas
    // not explicitly disabled), so consumers can `'id' in response` to detect
    // the build-only case.
    ...(typeof result.nodeId === 'string' ? { id: result.nodeId } : {}),
    nodeId: result.nodeId,
    url: result.url,
    metadata: result.metadata,
    logs: result.logs,
    ...(includeLogs ? { stdout: result.stdout, stderr: result.stderr } : {}),
  };
}

const webArtifactOperation = defineOperation<z.infer<typeof webArtifactSchema>, Record<string, unknown>>({
  name: 'webartifact.build',
  // mutates:false — web-artifacts.ts emits its own canvas-layout-update on node
  // creation (the injected canvas-operations emitter); the registry must NOT
  // double-emit.
  mutates: false,
  input: webArtifactSchema,
  inputShape: webArtifactShape,
  http: {
    method: 'POST',
    path: '/api/canvas/web-artifact',
  },
  mcp: {
    toolName: 'canvas_build_web_artifact',
    description:
      'Build a bundled single-file HTML web artifact from React/Tailwind source files using the bundled web-artifacts-builder skill scripts. MCP callers pass source content in appTsx (the CLI app-file flag reads a file before calling this path). Builds can exceed default 60s MCP client timeouts on cold workspaces; set a long client timeout or retry with the same projectPath/outputPath if the client times out. Optionally opens the generated artifact as an embedded node on the canvas. Read canvas://skills/web-artifacts-builder for the full workflow, stack, and anti-slop design guidelines before calling.',
    // formatResult receives the SERIALIZED wire envelope. Legacy
    // canvas_build_web_artifact stringified a subset; the wire envelope IS that
    // subset, so re-stringify it verbatim.
    formatResult: (result) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }),
  },
  handler: async (input) => {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const appTsx = typeof input.appTsx === 'string' ? input.appTsx : '';
    if (!title || !appTsx) {
      throw new OperationError('Missing required fields: title, appTsx.');
    }

    const files: Record<string, string> = {};
    if (isRecord(input.files)) {
      for (const [pathKey, value] of Object.entries(input.files)) {
        if (typeof value === 'string') files[pathKey] = value;
      }
    }

    const includeLogs = input.includeLogs === true;
    try {
      // web-artifacts.ts emits its own canvas-layout-update on node creation (the
      // injected canvas-operations emitter), so this op stays mutates:false and
      // does not emit. The SDK buildWebArtifact calls buildWebArtifactOnCanvas
      // directly with the same runtime.
      const result = await buildWebArtifactOnCanvas({
        title,
        appTsx,
        ...(typeof input.indexCss === 'string' ? { indexCss: input.indexCss } : {}),
        ...(typeof input.mainTsx === 'string' ? { mainTsx: input.mainTsx } : {}),
        ...(typeof input.indexHtml === 'string' ? { indexHtml: input.indexHtml } : {}),
        ...(Object.keys(files).length > 0 ? { files } : {}),
        // Sandbox projectPath/outputPath to the workspace on BOTH surfaces (the
        // legacy HTTP handler used resolveWorkspacePath; the MCP tool used its
        // own safeWorkspacePath — both enforce containment). resolveWorkspacePath
        // resolves against the active canvas workspace root.
        ...(typeof input.projectPath === 'string'
          ? { projectPath: resolveWorkspacePath(input.projectPath) }
          : {}),
        ...(typeof input.outputPath === 'string'
          ? { outputPath: resolveWorkspacePath(input.outputPath) }
          : {}),
        // Script-path overrides are honored only when contained inside the
        // workspace (enforced by resolveTrustedScriptPath in
        // executeWebArtifactBuild), so they cannot point at an arbitrary host
        // script for bash execution.
        ...(typeof input.initScriptPath === 'string' ? { initScriptPath: input.initScriptPath } : {}),
        ...(typeof input.bundleScriptPath === 'string' ? { bundleScriptPath: input.bundleScriptPath } : {}),
        ...(Array.isArray(input.deps)
          ? { deps: input.deps.filter((dep): dep is string => typeof dep === 'string') }
          : {}),
        ...(typeof input.timeoutMs === 'number' ? { timeoutMs: input.timeoutMs } : {}),
        ...(typeof input.openInCanvas === 'boolean' ? { openInCanvas: input.openInCanvas } : {}),
      });
      return webArtifactEnvelope(result, includeLogs);
    } catch (error) {
      throw new OperationError(error instanceof Error ? error.message : String(error));
    }
  },
});

export const appOperations: Operation[] = [
  openMcpAppOperation,
  diagramOperation,
  webArtifactOperation,
];
