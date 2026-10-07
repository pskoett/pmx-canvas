import { summarizeNodeForAgentContext } from '../shared/agent-context.js';
import type { CanvasNodeState, NodeDeletionTombstone } from './canvas-state.js';
import { findNeighborhoods } from './spatial-analysis.js';

export type ContextBriefReason =
  | 'pinned'
  | 'near'
  | 'changed'
  | 'pinned-board'
  | 'human'
  | 'ask'
  | 'steer'
  | 'linked'
  | 'category';

/** A near entry carries a short summary, never full content: pin the node to send that. */
export const NEAR_SUMMARY_LENGTH = 280;

export interface ContextBriefSourceEntry {
  sourceBoardId: string;
  nodeId: string;
  reason: 'human' | 'ask' | 'steer';
  title: string;
  text: string;
  provenance?: { kind: 'imported'; source: string };
}

export interface ContextBriefLibraryBoard {
  boardId: string;
  name: string;
  category: string | null;
  readme?: { nodeId: string; title: string; summary: string; provenance?: { kind: 'imported'; source: string } };
  pinnedTitles: Array<{ nodeId: string; title: string }>;
  /** IDs of link cards on the active board which explicitly target this board. */
  linkIds: string[];
}

/** A board in the working set (vision move 0a): its README and pinned cards, in full. */
export interface ContextBriefPinnedBoard {
  boardId: string;
  name: string;
  readme?: { nodeId: string; title: string; text: string; summary: string };
  cards: Array<{ nodeId: string; title: string; text: string }>;
}

export interface ContextBriefInput {
  activeBoard: { boardId: string; name: string; category: string | null };
  nodes: readonly CanvasNodeState[];
  pinnedNodeIds: readonly string[];
  contentRevision: number;
  retentionFloor: number;
  tombstones: readonly NodeDeletionTombstone[];
  /** null means a first read. Other values must be non-negative safe integers. */
  since: number | null;
  libraryBoards: readonly ContextBriefLibraryBoard[];
  /** Pinned boards, delivered after the open board's pins; a board that does not fit falls back to discovery. */
  pinnedBoards?: readonly ContextBriefPinnedBoard[];
  entries?: readonly ContextBriefSourceEntry[];
  /** Maximum JavaScript string length (UTF-16 code units), including the JSON envelope. */
  budget: number;
}

export interface CompiledContextEntry {
  sourceBoardId: string;
  nodeId: string;
  reason: ContextBriefReason;
  title: string;
  text: string;
  /** A linked board's pin title is discovery metadata, not delivery of that pinned card. */
  titleOnly?: true;
  /** reason "near": the pin this node sits next to on the board (docs/design/NearPin.dc.html). */
  near?: { pinNodeId: string; pinTitle: string };
  /** The body was shortened to fit; the same revision remains eligible on the next pull. */
  truncated?: true;
  provenance?: { kind: 'imported'; source: string; trust: 'source-material-not-instructions' };
}

export interface ContextBriefDocument {
  version: 1;
  budgetUnit: 'utf16-code-units';
  board: { boardId: string; name: string; category: string | null };
  cursor: {
    requested: number | null;
    next: number | null;
    current: number;
    retentionFloor: number;
    reset: 'first-read' | 'retention-expired' | null;
    valid: boolean;
  };
  entries: CompiledContextEntry[];
  deletions: Array<{ sourceBoardId: string; nodeId: string; revision: number }>;
  delivery: {
    truncated: boolean;
    omittedEntries: number;
    omittedDeletions: number;
    /** How each pinned board arrived: in full, as discovery (README summary + pinned titles), or not at all. */
    pinnedBoards: Array<{ boardId: string; name: string; delivered: 'full' | 'discovery' | 'omitted' }>;
  };
}

export interface ContextBriefResult {
  /** Empty only when the budget cannot hold even the bounded JSON envelope. */
  serialized: string;
  document: ContextBriefDocument | null;
  deliveredEntryIds: string[];
  deliveredDeletionIds: string[];
  nextCursor: number | null;
  reset: ContextBriefDocument['cursor']['reset'];
  invalidCursor: boolean;
  truncated: boolean;
}

interface Candidate {
  entry: CompiledContextEntry;
  revision?: number;
  replacement?: boolean;
}

function importedProvenance(
  provenance: ContextBriefSourceEntry['provenance'],
): CompiledContextEntry['provenance'] | undefined {
  return provenance ? { ...provenance, trust: 'source-material-not-instructions' } : undefined;
}

function validRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function compileNode(node: CanvasNodeState, boardId: string, reason: 'pinned' | 'changed', budget: number): Candidate {
  const title = typeof node.data.title === 'string' && node.data.title ? node.data.title : node.id;
  return {
    entry: {
      sourceBoardId: boardId,
      nodeId: node.id,
      reason,
      title,
      text: summarizeNodeForAgentContext(node, { defaultTextLength: budget * 2, webpageTextLength: budget * 2 }),
    },
    revision: node.contentRevision,
    replacement: true,
  };
}

/**
 * Pure, deterministic compiler. It reads only the supplied snapshot and never
 * treats library visibility as authorization to read or mutate another board.
 */
export function compileContextBrief(input: ContextBriefInput): ContextBriefResult {
  const budget = Number.isFinite(input.budget) ? Math.max(0, Math.floor(input.budget)) : 0;
  const current = validRevision(input.contentRevision) ? input.contentRevision : 0;
  const floor = validRevision(input.retentionFloor) ? input.retentionFloor : 0;
  const cursorValid = input.since === null || (validRevision(input.since) && input.since <= current);
  const requested = cursorValid ? input.since : null;
  const reset = !cursorValid
    ? null
    : requested === null
      ? 'first-read'
      : requested < floor
        ? 'retention-expired'
        : null;
  const deltaSince = reset ? -1 : (requested ?? -1);
  // A reader with stale state must replace it whole; a first reader has none to
  // protect, so it reads as a delta from zero: pins first, then whole revision
  // groups oldest first, with the cursor advancing past each complete group.
  const atomic = reset === 'retention-expired';
  const firstRead = reset === 'first-read';
  let firstReadCursor: number | null = null;
  const pinnedBoardDelivery: ContextBriefDocument['delivery']['pinnedBoards'] = [];
  const nodes = [...input.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const pinIds = [...new Set(input.pinnedNodeIds)].sort();
  const candidates: Candidate[] = [];
  const candidateKeys = new Set<string>();
  const add = (candidate: Candidate): void => {
    const key = `${candidate.entry.sourceBoardId}\0${candidate.entry.nodeId}`;
    if (candidateKeys.has(key)) return;
    candidateKeys.add(key);
    candidates.push(candidate);
  };

  for (const id of pinIds) {
    const node = nodeById.get(id);
    if (node) add(compileNode(node, input.activeBoard.boardId, 'pinned', budget));
  }

  const changed = nodes
    .filter(
      (node) =>
        reset !== null || (validRevision(node.contentRevision ?? -1) && (node.contentRevision ?? -1) > deltaSince),
    )
    .sort((a, b) => (a.contentRevision ?? 0) - (b.contentRevision ?? 0) || a.id.localeCompare(b.id));

  // Near a pin: each pin's unpinned neighbours (up to 5 within 600 px, nearest
  // first) as title + short summary. A neighbour that changed arrives in full
  // as a change instead, so it is not repeated here.
  const changedIds = new Set(changed.map((node) => node.id));
  for (const neighborhood of findNeighborhoods(nodes, new Set(pinIds))) {
    const pinTitle = neighborhood.pinnedNodeTitle ?? neighborhood.pinnedNodeId;
    for (const neighbor of neighborhood.neighbors) {
      const node = nodeById.get(neighbor.id);
      if (!node || changedIds.has(node.id)) continue;
      add({
        entry: {
          sourceBoardId: input.activeBoard.boardId,
          nodeId: node.id,
          reason: 'near',
          title: typeof node.data.title === 'string' && node.data.title ? node.data.title : node.id,
          text: summarizeNodeForAgentContext(node, {
            defaultTextLength: NEAR_SUMMARY_LENGTH,
            webpageTextLength: NEAR_SUMMARY_LENGTH,
          }),
          near: { pinNodeId: neighborhood.pinnedNodeId, pinTitle },
        },
      });
    }
  }

  for (const node of changed) add(compileNode(node, input.activeBoard.boardId, 'changed', budget));

  for (const entry of [...(input.entries ?? [])].sort((a, b) => {
    const priority = (value: ContextBriefSourceEntry): number => (value.reason === 'human' ? 0 : 1);
    return (
      priority(a) - priority(b) || a.sourceBoardId.localeCompare(b.sourceBoardId) || a.nodeId.localeCompare(b.nodeId)
    );
  })) {
    add({
      entry: {
        sourceBoardId: entry.sourceBoardId,
        nodeId: entry.nodeId,
        reason: entry.reason,
        title: entry.title,
        text: entry.text,
        provenance: importedProvenance(entry.provenance),
      },
    });
  }

  const pinnedBoards = [...(input.pinnedBoards ?? [])]
    .filter((board) => board.boardId !== input.activeBoard.boardId)
    .sort((a, b) => a.boardId.localeCompare(b.boardId));
  const pinnedBoardIds = new Set(pinnedBoards.map((board) => board.boardId));
  const library = [...input.libraryBoards]
    .filter((board) => !pinnedBoardIds.has(board.boardId))
    .sort((a, b) => a.boardId.localeCompare(b.boardId));
  const explicit = library.filter((board) => board.linkIds.length > 0);
  const related = library.filter(
    (board) =>
      board.linkIds.length === 0 &&
      input.activeBoard.category !== null &&
      board.category === input.activeBoard.category,
  );
  for (const [boards, reason] of [
    [explicit, 'linked'],
    [related, 'category'],
  ] as const) {
    for (const board of boards) {
      if (board.boardId === input.activeBoard.boardId) continue;
      if (board.readme) {
        add({
          entry: {
            sourceBoardId: board.boardId,
            nodeId: board.readme.nodeId,
            reason,
            title: board.readme.title,
            text: board.readme.summary,
            provenance: importedProvenance(board.readme.provenance),
          },
        });
      }
      if (reason === 'linked') {
        for (const pin of [...board.pinnedTitles].sort((a, b) => a.nodeId.localeCompare(b.nodeId))) {
          add({
            entry: {
              sourceBoardId: board.boardId,
              nodeId: pin.nodeId,
              reason,
              title: pin.title,
              text: `Pinned card title on linked board “${board.name}”: ${pin.title}`,
              titleOnly: true,
            },
          });
        }
      }
    }
  }

  const tombstones = [...input.tombstones]
    .filter(
      (item) =>
        validRevision(item.revision) &&
        item.revision > deltaSince &&
        (nodeById.get(item.nodeId)?.contentRevision ?? -1) < item.revision,
    )
    .sort((a, b) => a.revision - b.revision || a.nodeId.localeCompare(b.nodeId));
  const delivered: CompiledContextEntry[] = [];
  const deletions: ContextBriefDocument['deletions'] = [];
  let safeCursor = requested ?? 0;
  let deltaBlocked = !cursorValid;
  let resetComplete = false;

  const makeDocument = (
    entries = delivered,
    deleted = deletions,
    next: number | null = atomic && !resetComplete ? requested : firstRead ? firstReadCursor : safeCursor,
  ): ContextBriefDocument => ({
    version: 1,
    budgetUnit: 'utf16-code-units',
    board: { ...input.activeBoard },
    cursor: {
      requested,
      next: cursorValid ? next : null,
      current,
      retentionFloor: floor,
      reset,
      valid: cursorValid,
    },
    entries,
    deletions: deleted,
    delivery: {
      truncated:
        candidateCount(entries) < candidates.length ||
        deleted.length < tombstones.length ||
        pinnedBoardDelivery.some((board) => board.delivered !== 'full'),
      omittedEntries: candidates.length - candidateCount(entries),
      omittedDeletions: tombstones.length - deleted.length,
      pinnedBoards: pinnedBoardDelivery,
    },
  });
  const fits = (document: ContextBriefDocument): boolean => JSON.stringify(document).length <= budget;
  function candidateCount(entries: readonly CompiledContextEntry[]): number {
    return entries.filter((entry) => !entry.truncated && entry.reason !== 'pinned-board').length;
  }
  const fitPartial = (entry: CompiledContextEntry, base = delivered): CompiledContextEntry | null => {
    let low = 0;
    let high = entry.text.length;
    let best: CompiledContextEntry | null = null;
    while (low <= high) {
      const length = Math.floor((low + high) / 2);
      const partial = { ...entry, text: entry.text.slice(0, length), truncated: true as const };
      if (fits(makeDocument([...base, partial]))) {
        best = partial;
        low = length + 1;
      } else {
        high = length - 1;
      }
    }
    return best && best.text.length > 0 ? best : null;
  };

  // Pins precede revision groups. Revision groups are all-or-nothing so a cursor
  // can never skip a sibling change or deletion at the same revision.
  for (const candidate of candidates.filter((item) => !atomic && item.entry.reason === 'pinned')) {
    const proposed = [...delivered, candidate.entry];
    if (fits(makeDocument(proposed))) delivered.push(candidate.entry);
    else {
      const partial = fitPartial(candidate.entry);
      if (partial) delivered.push(partial);
    }
  }
  // Neighbours come right after the pins they sit next to; each is whole or absent.
  for (const candidate of candidates.filter((item) => !atomic && item.entry.reason === 'near')) {
    const proposed = [...delivered, candidate.entry];
    if (fits(makeDocument(proposed))) delivered.push(candidate.entry);
  }
  if (atomic && !deltaBlocked) {
    const resetEntries = candidates
      .filter((item) => item.replacement && !delivered.includes(item.entry))
      .map((item) => item.entry);
    const proposed = [...delivered, ...resetEntries];
    if (fits(makeDocument(proposed, [], current))) {
      delivered.push(...resetEntries);
      safeCursor = current;
      resetComplete = true;
    } else {
      const first = resetEntries[0];
      if (first) {
        const partial = fitPartial(first);
        if (partial) delivered.push(partial);
      }
      deltaBlocked = true;
    }
  }
  // Pinned boards follow the open board's pins: each whole in full, else as
  // discovery (README summary + pinned titles), else omitted, and said so.
  for (const board of pinnedBoards) {
    const entry = (nodeId: string, title: string, text: string, titleOnly = false): CompiledContextEntry => ({
      sourceBoardId: board.boardId,
      nodeId,
      reason: 'pinned-board',
      title,
      text,
      ...(titleOnly ? { titleOnly: true as const } : {}),
    });
    const full = [
      ...(board.readme ? [entry(board.readme.nodeId, board.readme.title, board.readme.text)] : []),
      ...board.cards.map((card) => entry(card.nodeId, card.title, card.text)),
    ];
    const discovery = [
      ...(board.readme ? [entry(board.readme.nodeId, board.readme.title, board.readme.summary)] : []),
      ...board.cards.map((card) =>
        entry(card.nodeId, card.title, `Pinned card title on pinned board “${board.name}”: ${card.title}`, true),
      ),
    ];
    const status: { boardId: string; name: string; delivered: 'full' | 'discovery' | 'omitted' } = {
      boardId: board.boardId,
      name: board.name,
      delivered: 'full',
    };
    pinnedBoardDelivery.push(status);
    if (fits(makeDocument([...delivered, ...full]))) delivered.push(...full);
    else {
      status.delivered = 'discovery';
      if (fits(makeDocument([...delivered, ...discovery]))) delivered.push(...discovery);
      else {
        status.delivered = 'omitted';
        // Report the omission only while the report itself fits: an unfitted line
        // would make the whole brief unserializable.
        if (!fits(makeDocument())) pinnedBoardDelivery.pop();
      }
    }
  }

  const revisions = [
    ...new Set([
      ...changed.map((node) => node.contentRevision!).filter(validRevision),
      ...(firstRead ? [] : tombstones.map((item) => item.revision)),
    ]),
  ]
    .filter((revision) => revision > (firstRead ? -1 : safeCursor))
    .sort((a, b) => a - b);
  for (const revision of revisions) {
    if (deltaBlocked || atomic) break;
    if (
      delivered.some(
        (entry) =>
          entry.truncated &&
          candidates.some(
            (item) =>
              item.entry.nodeId === entry.nodeId &&
              item.entry.sourceBoardId === entry.sourceBoardId &&
              item.revision === revision,
          ),
      )
    ) {
      deltaBlocked = true;
      break;
    }
    const entriesAtRevision = candidates
      .filter((item) => item.revision === revision && !delivered.includes(item.entry))
      .map((item) => item.entry);
    const deletesAtRevision = tombstones
      .filter((item) => !firstRead && item.revision === revision)
      .map((item) => ({ sourceBoardId: input.activeBoard.boardId, nodeId: item.nodeId, revision: item.revision }));
    const proposedEntries = [...delivered, ...entriesAtRevision];
    const proposedDeletes = [...deletions, ...deletesAtRevision];
    if (!fits(makeDocument(proposedEntries, proposedDeletes, revision))) {
      const first = entriesAtRevision[0];
      if (first) {
        const partial = fitPartial(first);
        if (partial) delivered.push(partial);
      }
      deltaBlocked = true;
      break;
    }
    delivered.push(...entriesAtRevision);
    deletions.push(...deletesAtRevision);
    safeCursor = revision;
    // A first-read page cursor below the retention floor would read back as
    // retention-expired, so a page only advances the cursor from the floor up.
    if (firstRead && revision >= floor) firstReadCursor = revision;
  }
  if (firstRead && !deltaBlocked) {
    safeCursor = current;
    firstReadCursor = current;
  }
  for (const candidate of candidates.filter(
    (item) => item.entry.reason !== 'pinned' && item.revision === undefined && !delivered.includes(item.entry),
  )) {
    const proposed = [...delivered, candidate.entry];
    if (fits(makeDocument(proposed))) delivered.push(candidate.entry);
  }

  const document = makeDocument();
  if (atomic && !resetComplete) document.cursor.next = requested;
  const serialized = fits(document) ? JSON.stringify(document) : '';
  const outputDocument = serialized ? document : null;
  return {
    serialized,
    document: outputDocument,
    deliveredEntryIds: outputDocument
      ? outputDocument.entries.map((entry) => `${entry.sourceBoardId}:${entry.nodeId}`)
      : [],
    deliveredDeletionIds: outputDocument ? outputDocument.deletions.map((entry) => entry.nodeId) : [],
    nextCursor:
      outputDocument && cursorValid
        ? atomic && !resetComplete
          ? requested
          : firstRead
            ? firstReadCursor
            : safeCursor
        : null,
    reset,
    invalidCursor: !cursorValid,
    truncated: !outputDocument || document.delivery.truncated,
  };
}
