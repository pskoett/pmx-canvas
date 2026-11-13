import { fileURLToPath } from 'node:url';
import { canvasState, type PersistedBlobRef } from '../../src/server/canvas-state.ts';
import { intentRegistry } from '../../src/server/intent-registry.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

// Shared by the server-api*.test.ts suites. Each suite owns one disposable workspace, one
// port-0 canvas server and one local webpage fixture; suites never run a server concurrently
// because they share the process-wide canvasState singleton.

export interface CanvasStateResponse {
  viewport?: { x: number; y: number; scale: number };
  nodes: Array<{
    id: string;
    type: string;
    kind?: string;
    pinned?: boolean;
    position?: { x: number; y: number };
    data: Record<string, unknown>;
  }>;
  edges: Array<{ id: string; from: string; to: string; type: string }>;
  annotations?: Array<{ id: string; type?: string; color: string; pointCount?: number; text?: string }>;
}

export interface BlobSummary {
  stored: 'sidecar';
  path: string;
  bytes: number;
  jsonBytes: number;
  sha256: string;
}

export function isBlobSummary(value: unknown): value is BlobSummary {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { stored?: unknown }).stored === 'sidecar'
  );
}

export function isBlobReference(value: unknown): value is PersistedBlobRef {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { __pmxCanvasBlob?: unknown }).__pmxCanvasBlob === 'v1'
  );
}

export interface WorkbenchWebViewStatusResponse {
  supported: boolean;
  active: boolean;
  headlessOnly: true;
  url: string | null;
  backend: 'webkit' | 'chrome' | null;
  width: number | null;
  height: number | null;
  dataStoreDir: string | null;
  startedAt: string | null;
  lastError: string | null;
}

export async function waitForNode(
  baseUrl: string,
  predicate: (node: CanvasStateResponse['nodes'][number]) => boolean,
  attempts = 60,
  delayMs = 100,
): Promise<CanvasStateResponse['nodes'][number] | null> {
  for (let index = 0; index < attempts; index++) {
    const response = await fetch(`${baseUrl}/api/canvas/state`);
    if (response.ok) {
      const state = (await response.json()) as CanvasStateResponse;
      const match = state.nodes.find(predicate);
      if (match) return match;
    }
    await Bun.sleep(delayMs);
  }
  return null;
}

export async function readSseEvent(
  baseUrl: string,
  eventName: string,
  timeoutMs = 3000,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/workbench/events`, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error('Failed to connect to workbench SSE.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let frameEnd = buffer.indexOf('\n\n');
      while (frameEnd !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const event = frame.match(/^event: (.+)$/m)?.[1];
        const data = frame.match(/^data: (.+)$/m)?.[1];
        if (event === eventName && data) return JSON.parse(data) as Record<string, unknown>;
        frameEnd = buffer.indexOf('\n\n');
      }
    }
    throw new Error(`SSE event "${eventName}" was not received.`);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

export const fixtureMcpAppServerPath = fileURLToPath(new URL('../fixtures/mcp-app-fixture.ts', import.meta.url));
export const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export interface ServerApiSuite {
  workspaceRoot: string;
  baseUrl: string;
  webpageOrigin: string;
  webpageServer: ReturnType<typeof Bun.serve>;
  previousExcalidrawCommand: string | undefined;
}

export function startServerApiSuite(workspacePrefix: string): ServerApiSuite {
  const workspaceRoot = createTestWorkspace(workspacePrefix);
  resetCanvasForTests(workspaceRoot);
  const previousExcalidrawCommand = process.env.PMX_CANVAS_EXCALIDRAW_MCP_COMMAND;
  // Diagram tests must never round-trip to the hosted Excalidraw MCP server
  // (plan-009 M8: it intermittently times out under parallel load); the local
  // stdio fixture implements the same create_view contract.
  process.env.PMX_CANVAS_EXCALIDRAW_MCP_COMMAND = `bun run ${fixtureMcpAppServerPath}`;
  const baseUrl = startCanvasServer({ workspaceRoot, port: 0 });
  if (!baseUrl) {
    throw new Error('Failed to start canvas server for tests.');
  }

  const webpageServer = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/article-long') {
        const sections = Array.from(
          { length: 24 },
          (_, index) =>
            `<p>Long-form webpage section ${index + 1}. This is persistent context for agent grounding and should survive truncation better than the old excerpt-only path.</p>`,
        ).join('\n');
        return new Response(
          `<!doctype html>
<html>
  <head>
    <title>Long Canvas Webpage</title>
    <meta name="description" content="Long webpage node fixture" />
  </head>
  <body>
    <main>
      <h1>Long Canvas Webpage</h1>
      ${sections}
    </main>
  </body>
</html>`,
          {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          },
        );
      }
      if (url.pathname === '/article') {
        const version = url.searchParams.get('v') ?? '1';
        const title = version === '2' ? 'Canvas Webpage v2' : 'Canvas Webpage v1';
        const body =
          version === '2'
            ? 'Updated webpage content for saved canvas refresh.'
            : 'Initial webpage content for canvas grounding.';
        return new Response(
          `<!doctype html>
<html>
  <head>
    <title>${title}</title>
    <meta name="description" content="Webpage node fixture ${version}" />
    <meta property="og:image" content="/image-${version}.png" />
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${body}</p>
      <p>Supplemental text block ${version}.</p>
    </main>
  </body>
</html>`,
          {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          },
        );
      }
      if (url.pathname === '/article-frame-blocked') {
        return new Response(
          `<!doctype html>
<html>
  <head>
    <title>Frame Blocked Fixture</title>
    <meta name="description" content="Frame blocked webpage node fixture" />
  </head>
  <body>
    <main>
      <h1>Frame Blocked Fixture</h1>
      <p>This page is readable by the server but not embeddable in an iframe.</p>
    </main>
  </body>
</html>`,
          {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'X-Frame-Options': 'SAMEORIGIN',
            },
          },
        );
      }
      return new Response('missing', { status: 404 });
    },
  });
  return {
    workspaceRoot,
    baseUrl,
    webpageOrigin: `http://127.0.0.1:${webpageServer.port}`,
    webpageServer,
    previousExcalidrawCommand,
  };
}

export function stopServerApiSuite(suite: ServerApiSuite): void {
  stopCanvasServer();
  suite.webpageServer.stop(true);
  removeTestWorkspace(suite.workspaceRoot);
  if (suite.previousExcalidrawCommand === undefined) delete process.env.PMX_CANVAS_EXCALIDRAW_MCP_COMMAND;
  else process.env.PMX_CANVAS_EXCALIDRAW_MCP_COMMAND = suite.previousExcalidrawCommand;
}

export function resetServerApiState(): void {
  intentRegistry.reset();
  canvasState.withSuppressedRecording(() => {
    canvasState.clear();
    canvasState.setTheme('harbor');
  });
  canvasState.clearAllSnapshots();
  mutationHistory.reset();
}
