/**
 * Live AX work-item board, materialized as a json-render node.
 *
 * `buildWorkboardSpec` is the pure spec builder (status columns of work-item
 * cards); `renderWorkboard` is the operation core (create-or-rebuild the
 * single `data.workboard === true` json-render node); `refreshWorkboardNodes`
 * is the live-refresh hook this module registers on `canvasState` so every
 * addWorkItem/updateWorkItem rebuilds the board from the fresh work-item list
 * through the SAME spec/update path the operation uses.
 *
 * The refresh runs inside `withSuppressedRecording` so live board rebuilds do
 * not spam undo/redo history (persistence and SSE emits are unaffected).
 */
import type { JsonRenderSpec } from '../json-render/server.js';
import type { PmxAxWorkItem, PmxAxWorkItemStatus } from './ax-state.js';
import { buildJsonRenderNodeUpdate, createCanvasJsonRenderNode, emitCanvasLayoutUpdate } from './canvas-operations.js';
import { canvasState, type CanvasNodeState } from './canvas-state.js';

export const WORKBOARD_NODE_TITLE = 'Work Board';
export const WORKBOARD_NODE_SIZE = { width: 960, height: 560 };

const WORKBOARD_STATUS_ORDER: PmxAxWorkItemStatus[] = ['todo', 'in-progress', 'blocked', 'done', 'cancelled'];

const WORKBOARD_STATUS_LABELS: Record<PmxAxWorkItemStatus, string> = {
  todo: 'To Do',
  'in-progress': 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

/**
 * Build the workboard json-render spec from a work-item list: one column per
 * status (todo → in-progress → blocked → done → cancelled; empty statuses are
 * omitted), each item a Card with an agentId Badge and detail Text when
 * present. An empty list renders a single muted "No work items" text block.
 */
export function buildWorkboardSpec(workItems: PmxAxWorkItem[]): JsonRenderSpec {
  if (workItems.length === 0) {
    return {
      root: 'empty',
      elements: {
        empty: { type: 'Text', props: { text: 'No work items', variant: 'muted' }, children: [] },
      },
    };
  }

  const elements: Record<string, unknown> = {};
  const columnIds: string[] = [];
  for (const status of WORKBOARD_STATUS_ORDER) {
    const items = workItems.filter((item) => item.status === status);
    if (items.length === 0) continue;
    const columnId = `col-${status}`;
    const headerId = `${columnId}-header`;
    elements[headerId] = {
      type: 'Heading',
      props: { level: 'h4', text: `${WORKBOARD_STATUS_LABELS[status]} (${items.length})` },
      children: [],
    };
    const columnChildren = [headerId];
    for (const item of items) {
      const cardId = `item-${item.id}`;
      const cardChildren: string[] = [];
      if (item.agentId) {
        elements[`${cardId}-agent`] = {
          type: 'Badge',
          props: { text: item.agentId, variant: 'secondary' },
          children: [],
        };
        cardChildren.push(`${cardId}-agent`);
      }
      if (item.detail) {
        elements[`${cardId}-detail`] = {
          type: 'Text',
          props: { text: item.detail, variant: 'muted' },
          children: [],
        };
        cardChildren.push(`${cardId}-detail`);
      }
      elements[cardId] = { type: 'Card', props: { title: item.title }, children: cardChildren };
      columnChildren.push(cardId);
    }
    elements[columnId] = {
      type: 'Stack',
      props: { direction: 'vertical', gap: 'sm' },
      children: columnChildren,
    };
    columnIds.push(columnId);
  }
  elements.board = {
    type: 'Stack',
    props: { direction: 'horizontal', gap: 'md', align: 'start' },
    children: columnIds,
  };
  return { root: 'board', elements };
}

function findWorkboardNodes(): CanvasNodeState[] {
  return canvasState.getLayout().nodes.filter((node) => node.type === 'json-render' && node.data.workboard === true);
}

/** Rebuild one workboard node's spec in place (shared by the op and the live refresh). */
function applyWorkboardSpec(node: CanvasNodeState, spec: JsonRenderSpec): void {
  const title = typeof node.data.title === 'string' && node.data.title ? node.data.title : WORKBOARD_NODE_TITLE;
  const update = buildJsonRenderNodeUpdate(node, { title, spec });
  canvasState.updateNode(node.id, { data: update.data });
}

/**
 * Operation core for `render.workboard`: rebuild the existing workboard node
 * in place, or create one (tagged `data.workboard: true`) when none exists.
 */
export function renderWorkboard(input: { x?: number; y?: number } = {}): {
  ok: true;
  id: string;
  created: boolean;
  itemCount: number;
} {
  const workItems = canvasState.getWorkItems();
  const spec = buildWorkboardSpec(workItems);
  const existing = findWorkboardNodes()[0];
  if (existing) {
    applyWorkboardSpec(existing, spec);
    return { ok: true, id: existing.id, created: false, itemCount: workItems.length };
  }
  const created = createCanvasJsonRenderNode({
    title: WORKBOARD_NODE_TITLE,
    spec,
    width: WORKBOARD_NODE_SIZE.width,
    height: WORKBOARD_NODE_SIZE.height,
    ...(input.x !== undefined ? { x: input.x } : {}),
    ...(input.y !== undefined ? { y: input.y } : {}),
  });
  // Tag the node as THE workboard. Suppressed: the tag is part of the single
  // logical "create workboard" mutation, not a second undo step.
  canvasState.withSuppressedRecording(() => {
    canvasState.updateNode(created.id, { data: { ...created.node.data, workboard: true } });
  });
  return { ok: true, id: created.id, created: true, itemCount: workItems.length };
}

/**
 * Live refresh: rebuild every workboard node's spec from the current work-item
 * list. Registered below as the canvasState work-item change listener. Node
 * updates never touch work items, so this cannot recurse.
 */
export function refreshWorkboardNodes(): void {
  const nodes = findWorkboardNodes();
  if (nodes.length === 0) return;
  const spec = buildWorkboardSpec(canvasState.getWorkItems());
  canvasState.withSuppressedRecording(() => {
    for (const node of nodes) {
      applyWorkboardSpec(node, spec);
    }
  });
  emitCanvasLayoutUpdate();
}

canvasState.setWorkItemsChangedListener(refreshWorkboardNodes);
