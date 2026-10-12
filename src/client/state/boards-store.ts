import { batch, signal } from '@preact/signals';
import { requestJson } from './intent-bridge';
import { focusNode, hasInitialServerLayout, nodes } from './canvas-store';
import type { MemoryTarget } from '../../shared/memory-graph.js';
import type { RelationDefinition } from '../../shared/relations.js';

/**
 * Many boards (plan 012): the workspace's boards and which one is open. The
 * server is the authority; this mirrors GET /api/canvas/boards and the
 * `boards-changed` SSE frame. Null means no server board is open; browsingMemory
 * separately keeps a human in the library while agents open boards.
 */
export interface BoardSummary {
  id: string;
  name: string;
  folder: string | null;
  createdAt: string;
  lastOpenedAt: string | null;
  nodeCount: number;
  readmeNodeId?: string | null;
  mapPosition?: { x: number; y: number } | null;
  previousBoardId?: string | null;
  relationVocabulary?: RelationDefinition[];
  summary?: string | null;
  pinnedTitles?: Array<{ nodeId: string; title: string }>;
  links?: Array<{
    id?: string;
    nodeId: string;
    boardId: string;
    cardId?: string;
    cardTitle?: string | null;
    title: string | null;
    missing: boolean;
    kind?: string;
  }>;
  backlinks?: Array<{ id?: string; boardId: string; title: string; nodeId: string; cardId?: string; kind?: string }>;
  /** Home thumbnail (docs/design/Home.dc.html): cards as 0–1 rectangles of the board's extent. */
  preview?: Array<{ x: number; y: number; w: number; h: number; pinned?: true }>;
  /** Roughly what this board's map costs in the brief when pinned (README + pinned card summaries). */
  mapChars?: number;
  /** In the agent's working set (vision move 0a); null when not pinned. */
  pin?: { pinnedBy: { actor: string; source: string; agentId?: string }; pinnedAt: string; reason?: string } | null;
}

interface BoardsPayload {
  catalogEpoch: string;
  catalogRevision: number;
  reloadRevision: number;
  boardGeneration: number;
  activeBoardId: string | null;
  boards: BoardSummary[];
}

export const boardList = signal<BoardSummary[]>([]);
export const activeBoardId = signal<string | null>(null);
/** An explicitly opened library view stays visible while agents switch boards. */
export const browsingMemory = signal(false);
/** Layout/pin/reconnect invalidation for the library's shared graph projection. */
export const memoryGraphRevision = signal(0);
/** False until the first list arrives — Home must not flash before the server answers. */
export const boardsLoaded = signal(false);

let onBoardSwitched: ((initial: boolean) => void) | null = null;
export let catalogEpoch: string | null = null;
export let boardGeneration: number | null = null;
/** Invalidates suspended writes when the canonical board/library is replaced. */
export let boardIncarnation = 0;
let catalogRevision = 0;
let reloadRevision: number | null = null;
let openRequestSequence = 0;
let openRequestQueue: Promise<void> = Promise.resolve();
let navigationSequence = 0;

/** Only the current transport's connected handshake may replace the server epoch. */
export function connectBoardCatalog(epoch: string): void {
  if (epoch === catalogEpoch) return;
  catalogEpoch = epoch;
  boardGeneration = null;
  boardIncarnation++;
  catalogRevision = 0;
  reloadRevision = null;
  openRequestSequence++;
  navigationSequence++;
}

/** The SSE bridge resyncs the canvas when the open board changes under it. */
export function setBoardSwitchHandler(handler: ((initial: boolean) => void) | null): void {
  onBoardSwitched = handler;
}

export function applyBoards(
  data: {
    activeBoardId?: unknown;
    boards?: unknown;
    catalogEpoch?: unknown;
    catalogRevision?: unknown;
    reloadRevision?: unknown;
    boardGeneration?: unknown;
  } | null,
): void {
  if (
    !data ||
    !Array.isArray(data.boards) ||
    data.catalogEpoch !== catalogEpoch ||
    typeof data.catalogRevision !== 'number' ||
    typeof data.reloadRevision !== 'number' ||
    data.catalogRevision <= catalogRevision
  )
    return;
  catalogRevision = data.catalogRevision;
  const nextActive = typeof data.activeBoardId === 'string' ? data.activeBoardId : null;
  const initial = !boardsLoaded.value;
  const establishesGeneration = boardGeneration === null && typeof data.boardGeneration === 'number';
  // A restore stays observable even when a later GET overtakes its notification.
  const switched =
    !initial &&
    (nextActive !== activeBoardId.value ||
      (reloadRevision !== null && data.reloadRevision !== reloadRevision) ||
      (boardGeneration !== null &&
        typeof data.boardGeneration === 'number' &&
        data.boardGeneration !== boardGeneration));
  if (switched) boardIncarnation++;
  if (typeof data.boardGeneration === 'number') boardGeneration = data.boardGeneration;
  reloadRevision = data.reloadRevision;
  batch(() => {
    boardList.value = data.boards as BoardSummary[];
    activeBoardId.value = nextActive;
    boardsLoaded.value = true;
    // Never render old cards with the replacement board's identity/draft keys.
    if (switched || initial) onBoardSwitched?.(initial);
    // A same-board restart may deliver its tagged snapshot before the first
    // catalog. Drain it without detaching the editor or losing its selection.
    else if (establishesGeneration) onBoardSwitched?.(true);
  });
}

export async function loadBoards(): Promise<void> {
  const payload = await requestJson<BoardsPayload | null>('loadBoards', '/api/canvas/boards', null);
  applyBoards(payload);
}

async function post(action: string, url: string, method: string, body?: unknown): Promise<BoardsPayload | null> {
  return requestJson<BoardsPayload | null>(action, url, null, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Open a board, or Home with null. */
export async function openBoard(id: string | null): Promise<void> {
  const sequence = ++openRequestSequence;
  const epoch = catalogEpoch;
  let payload: BoardsPayload | null = null;
  const request = openRequestQueue.then(async () => {
    if (epoch === catalogEpoch) payload = await post('openBoard', '/api/canvas/boards/open', 'POST', { id });
  });
  openRequestQueue = request.catch(() => undefined);
  await request;
  if (sequence === openRequestSequence && epoch === catalogEpoch && payload) {
    batch(() => {
      applyBoards(payload);
      if (id !== null) browsingMemory.value = false;
    });
  }
}

/** Used by wiki links, graph nodes and qualified library hits; never focus a stale board's same-ID card. */
export async function openMemoryTarget(target: MemoryTarget): Promise<void> {
  const sequence = ++navigationSequence;
  await openBoard(target.boardId);
  if (!target.cardId) return;
  // A slow layout fetch must not turn a card jump into only a board switch.
  for (let attempt = 0; attempt < 400; attempt++) {
    if (sequence !== navigationSequence || activeBoardId.value !== target.boardId) return;
    if (hasInitialServerLayout.value && nodes.value.has(target.cardId)) {
      focusNode(target.cardId);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }
}

/** Create a board (filed in `folder` when given) and open it. */
export async function createAndOpenBoard(name: string, folder?: string | null): Promise<void> {
  const sequence = ++openRequestSequence;
  const epoch = catalogEpoch;
  const created = await requestJson<{ board?: BoardSummary } | null>('createBoard', '/api/canvas/boards', null, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...(folder ? { folder } : {}) }),
  });
  if (created?.board && sequence === openRequestSequence && epoch === catalogEpoch) await openBoard(created.board.id);
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
  folder?: string;
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

/** Rename and/or re-file a board; `folder: null` unfiles it. */
export async function updateBoard(
  id: string,
  patch: {
    name?: string;
    folder?: string | null;
    mapPosition?: { x: number; y: number } | null;
    relationVocabulary?: RelationDefinition[];
  },
): Promise<boolean> {
  const payload = await post('updateBoard', `/api/canvas/boards/${encodeURIComponent(id)}`, 'PATCH', {
    ...patch,
    ...(patch.folder === null ? { folder: '' } : {}),
  });
  applyBoards(payload);
  return payload !== null;
}

/** Pin a board into the agent's working set, or unpin it. */
export async function setBoardPinned(id: string, pinned: boolean): Promise<void> {
  const url = `/api/canvas/boards/${encodeURIComponent(id)}/${pinned ? 'pin' : 'unpin'}`;
  applyBoards(await post(pinned ? 'pinBoard' : 'unpinBoard', url, 'POST', {}));
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
