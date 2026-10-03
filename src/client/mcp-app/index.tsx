import '../uuid-polyfill';
import { App as McpApp } from '@modelcontextprotocol/ext-apps';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { z } from 'zod';
import { App as Workbench } from '../App';
import { activeBoardId, boardList, boardsLoaded } from '../state/boards-store';
import { axSurfaceState, contextPinnedNodeIds, nodes, selectedNodeIds } from '../state/canvas-store';
import { installWorkbenchDownload, installWorkbenchTransport } from '../state/workbench-transport';
import { resolveIframeMode } from '../state/iframe-mode';
import { summarizeNodeForAgentContext } from '../../shared/agent-context';
import { canvasAppContext } from '../../shared/canvas-app';

const bridge = new McpApp(
  { name: 'PMX Canvas', version: '1.0.0' },
  { availableDisplayModes: ['inline', 'fullscreen'] },
);
const responseSchema = z.object({
  status: z.number(),
  body: z.string(),
  contentType: z.string(),
  encoding: z.enum(['text', 'base64']),
});

// Preserve the workbench's fetch/Response contracts, without passing its human
// headers or exposing the daemon URL to the embedded browser.
installWorkbenchTransport(async (input, init) => {
  const path = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (init?.body !== undefined && typeof init.body !== 'string')
    return Response.json({ ok: false, error: 'Document uploads require the local PMX workbench.' }, { status: 403 });
  init?.signal?.throwIfAborted();
  const result = await bridge.callServerTool({
    name: 'pmx_workbench_request',
    arguments: {
      path,
      method,
      ...(init?.body === undefined ? {} : { body: init.body }),
      expectedBoardId: activeBoardId.value,
    },
  });
  init?.signal?.throwIfAborted();
  const response = responseSchema.parse(result._meta?.response);
  const body =
    response.encoding === 'base64' ? Uint8Array.from(atob(response.body), (char) => char.charCodeAt(0)) : response.body;
  return new Response(method === 'HEAD' || response.status === 204 ? null : body, {
    status: response.status,
    headers: { 'Content-Type': response.contentType },
  });
});

const focusSchema = z.object({ focus: z.array(z.string()) });

function selectionContext() {
  const focus = focusSchema.safeParse(axSurfaceState.value);
  return canvasAppContext(
    {
      boardId: activeBoardId.value,
      boardName: boardList.value.find((board) => board.id === activeBoardId.value)?.name ?? 'Home',
      pinnedNodeIds: [...contextPinnedNodeIds.value],
      nodes: [...nodes.value.values()].map((node) => ({
        id: node.id,
        type: node.type,
        title: typeof node.data.title === 'string' ? node.data.title : node.type,
        contentRevision: node.contentRevision ?? 0,
        text: summarizeNodeForAgentContext(node),
      })),
    },
    [...selectedNodeIds.value],
    focus.success ? focus.data.focus : [],
  );
}

function HostedWorkbench() {
  const [acknowledged, setAcknowledged] = useState('');
  const [retry, setRetry] = useState(0);
  const queue = useRef(Promise.resolve());
  const context = selectionContext();
  const key = JSON.stringify(context);
  const desired = useRef(key);
  desired.current = key;
  const caps = bridge.getHostCapabilities();
  const ready = boardsLoaded.value;
  useEffect(() => {
    if (!ready || !caps?.updateModelContext || acknowledged === key) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    queue.current = queue.current
      .then(async () => {
        if (cancelled || desired.current !== key) return;
        setAcknowledged('');
        await bridge.updateModelContext({ structuredContent: context });
        if (cancelled || desired.current !== key) return;
        setAcknowledged(key);
      })
      .catch(() => {
        // Context is background synchronization, not extra workbench chrome.
        // Retry unchanged context too, and only consider a host ACK successful.
        if (!cancelled && desired.current === key) timer = setTimeout(() => setRetry((value) => value + 1), 2000);
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, ready, retry]);
  return (
    <div class="pmx-host-app">
      <Workbench />
    </div>
  );
}

// Polling is the sole state owner. Launcher tool results never rehydrate the
// workbench, so delayed initial notifications cannot roll back its live state.
bridge.ontoolresult = () => {};
void bridge
  .connect()
  .then(async () => {
    if (!bridge.getHostCapabilities()?.serverTools) throw new Error('This host does not support app tool calls.');
    if (bridge.getHostCapabilities()?.downloadFile) {
      installWorkbenchDownload((file) =>
        bridge.downloadFile({
          contents: [
            {
              type: 'resource',
              resource: { uri: `file:///${encodeURIComponent(file.name)}`, mimeType: file.mimeType, text: file.text },
            },
          ],
        }),
      );
    }
    await resolveIframeMode();
    render(<HostedWorkbench />, document.getElementById('app')!);
  })
  .catch((error: unknown) => {
    document.getElementById('app')!.textContent = `Could not connect PMX: ${String(error)}`;
  });
