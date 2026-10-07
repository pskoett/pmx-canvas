import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { listOperations, OperationError } from '../server/operations/index.js';
import { matchOperationPath, readOperationInput } from '../server/operations/http.js';
import type { CanvasAccess } from './canvas-access.js';

// Explicitly bounded to workbench operations. No shell, automation, arbitrary
// HTTP proxy, external MCP tool calls, or caller-supplied authority headers.
const writes = new Set([
  'board.create',
  'board.open',
  'board.update',
  'board.pin',
  'board.unpin',
  'board.create-from',
  'board.delete',
  'node.add',
  'jsonrender.add',
  'graph.add',
  'node.update',
  'node.remove',
  'node.refresh',
  'edge.add',
  'edge.update',
  'edge.remove',
  'group.create',
  'group.add',
  'group.remove',
  'pin.set',
  'annotation.add',
  'annotation.remove',
  'theme.set',
  'viewport.set',
  'canvas.apply-updates',
  'canvas.clear',
  'arrange',
  'node.focus',
  'view.fit',
  'snapshot.save',
  'snapshot.restore',
  'snapshot.delete',
  'tour.set',
  'tour.go',
  'tour.exit',
  'ax.focus.set',
  'ax.policy.set',
  'ax.work.create',
  'ax.work.update',
  'ax.review.add',
  'ax.review.update',
  'ax.elicitation.respond',
  'ax.mode.resolve',
  'ax.steer',
  'ax.event.record',
  'ax.presence.set',
  'ax.interaction.submit',
  'intent.clear',
  'import.request',
  'import.cancel',
  'import.commit',
  'export.run',
]);

function readableAsset(path: string): boolean {
  return (
    [
      '/health',
      '/api/workbench/poll',
      '/api/workbench/state',
      '/api/file',
      '/api/canvas/json-render/view',
      '/api/canvas/file-bytes',
    ].includes(path) ||
    /^\/api\/canvas\/(surface|image|frame-documents|exports)\/[^/]+$/.test(path) ||
    /^\/api\/canvas\/attachments\/[^/]+\/bytes$/.test(path)
  );
}

/** HTTP-shaped replies let the real workbench retain its existing API contracts. */
export function registerWorkbenchApp(server: McpServer, ensureCanvas: () => Promise<CanvasAccess>): void {
  server.registerTool(
    'pmx_workbench_request',
    {
      title: 'PMX workbench transport',
      description: 'App-only transport for the PMX workbench. Not an assistant tool.',
      inputSchema: {
        path: z.string().max(8192),
        method: z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD']),
        body: z.string().max(4_000_000).optional(),
        expectedBoardId: z.string().nullable(),
      },
      // Workbench webpage/image actions can fetch user-chosen external URLs.
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      _meta: { ui: { visibility: ['app'] } },
    },
    async (input) => {
      const reply = (status: number, body: string, contentType = 'application/json', encoding = 'text') => ({
        content: [
          { type: 'text' as const, text: status < 400 ? 'Workbench request completed.' : 'Workbench request refused.' },
        ],
        _meta: { response: { status, body, contentType, encoding } },
      });
      try {
        const canvas = await ensureCanvas();
        const base = canvas.remoteBaseUrl ?? `http://127.0.0.1:${canvas.port}`;
        const url = new URL(input.path, base);
        if (
          !input.path.startsWith('/') ||
          input.path.startsWith('//') ||
          input.path.includes('\\') ||
          url.origin !== new URL(base).origin ||
          url.username ||
          url.password ||
          url.hash
        ) {
          throw new OperationError('Only local PMX workbench paths are allowed.', 403);
        }
        const req = new Request(url, {
          method: input.method,
          headers: { 'Content-Type': 'application/json' },
          ...(input.body === undefined ? {} : { body: input.body }),
        });
        for (const op of listOperations()) {
          const route = op.http;
          if (!route || route.method !== input.method) continue;
          const params = matchOperationPath(route.path, url.pathname);
          if (!params) continue;
          if (!url.pathname.startsWith('/api/canvas/') || (input.method !== 'GET' && !writes.has(op.name)))
            throw new OperationError('This action requires the local PMX workbench.', 403);
          const args = route.readInput
            ? await route.readInput(req, params, url)
            : await readOperationInput(req, params, url);
          if (input.method !== 'GET') args.expectedBoardId = input.expectedBoardId;
          // This profile is one agent transport, never browser/system authority
          // or a caller-selected writer whose wider territory could bypass a fence.
          args.source = 'mcp';
          delete args.agentId;
          if (
            op.name === 'ax.interaction.submit' &&
            (args.type === 'ax.approval.resolve' || args.type === 'ax.flow.materialize')
          )
            throw new OperationError('Resolve approvals and materialize flows in the local PMX workbench.', 403);
          if (op.name === 'node.add' || op.name === 'node.update') {
            const data = args.data;
            const nodeType = op.name === 'node.add' ? args.type : (await canvas.getNode(String(args.id)))?.type;
            // Trace tool names describe past activity; they never launch a backend.
            const launchFields = ['transportConfig', 'toolInput', 'serverName', 'appSessionId'];
            if (nodeType !== 'trace') launchFields.push('toolName');
            if (
              (op.name === 'node.add' && args.type === 'mcp-app') ||
              (data && typeof data === 'object' && launchFields.some((field) => field in data))
            )
              throw new OperationError('Configure external MCP apps in the local PMX workbench.', 403);
          }
          if (
            op.name === 'node.update' &&
            ('content' in args || (args.data && typeof args.data === 'object' && 'content' in args.data))
          ) {
            if (typeof args.expectedContentRevision !== 'number')
              throw new OperationError('Read the note before editing: a content revision is required.', 409);
            const node = await canvas.getNode(String(args.id));
            if (node?.data.path) throw new OperationError('Edit file-linked content in the local PMX workbench.', 403);
          }
          const result = await canvas.invoker().invoke(op.name, args);
          return reply(route.status ? route.status(result) : 200, JSON.stringify(result));
        }
        if (
          !((input.method === 'GET' || input.method === 'HEAD') && readableAsset(url.pathname)) &&
          !(input.method === 'POST' && url.pathname === '/api/render')
        ) {
          throw new OperationError('This action requires the local PMX workbench.', 403);
        }
        // Resolve only PMX's internal surface redirects. Never follow to arbitrary
        // hosts or return the workbench HTML (which carries its human boot token).
        let target = url;
        let response: Response | undefined;
        for (let redirects = 0; redirects < 3; redirects++) {
          response = await fetch(target, {
            method: input.method,
            body: input.body,
            headers: { 'Content-Type': 'application/json' },
            redirect: 'manual',
            signal: AbortSignal.timeout(15_000),
          });
          if (response.status < 300 || response.status >= 400) break;
          const next = new URL(response.headers.get('location') ?? '', target);
          if (next.origin !== url.origin || !readableAsset(next.pathname))
            throw new OperationError('External surfaces must be opened outside the embedded workbench.', 403);
          target = next;
        }
        if (!response || (response.status >= 300 && response.status < 400))
          throw new OperationError('Could not resolve the PMX surface.');
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 24 * 1024 * 1024)
          throw new OperationError('This asset is too large for the MCP connection.');
        const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
        const text = /^(text\/|application\/(json|javascript))/.test(contentType);
        return reply(
          response.status,
          text ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString('base64'),
          contentType,
          text ? 'text' : 'base64',
        );
      } catch (error) {
        if (error instanceof OperationError)
          return reply(error.status, JSON.stringify({ ok: false, error: error.message }));
        console.error('[workbench-app] request failed', error);
        return reply(
          502,
          JSON.stringify({ ok: false, error: 'PMX workbench request failed. Check the daemon and retry.' }),
        );
      }
    },
  );
}
