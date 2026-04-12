function logRequestError(action: string, error: unknown): void {
  console.error(`[intent-bridge] ${action} failed`, error);
}

async function requestJson<T>(
  action: string,
  url: string,
  fallback: T,
  init?: RequestInit,
): Promise<T> {
  try {
    const res = await fetch(url, init);
    return (await res.json()) as T;
  } catch (error) {
    logRequestError(action, error);
    return fallback;
  }
}

async function requestOk(
  action: string,
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean }> {
  try {
    const res = await fetch(url, init);
    return { ok: res.ok };
  } catch (error) {
    logRequestError(action, error);
    return { ok: false };
  }
}

async function requestBestEffort(
  action: string,
  url: string,
  init?: RequestInit,
): Promise<void> {
  try {
    await fetch(url, init);
  } catch (error) {
    logRequestError(action, error);
  }
}

/** Dispatch user intents from the canvas to the server (for TUI consumption). */
export async function sendIntent(
  type: string,
  payload: Record<string, unknown> = {},
): Promise<{ ok: boolean }> {
  return requestJson('sendIntent', '/api/workbench/intent', { ok: false }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload }),
  });
}

/** Fetch rendered markdown HTML from the server. */
export async function renderMarkdown(markdown: string): Promise<string> {
  const data = await requestJson<{ html?: string }>('renderMarkdown', '/api/render', {}, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown }),
  });
  return data.html ?? '';
}

/** Fetch file content from the server. */
export async function fetchFile(path: string): Promise<{
  content: string;
  provenance?: unknown;
}> {
  return requestJson('fetchFile', `/api/file?path=${encodeURIComponent(path)}`, { content: '' });
}

/** Save file content to the server. */
export async function saveFile(
  path: string,
  content: string,
): Promise<{ ok: boolean; updatedAt?: string }> {
  return requestJson('saveFile', '/api/file/save', { ok: false }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
}

/** Fetch current workbench state. */
export async function fetchWorkbenchState(): Promise<Record<string, unknown>> {
  return requestJson('fetchWorkbenchState', '/api/workbench/state', {});
}

/** Open a markdown file in the workbench/canvas. */
export async function openWorkbenchFile(path: string): Promise<{ ok: boolean }> {
  return requestOk('openWorkbenchFile', '/api/workbench/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
}

/** Fetch canvas state from server. */
export async function fetchCanvasState(): Promise<Record<string, unknown>> {
  return requestJson('fetchCanvasState', '/api/canvas/state', {});
}

/** Fetch available slash commands for prompt completion. */
export async function fetchSlashCommands(): Promise<Array<{ name: string; description: string }>> {
  return [];
}

/** Submit a new canvas prompt. */
export async function submitCanvasPrompt(
  text: string,
  position?: { x: number; y: number },
  parentNodeId?: string,
  contextNodeIds?: string[],
  threadNodeId?: string,
): Promise<{ ok: boolean; nodeId?: string; error?: string }> {
  if (!text.trim()) return { ok: false, error: 'Prompt text is required' };
  return requestJson('submitCanvasPrompt', '/api/canvas/prompt', { ok: false, error: 'Network error' }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      ...(position ? { position } : {}),
      ...(parentNodeId ? { parentNodeId } : {}),
      ...(contextNodeIds && contextNodeIds.length > 0 ? { contextNodeIds } : {}),
      ...(threadNodeId ? { threadNodeId } : {}),
    }),
  });
}

/** Submit a reply into an existing prompt thread. */
export async function submitThreadReply(
  threadNodeId: string,
  text: string,
): Promise<{ ok: boolean; nodeId?: string; error?: string }> {
  return submitCanvasPrompt(text, undefined, undefined, undefined, threadNodeId);
}

/** Push canvas node updates to server. */
export async function pushCanvasUpdate(
  updates: Array<{
    id: string;
    position?: { x: number; y: number };
    size?: { width: number; height: number };
    collapsed?: boolean;
    dockPosition?: 'left' | 'right' | null;
  }>,
): Promise<void> {
  await requestBestEffort('pushCanvasUpdate', '/api/canvas/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates }),
  });
}

/** Create a canvas edge via the server. */
export async function createEdgeFromClient(
  from: string,
  to: string,
  type: string,
  label?: string,
): Promise<{ ok: boolean; id?: string }> {
  return requestJson('createEdgeFromClient', '/api/canvas/edge', { ok: false }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, type, label }),
  });
}

/** Create a canvas node via the server. Returns the new node ID. */
export async function createNodeFromClient(opts: {
  type?: string;
  title?: string;
  content?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): Promise<{ ok: boolean; id?: string }> {
  return requestJson('createNodeFromClient', '/api/canvas/node', { ok: false }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
}

/** Update a canvas node via the server. */
export async function updateNodeFromClient(
  id: string,
  patch: {
    position?: { x: number; y: number };
    size?: { width: number; height: number };
    collapsed?: boolean;
    pinned?: boolean;
    dockPosition?: 'left' | 'right' | null;
    title?: string;
    content?: string;
    data?: Record<string, unknown>;
  },
): Promise<{ ok: boolean; id?: string }> {
  return requestJson('updateNodeFromClient', `/api/canvas/node/${encodeURIComponent(id)}`, { ok: false }, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** Refresh a webpage node from its persisted URL on the server. */
export async function refreshWebpageNodeFromClient(
  id: string,
  url?: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  return requestJson('refreshWebpageNodeFromClient', `/api/canvas/node/${encodeURIComponent(id)}/refresh`, { ok: false }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(url ? { url } : {}),
  });
}

/** Remove a canvas node via the server. */
export async function removeNodeFromClient(id: string): Promise<{ ok: boolean; removed?: string }> {
  return requestJson('removeNodeFromClient', `/api/canvas/node/${encodeURIComponent(id)}`, { ok: false }, {
    method: 'DELETE',
  });
}

/** Commit the current viewport to the authoritative server state. */
export async function updateViewportFromClient(
  viewport: { x: number; y: number; scale: number },
): Promise<{ ok: boolean }> {
  return requestJson('updateViewportFromClient', '/api/canvas/viewport', { ok: false }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(viewport),
  });
}

// ── Group API ─────────────────────────────────────────────────

/** Create a group containing the given child node IDs. */
export async function createGroupFromClient(opts: {
  title?: string;
  childIds?: string[];
  color?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): Promise<{ ok: boolean; id?: string }> {
  return requestJson('createGroupFromClient', '/api/canvas/group', { ok: false }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
}

/** Add nodes to an existing group. */
export async function addToGroupFromClient(groupId: string, childIds: string[]): Promise<{ ok: boolean }> {
  return requestJson('addToGroupFromClient', '/api/canvas/group/add', { ok: false }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId, childIds }),
  });
}

/** Ungroup all children from a group. */
export async function ungroupFromClient(groupId: string): Promise<{ ok: boolean }> {
  return requestJson('ungroupFromClient', '/api/canvas/group/ungroup', { ok: false }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId }),
  });
}

// ── Snapshot API ──────────────────────────────────────────────

export interface CanvasSnapshotInfo {
  id: string;
  name: string;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
}

export async function listSnapshots(): Promise<CanvasSnapshotInfo[]> {
  return requestJson<CanvasSnapshotInfo[]>('listSnapshots', '/api/canvas/snapshots', []);
}

export async function saveSnapshot(name: string): Promise<{ ok: boolean; snapshot?: CanvasSnapshotInfo }> {
  return requestJson('saveSnapshot', '/api/canvas/snapshots', { ok: false }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function restoreSnapshot(id: string): Promise<{ ok: boolean }> {
  return requestJson('restoreSnapshot', `/api/canvas/snapshots/${id}`, { ok: false }, { method: 'POST' });
}

export async function deleteSnapshot(id: string): Promise<{ ok: boolean }> {
  return requestJson('deleteSnapshot', `/api/canvas/snapshots/${id}`, { ok: false }, { method: 'DELETE' });
}

/** Remove a canvas edge via the server. */
export async function removeEdgeFromClient(edgeId: string): Promise<{ ok: boolean }> {
  return requestJson('removeEdgeFromClient', '/api/canvas/edge', { ok: false }, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edge_id: edgeId }),
  });
}
