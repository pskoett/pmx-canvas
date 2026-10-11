/** Board-qualified identities: card IDs alone are not unique across a library. */
export interface MemoryTarget {
  boardId: string;
  cardId?: string;
}

export interface WikiLink {
  ref: string;
  target?: MemoryTarget;
}

export function wikiLinksFromData(data: Record<string, unknown>): WikiLink[] {
  if (!Array.isArray(data.wikiLinks)) return [];
  return data.wikiLinks.flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') return [];
    const link = value as Record<string, unknown>;
    if (typeof link.ref !== 'string') return [];
    const target = link.target as Record<string, unknown> | undefined;
    return [
      {
        ref: link.ref,
        ...(target && typeof target.boardId === 'string'
          ? {
              target: {
                boardId: target.boardId,
                ...(typeof target.cardId === 'string' ? { cardId: target.cardId } : {}),
              },
            }
          : {}),
      },
    ];
  });
}

export const memoryKey = (target: MemoryTarget): string => JSON.stringify([target.boardId, target.cardId ?? null]);

export interface MemoryGraphNode extends MemoryTarget {
  key: string;
  kind: 'board' | 'card';
  title: string;
  summary: string;
  folder: string | null;
  inContext: boolean;
  summaryOnly: true;
  /** False when the focused view omits incident relations; cannot acknowledge all links. */
  linksComplete?: boolean;
  /** Card link revision captured with this projection. */
  linksRevision?: number;
  type?: string;
  nodeCount?: number;
  position?: { x: number; y: number };
}

export interface MemoryGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: 'member' | 'portal' | 'wiki' | 'card' | 'previous';
  relationKind?: string;
  reason?: string;
  label?: string;
  type?: string;
  source: MemoryTarget;
  target: MemoryTarget;
  missing: boolean;
}

export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  unresolvedLinks: Array<{ source: MemoryTarget; ref: string }>;
  focus: string | null;
  depth: number;
}
