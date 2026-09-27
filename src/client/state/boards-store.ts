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
  createdAt: string;
  lastOpenedAt: string | null;
  nodeCount: number;
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

/** The SSE bridge resyncs the canvas when the open board changes under it. */
export function setBoardSwitchHandler(handler: (() => void) | null): void {
  onBoardSwitched = handler;
}

export function applyBoards(data: { activeBoardId?: unknown; boards?: unknown; reloaded?: unknown } | null): void {
  if (!data || !Array.isArray(data.boards)) return;
  const nextActive = typeof data.activeBoardId === 'string' ? data.activeBoardId : null;
  // `reloaded`: the library was restored, so even the same board id holds new content.
  const switched = boardsLoaded.value && (nextActive !== activeBoardId.value || data.reloaded === true);
  boardList.value = data.boards as BoardSummary[];
  activeBoardId.value = nextActive;
  boardsLoaded.value = true;
  if (switched) onBoardSwitched?.();
}

export async function loadBoards(): Promise<void> {
  const payload = await requestJson<BoardsPayload | null>('loadBoards', '/api/canvas/boards', null);
  applyBoards(payload);
}

function post(action: string, url: string, method: string, body?: unknown): Promise<BoardsPayload | null> {
  return requestJson<BoardsPayload | null>(action, url, null, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Open a board, or Home with null. */
export async function openBoard(id: string | null): Promise<void> {
  const payload = await post('openBoard', '/api/canvas/boards/open', 'POST', { id });
  applyBoards(payload);
}

export async function createAndOpenBoard(name: string): Promise<void> {
  const created = await requestJson<{ board?: BoardSummary } | null>('createBoard', '/api/canvas/boards', null, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (created?.board) await openBoard(created.board.id);
}

export async function renameBoard(id: string, name: string): Promise<void> {
  const payload = await post('renameBoard', `/api/canvas/boards/${encodeURIComponent(id)}`, 'PATCH', { name });
  applyBoards(payload);
}

export async function deleteBoard(id: string): Promise<void> {
  const payload = await post('deleteBoard', `/api/canvas/boards/${encodeURIComponent(id)}`, 'DELETE');
  applyBoards(payload);
}

export function activeBoard(): BoardSummary | null {
  return boardList.value.find((board) => board.id === activeBoardId.value) ?? null;
}
