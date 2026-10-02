import { z } from 'zod';

export const CANVAS_APP_URI = 'ui://pmx/canvas';
// Independent of package version: older builds can share the same version.
export const CANVAS_APP_WRITE_CONTRACT = 'pmx-embedded-workbench-v4';

const point = z.object({ x: z.number(), y: z.number() });
export const canvasAppSnapshotSchema = z.object({
  boardId: z.string().nullable(),
  boardName: z.string(),
  boards: z.array(z.object({ id: z.string(), name: z.string() })),
  // A digest of this projection, not the board's content-delta cursor.
  revision: z.string(),
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      title: z.string(),
      text: z.string(),
      contentRevision: z.number().int().nonnegative(),
      // Only standalone Markdown within the editing limit; never a truncated draft.
      editableContent: z.string().optional(),
      position: point,
      size: z.object({ width: z.number(), height: z.number() }),
      image: z.string().optional(),
    }),
  ),
  edges: z.array(z.object({ id: z.string(), from: z.string(), to: z.string(), label: z.string() })),
  pinnedNodeIds: z.array(z.string()),
});

export type CanvasAppSnapshot = z.infer<typeof canvasAppSnapshotSchema>;

/** Share only curated text, never image bytes or the whole board's contents. */
export function canvasAppContext(
  snapshot: Pick<CanvasAppSnapshot, 'boardId' | 'boardName' | 'pinnedNodeIds'> & {
    nodes: Pick<CanvasAppSnapshot['nodes'][number], 'id' | 'type' | 'title' | 'text' | 'contentRevision'>[];
  },
  selectedIds: string[],
) {
  const existing = new Set(snapshot.nodes.map((node) => node.id));
  const selected = new Set(selectedIds.filter((id) => existing.has(id)).slice(0, 20));
  const pinned = new Set(snapshot.pinnedNodeIds.filter((id) => existing.has(id)).slice(0, 20));
  return {
    boardId: snapshot.boardId,
    boardName: snapshot.boardName,
    selectedNodeIds: [...selected],
    pinnedNodeIds: [...pinned],
    nodes: snapshot.nodes
      .filter((node) => selected.has(node.id) || pinned.has(node.id))
      .map((node) => ({
        id: node.id,
        type: node.type,
        title: node.title,
        contentRevision: node.contentRevision,
        text: node.text.slice(0, 700),
      })),
  };
}
