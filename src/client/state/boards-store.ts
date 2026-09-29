import { signal } from '@preact/signals';
import { requestJson } from './intent-bridge';

/**
 * Many boards (plan 012): the workspace's boards and which one is open. The
 * server is the authority; this mirrors GET /api/canvas/boards and the
 * `boards-changed` SSE frame. `activeBoardId === null` is Home.
 */
export interface BoardSummary {
  id: string;
  name: string;
  category: string | null;
  createdAt: string;
  lastOpenedAt: string | null;
  nodeCount: number;
  readmeNodeId?: string | null;
  summary?: string | null;
  pinnedTitles?: Array<{ nodeId: string; title: string }>;
  links?: Array<{ nodeId: string; boardId: string; title: string | null; missing: boolean }>;
  backlinks?: Array<{ boardId: string; title: string; nodeId: string }>;
}

interface BoardsPayload {
  activeBoardId: string | null;
  boards: BoardSummary[];
}

export const boardList = signal<BoardSummary[]>([]);
export const activeBoardId = signal<string | null>(null);
/** False until the first list arrives — Home must not flash before the server answers. */
export const boardsLoaded = signal(false);

let onBoardSwitched: (() => void) | null = null;
let boardsRevision = 0;
let openRequestSequence = 0;
let openRequestQueue: Promise<void> = Promise.resolve();

/** The SSE bridge resyncs the canvas when the open board changes under it. */
export function setBoardSwitchHandler(handler: (() => void) | null): void {
  onBoardSwitched = handler;
}

export function applyBoards(data: { activeBoardId?: unknown; boards?: unknown; reloaded?: unknown } | null): void {
  if (!data || !Array.isArray(data.boards)) return;
  boardsRevision += 1;
  const nextActive = typeof data.activeBoardId === 'string' ? data.activeBoardId : null;
  // `reloaded`: the library was restored, so even the same board id holds new content.
  const switched = boardsLoaded.value && (nextActive !== activeBoardId.value || data.reloaded === true);
  boardList.value = data.boards as BoardSummary[];
  activeBoardId.value = nextActive;
  boardsLoaded.value = true;
  if (switched) onBoardSwitched?.();
}

export async function loadBoards(): Promise<void> {
  const revision = boardsRevision;
  const payload = await requestJson<BoardsPayload | null>('loadBoards', '/api/canvas/boards', null);
  if (revision === boardsRevision) applyBoards(payload);
}

async function post(
  action: string,
  url: string,
  method: string,
  body?: unknown,
  revision = boardsRevision,
): Promise<BoardsPayload | null> {
  const payload = await requestJson<BoardsPayload | null>(action, url, null, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return revision === boardsRevision ? payload : null;
}

/** Open a board, or Home with null. */
export async function openBoard(id: string | null): Promise<void> {
  const sequence = ++openRequestSequence;
  const revision = boardsRevision;
  let payload: BoardsPayload | null = null;
  const request = openRequestQueue.then(async () => {
    payload = await post('openBoard', '/api/canvas/boards/open', 'POST', { id }, revision);
  });
  openRequestQueue = request.catch(() => undefined);
  await request;
  // post drops replies superseded by SSE; also ignore an older open request.
  if (sequence === openRequestSequence) applyBoards(payload);
}

export async function createAndOpenBoard(name: string): Promise<void> {
  const sequence = ++openRequestSequence;
  const created = await requestJson<{ board?: BoardSummary } | null>('createBoard', '/api/canvas/boards', null, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (created?.board && sequence === openRequestSequence) await openBoard(created.board.id);
}

export interface BoardCopyCard {
  id: string;
  type: string;
  title: string | null;
  reusable: boolean;
}

export interface BoardCopyPreview {
  sourceBoardId: string;
  readmeNodeId: string | null;
  cards: BoardCopyCard[];
  edges: Array<{ id: string; from: string; to: string; type: string }>;
}

export async function previewBoardCopy(sourceBoardId: string): Promise<BoardCopyPreview | null> {
  return requestJson<BoardCopyPreview | null>('previewBoardCopy', '/api/canvas/boards/from', null, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceBoardId, name: 'Preview', preview: true }),
  });
}

export async function createBoardFrom(opts: {
  sourceBoardId: string;
  name: string;
  category?: string;
  nodeIds: string[];
  includeReadme: boolean;
  includeStructure: boolean;
}): Promise<BoardSummary | null> {
  const result = await requestJson<{ board?: BoardSummary } | null>(
    'createBoardFrom',
    '/api/canvas/boards/from',
    null,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    },
  );
  await loadBoards();
  return result?.board ?? null;
}

/** Rename and/or re-file a board; `category: null` removes it from its category. */
export async function updateBoard(id: string, patch: { name?: string; category?: string | null }): Promise<void> {
  const payload = await post('updateBoard', `/api/canvas/boards/${encodeURIComponent(id)}`, 'PATCH', {
    ...patch,
    ...(patch.category === null ? { category: '' } : {}),
  });
  applyBoards(payload);
}

export async function setBoardReadme(id: string, readmeNodeId: string | null): Promise<void> {
  const payload = await post('setBoardReadme', `/api/canvas/boards/${encodeURIComponent(id)}`, 'PATCH', {
    readmeNodeId,
  });
  applyBoards(payload);
}

export async function deleteBoard(id: string): Promise<void> {
  const payload = await post('deleteBoard', `/api/canvas/boards/${encodeURIComponent(id)}`, 'DELETE');
  applyBoards(payload);
}

export function activeBoard(): BoardSummary | null {
  return boardList.value.find((board) => board.id === activeBoardId.value) ?? null;
}
