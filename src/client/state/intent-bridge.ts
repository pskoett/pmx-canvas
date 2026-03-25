/** Dispatch user intents from the canvas to the server (for TUI consumption). */
export async function sendIntent(
  type: string,
  payload: Record<string, unknown> = {},
): Promise<{ ok: boolean }> {
  try {
    const res = await fetch('/api/workbench/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload }),
    });
    return (await res.json()) as { ok: boolean };
  } catch {
    return { ok: false };
  }
}

/** Fetch rendered markdown HTML from the server. */
export async function renderMarkdown(markdown: string): Promise<string> {
  try {
    const res = await fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown }),
    });
    const data = (await res.json()) as { html: string };
    return data.html || '';
  } catch {
    return '';
  }
}

/** Fetch file content from the server. */
export async function fetchFile(path: string): Promise<{
  content: string;
  provenance?: unknown;
}> {
  try {
    const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
    return (await res.json()) as { content: string; provenance?: unknown };
  } catch {
    return { content: '' };
  }
}

/** Save file content to the server. */
export async function saveFile(
  path: string,
  content: string,
): Promise<{ ok: boolean; updatedAt?: string }> {
  try {
    const res = await fetch('/api/file/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
    });
    return (await res.json()) as { ok: boolean; updatedAt?: string };
  } catch {
    return { ok: false };
  }
}

/** Fetch current workbench state. */
export async function fetchWorkbenchState(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch('/api/workbench/state');
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Open a markdown file in the workbench/canvas. */
export async function openWorkbenchFile(path: string): Promise<{ ok: boolean }> {
  try {
    const res = await fetch('/api/workbench/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

/** Fetch canvas state from server. */
export async function fetchCanvasState(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch('/api/canvas/state');
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Push canvas node updates to server. */
export async function pushCanvasUpdate(
  updates: Array<{
    id: string;
    position?: { x: number; y: number };
    size?: { width: number; height: number };
    collapsed?: boolean;
  }>,
): Promise<void> {
  try {
    await fetch('/api/canvas/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    });
  } catch {
    /* best-effort sync */
  }
}

/** Create a canvas edge via the server. */
export async function createEdgeFromClient(
  from: string,
  to: string,
  type: string,
  label?: string,
): Promise<{ ok: boolean; id?: string }> {
  try {
    const res = await fetch('/api/canvas/edge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, type, label }),
    });
    return (await res.json()) as { ok: boolean; id?: string };
  } catch {
    return { ok: false };
  }
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
  try {
    const res = await fetch('/api/canvas/snapshots');
    return (await res.json()) as CanvasSnapshotInfo[];
  } catch {
    return [];
  }
}

export async function saveSnapshot(name: string): Promise<{ ok: boolean; snapshot?: CanvasSnapshotInfo }> {
  try {
    const res = await fetch('/api/canvas/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return (await res.json()) as { ok: boolean; snapshot?: CanvasSnapshotInfo };
  } catch {
    return { ok: false };
  }
}

export async function restoreSnapshot(id: string): Promise<{ ok: boolean }> {
  try {
    const res = await fetch(`/api/canvas/snapshots/${id}`, { method: 'POST' });
    return (await res.json()) as { ok: boolean };
  } catch {
    return { ok: false };
  }
}

export async function deleteSnapshot(id: string): Promise<{ ok: boolean }> {
  try {
    const res = await fetch(`/api/canvas/snapshots/${id}`, { method: 'DELETE' });
    return (await res.json()) as { ok: boolean };
  } catch {
    return { ok: false };
  }
}

/** Remove a canvas edge via the server. */
export async function removeEdgeFromClient(edgeId: string): Promise<{ ok: boolean }> {
  try {
    const res = await fetch('/api/canvas/edge', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edge_id: edgeId }),
    });
    return (await res.json()) as { ok: boolean };
  } catch {
    return { ok: false };
  }
}
