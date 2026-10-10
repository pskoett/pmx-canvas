import { summarizeNodeForAgentContext } from '../shared/agent-context.js';
import type { CanvasNodeState, NodeDeletionTombstone } from './canvas-state.js';
import { findNeighborhoods } from './spatial-analysis.js';

export type ContextBriefReason =
  | 'overview'
  | 'pinned'
  | 'near'
  | 'changed'
  | 'pinned-board'
  | 'human'
  | 'ask'
  | 'steer'
  | 'linked'
  | 'category';

/** How long a card's summary is in the brief: enough to know what it is. */
export const BRIEF_SUMMARY_LENGTH = 280;

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

/**
 * A board in the working set (vision move 0a), sent as a map: enough to know what
 * it is and how it relates, so the agent decides what to pull in full.
 */
export interface ContextBriefPinnedBoard {
  boardId: string;
  name: string;
  folder: string | null;
  readmeSummary: string | null;
  /** Pinned cards as title + short summary, each pullable by id. */
  cards: Array<{ nodeId: string; title: string; summary: string }>;
  /** Names of the boards it links to and is linked from. */
  links: string[];
  backlinks: string[];
}

/** The open board at a glance: what it is and how it relates to other boards. */
export interface ContextBriefOverview {
  folder: string | null;
  readmeSummary: string | null;
  links: string[];
  backlinks: string[];
}

export interface ContextBriefEdge {
  from: string;
  to: string;
  type: string;
  label?: string | null;
  /** Board revision of the link's latest add, retype or relabel, and who made it. */
  revision?: number;
  changedBy?: { actor: string; source: string; agentId?: string };
  /** Equal to changedAt while the link is as first drawn: "new" rather than "changed". */
  createdAt?: string;
  changedAt?: string;
}

export interface ContextBriefInput {
  activeBoard: { boardId: string; name: string; category: string | null };
  /** The brief is a map, not a dump: overview and relations let the agent choose what to pull. */
  overview?: ContextBriefOverview;
  /** Edges on the open board, carried as each card's relations. */
  edges?: readonly ContextBriefEdge[];
  /** Why each pin was pinned, when someone said. */
  pinReasons?: Readonly<Record<string, string>>;
  nodes: readonly CanvasNodeState[];
  pinnedNodeIds: readonly string[];
  contentRevision: number;
  retentionFloor: number;
  tombstones: readonly NodeDeletionTombstone[];
  /** null means a first read. Other values must be non-negative safe integers. */
  since: number | null;
  libraryBoards: readonly ContextBriefLibraryBoard[];
  /** Pinned boards, each sent as a map (see ContextBriefPinnedBoard). */
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
  /** A title + short summary of a card the agent may pull in full; seen, not read. */
  summaryOnly?: true;
  /**
   * On a later read, what changed on this card since the cursor
   * (docs/design/LinksChanged.dc.html): its text, its links, or both.
   */
  changes?: Array<'text' | 'links'>;
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

const MAX_RELATIONS = 8;

function nodeTitle(node: CanvasNodeState): string {
  return typeof node.data.title === 'string' && node.data.title ? node.data.title : node.id;
}

/** A card as the brief sends it: title + short summary + why pinned + its relations, pullable by id. */
function compileNode(
  node: CanvasNodeState,
  boardId: string,
  reason: 'pinned' | 'changed',
  relations: string[],
  pinReason?: string,
  changes?: Array<'text' | 'links'>,
): Candidate {
  const summary = summarizeNodeForAgentContext(node, {
    defaultTextLength: BRIEF_SUMMARY_LENGTH,
    webpageTextLength: BRIEF_SUMMARY_LENGTH,
  });
  return {
    entry: {
      sourceBoardId: boardId,
      nodeId: node.id,
      reason,
      title: nodeTitle(node),
      text: [summary, pinReason ? `Pinned because: ${pinReason}` : '', ...relations].filter(Boolean).join('\n'),
      summaryOnly: true,
      ...(changes && changes.length > 0 ? { changes } : {}),
    },
    revision: briefRevision(node),
    replacement: true,
  };
}

/**
 * A card's place in the delta: its newest text or links change (links are
 * tracked apart, option C). Undefined for a legacy card with neither.
 */
function briefRevision(node: CanvasNodeState): number | undefined {
  if (node.contentRevision === undefined && node.linksRevision === undefined) return undefined;
  return Math.max(node.contentRevision ?? -1, node.linksRevision ?? -1);
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
  const nodes = [...input.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const pinIds = [...new Set(input.pinnedNodeIds)].sort();
  const relationsOf = (id: string): string[] => {
    const lines: string[] = [];
    const marked: string[] = [];
    for (const edge of input.edges ?? []) {
      const other = edge.from === id ? edge.to : edge.to === id ? edge.from : null;
      if (!other) continue;
      const otherTitle = nodeById.get(other) ? nodeTitle(nodeById.get(other) as CanvasNodeState) : other;
      const kind = `${edge.type}${edge.label ? ` "${edge.label}"` : ''}`;
      const mark = linkMark(edge);
      // A link drawn or changed since the read leads, so the relations cap never hides it.
      (mark ? marked : lines).push(
        edge.from === id ? `→ ${kind}: ${otherTitle} (${other})${mark}` : `← ${kind}: ${otherTitle} (${other})${mark}`,
      );
    }
    lines.unshift(...marked);
    return lines.length > MAX_RELATIONS
      ? [...lines.slice(0, MAX_RELATIONS), `… ${lines.length - MAX_RELATIONS} more relations`]
      : lines;
  };
  // A later read marks a link drawn or changed since the cursor, and who did it.
  const linkMark = (edge: ContextBriefEdge): string => {
    if (deltaSince < 0 || edge.revision === undefined || edge.revision <= deltaSince) return '';
    const status = edge.createdAt !== undefined && edge.createdAt === edge.changedAt ? 'new' : 'changed';
    const by = !edge.changedBy
      ? ''
      : edge.changedBy.actor === 'agent'
        ? `, by ${edge.changedBy.agentId?.trim() || edge.changedBy.source}`
        : ', by a person';
    return ` (${status}${by})`;
  };
  // What changed on a card since the cursor: never on a first or reset read.
  const changesOf = (node: CanvasNodeState): Array<'text' | 'links'> | undefined => {
    if (deltaSince < 0) return undefined;
    const changes: Array<'text' | 'links'> = [];
    if ((node.contentRevision ?? -1) > deltaSince) changes.push('text');
    if ((node.linksRevision ?? -1) > deltaSince) changes.push('links');
    return changes;
  };
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
    if (node) {
      add(
        compileNode(
          node,
          input.activeBoard.boardId,
          'pinned',
          relationsOf(id),
          input.pinReasons?.[id],
          changesOf(node),
        ),
      );
    }
  }

  const changed = nodes
    .filter((node) => reset !== null || (briefRevision(node) ?? -1) > Math.max(deltaSince, -1))
    .sort((a, b) => (briefRevision(a) ?? 0) - (briefRevision(b) ?? 0) || a.id.localeCompare(b.id));

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
            defaultTextLength: BRIEF_SUMMARY_LENGTH,
            webpageTextLength: BRIEF_SUMMARY_LENGTH,
          }),
          near: { pinNodeId: neighborhood.pinnedNodeId, pinTitle },
          summaryOnly: true,
        },
      });
    }
  }

  for (const node of changed) {
    add(compileNode(node, input.activeBoard.boardId, 'changed', relationsOf(node.id), undefined, changesOf(node)));
  }

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
        ...(entry.reason === 'human' ? { summaryOnly: true as const } : {}),
      },
    });
  }

  const pinnedBoards = [...(input.pinnedBoards ?? [])]
    .filter((board) => board.boardId !== input.activeBoard.boardId)
    .sort((a, b) => a.boardId.localeCompare(b.boardId));
  const pinnedBoardIds = new Set(pinnedBoards.map((board) => board.boardId));
  // Pinned boards travel as maps, each entry whole or absent, after the open
  // board's own context: the agent pulls what it wants in full.
  for (const board of pinnedBoards) {
    const relations = [
      board.folder ? `Folder: ${board.folder}.` : '',
      board.links.length ? `Links to: ${board.links.join(', ')}.` : '',
      board.backlinks.length ? `Linked from: ${board.backlinks.join(', ')}.` : '',
      board.cards.length ? `Pinned cards: ${board.cards.length}.` : '',
    ].filter(Boolean);
    add({
      entry: {
        sourceBoardId: board.boardId,
        nodeId: `board:${board.boardId}`,
        reason: 'pinned-board',
        title: board.name,
        text: [board.readmeSummary ?? '', ...relations].filter(Boolean).join('\n'),
      },
    });
    for (const card of board.cards) {
      add({
        entry: {
          sourceBoardId: board.boardId,
          nodeId: card.nodeId,
          reason: 'pinned-board',
          title: card.title,
          text: card.summary,
          summaryOnly: true,
        },
      });
    }
  }
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
      truncated: counted(entries) < candidates.length || deleted.length < tombstones.length,
      omittedEntries: candidates.length - counted(entries),
      omittedDeletions: tombstones.length - deleted.length,
    },
  });
  const fits = (document: ContextBriefDocument): boolean => JSON.stringify(document).length <= budget;
  // The overview is not a candidate, so it never counts as delivered or omitted.
  function counted(entries: readonly CompiledContextEntry[]): number {
    return entries.filter((entry) => !entry.truncated && entry.reason !== 'overview').length;
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

  // The overview leads: what this board is and how it relates to other boards.
  if (input.overview) {
    const overview = input.overview;
    const overviewEntry: CompiledContextEntry = {
      sourceBoardId: input.activeBoard.boardId,
      nodeId: `board:${input.activeBoard.boardId}`,
      reason: 'overview',
      title: input.activeBoard.name,
      text: [
        overview.readmeSummary ?? '',
        overview.folder ? `Folder: ${overview.folder}.` : '',
        `${input.nodes.length} cards, ${pinIds.length} pinned.`,
        overview.links.length ? `Links to: ${overview.links.join(', ')}.` : '',
        overview.backlinks.length ? `Linked from: ${overview.backlinks.join(', ')}.` : '',
        'Entries are summaries: pull a card in full with canvas_node { action: "get", board, id, full: true }.',
      ]
        .filter(Boolean)
        .join('\n'),
    };
    if (fits(makeDocument([...delivered, overviewEntry]))) delivered.push(overviewEntry);
  }
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
  const revisions = [
    ...new Set([
      ...changed.map((node) => briefRevision(node) ?? -1).filter(validRevision),
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
