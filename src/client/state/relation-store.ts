import { computed, effect, signal } from '@preact/signals';
import { relationKind, relationPreset, relationSourceEnd } from '../../shared/relations.js';
import { memoryKey } from '../../shared/memory-graph.js';
import { activeBoard, activeBoardId } from './boards-store';
import {
  activeNodeId,
  edges,
  nodes,
  selectedNodeIds,
  focusNode,
  collapseExpandedNode,
  canvasInteractionEpoch,
} from './canvas-store';
import { cardQualification } from './knowledge-store';
import type { CanvasEdge } from '../types';

export const relationFilter = signal<{ boardId: string; kind: string } | null>(null);
const inspection = signal<{ boardId: string; nodeId: string; mode: 'lineage' | 'connections'; epoch: number } | null>(
  null,
);

export function showRelationsOnCanvas(nodeId: string, mode: 'lineage' | 'connections'): void {
  const boardId = activeBoardId.value;
  if (!boardId) return;
  collapseExpandedNode();
  selectedNodeIds.value = new Set();
  relationFilter.value = null;
  focusNode(nodeId, { recordHistory: false, persistStacking: false });
  activeNodeId.value = nodeId;
  inspection.value = { boardId, nodeId, mode, epoch: canvasInteractionEpoch.value };
}

effect(() => {
  const value = inspection.value;
  if (
    value &&
    (value.boardId !== activeBoardId.value ||
      value.nodeId !== activeNodeId.value ||
      value.epoch !== canvasInteractionEpoch.value ||
      relationFilter.value)
  )
    inspection.value = null;
});

/** Only qualified dependency/lineage sources warn; citations and illustrated loops never do. */
export function relationWarning(edge: CanvasEdge): string[] {
  const boardId = activeBoardId.value;
  const kind = relationKind(edge);
  if (!boardId || !['depends-on', 'derived-from'].includes(kind)) return [];
  const from = { boardId, cardId: edge.from };
  const to = { boardId: edge.toBoardId ?? boardId, cardId: edge.to };
  const source = relationSourceEnd(edge) === 'from' ? from : to;
  const dependent = relationSourceEnd(edge) === 'from' ? to : from;
  if (dependent.boardId !== boardId) return [];
  return (
    cardQualification(dependent.cardId)?.sourceWarnings?.[
      JSON.stringify([boardId, edge.id, kind, memoryKey(source)])
    ] ?? []
  );
}

export const dependencyAnalysis = computed(() => {
  const links = [...edges.value.values()].filter((edge) => !edge.toBoardId && relationKind(edge) === 'depends-on');
  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  for (const edge of links) {
    if (!forward.has(edge.from)) forward.set(edge.from, new Set());
    if (!forward.has(edge.to)) forward.set(edge.to, new Set());
    if (!reverse.has(edge.from)) reverse.set(edge.from, new Set());
    if (!reverse.has(edge.to)) reverse.set(edge.to, new Set());
    forward.get(edge.from)!.add(edge.to);
    reverse.get(edge.to)!.add(edge.from);
  }
  // Iterative strongly connected components: one count per cyclic dependency cluster.
  const visited = new Set<string>();
  const order: string[] = [];
  for (const root of forward.keys()) {
    const stack: Array<[string, boolean]> = [[root, false]];
    while (stack.length) {
      const [id, done] = stack.pop()!;
      if (done) {
        order.push(id);
        continue;
      }
      if (visited.has(id)) continue;
      visited.add(id);
      stack.push([id, true]);
      for (const next of forward.get(id) ?? []) if (!visited.has(next)) stack.push([next, false]);
    }
  }
  const assigned = new Set<string>();
  const cyclic = new Map<string, number>();
  let cycles = 0;
  for (const root of order.reverse()) {
    if (assigned.has(root)) continue;
    const component = new Set<string>([root]);
    assigned.add(root);
    for (const id of component)
      for (const next of reverse.get(id) ?? []) {
        if (assigned.has(next)) continue;
        assigned.add(next);
        component.add(next);
      }
    if (component.size > 1 || forward.get(root)?.has(root)) {
      cycles++;
      for (const id of component) cyclic.set(id, cycles);
    }
  }
  const cycleEdges = new Set(
    links
      .filter((edge) => cyclic.has(edge.from) && cyclic.get(edge.from) === cyclic.get(edge.to))
      .map((edge) => edge.id),
  );
  const roots = new Set(selectedNodeIds.value);
  if (activeNodeId.value) roots.add(activeNodeId.value);
  const affected = new Set(roots);
  for (const id of affected) for (const next of reverse.get(id) ?? []) affected.add(next);
  for (const id of roots) affected.delete(id);
  return { cycles, cycleEdges, affected, focused: roots.size > 0, hasDependencies: links.length > 0 };
});

effect(() => {
  const filter = relationFilter.value;
  if (
    filter?.boardId === activeBoardId.value &&
    ![...edges.value.values()].some((edge) => relationKind(edge) === filter.kind)
  ) {
    relationFilter.value = null;
  }
});

// Hover is for hints, not for changing which cards remain readable.
export const relationFocus = computed(() => activeNodeId.value);

/** View-only highlights. They never infer evidence, change a decision or execute a flow. */
export const relationHighlight = computed(() => {
  const preset = relationPreset(activeBoard()?.relationVocabulary);
  const focus = relationFocus.value;
  const kind = relationFilter.value?.boardId === activeBoardId.value ? relationFilter.value.kind : null;
  const list = [...edges.value.values()].filter((edge) => !edge.toBoardId || edge.toBoardId === activeBoardId.value);
  const focusedCards = new Set(selectedNodeIds.value);
  if (focus) focusedCards.add(focus);
  if (focusedCards.size === 0 && !kind) return null;
  // Selecting a frame focuses its contents too, including nested groups.
  for (const id of focusedCards) {
    const node = nodes.value.get(id);
    if (node?.type === 'group' && Array.isArray(node.data.children))
      for (const child of node.data.children) if (typeof child === 'string') focusedCards.add(child);
  }
  const cards = new Set(focusedCards);
  const links = new Set<string>();
  const add = (edge: (typeof list)[number]) => {
    links.add(edge.id);
    cards.add(edge.from);
    cards.add(edge.to);
  };
  const view = inspection.value;
  if (view && view.boardId === activeBoardId.value && view.nodeId === focus && !kind) {
    if (view.mode === 'connections') {
      for (const edge of list) if (edge.from === focus || edge.to === focus) add(edge);
    } else {
      for (const id of cards)
        for (const edge of list)
          if (['derived-from', 'depends-on'].includes(relationKind(edge)) && (edge.from === id || edge.to === id))
            add(edge);
    }
    return { cards, links };
  }
  if (!kind) for (const edge of list) if (focusedCards.has(edge.from) && focusedCards.has(edge.to)) add(edge);
  if (kind) {
    for (const edge of list) if (relationKind(edge) === kind) add(edge);
  } else if (preset === 'Dependencies' || preset === 'Decision') {
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of list) {
        if (links.has(edge.id)) continue;
        const source = relationSourceEnd(edge);
        const follows =
          preset === 'Dependencies'
            ? source && cards.has(source === 'from' ? edge.from : edge.to)
            : ['option', 'if', 'chosen'].includes(relationKind(edge)) && cards.has(edge.to);
        if (follows) {
          add(edge);
          changed = true;
        }
      }
    }
  } else if (preset === 'Flow') {
    const progressed = new Set<string>();
    for (const node of nodes.value.values())
      if (['done', 'in-progress', 'blocked'].includes(String(node.data.axWorkStatus))) {
        progressed.add(node.id);
        cards.add(node.id);
      }
    for (const edge of list)
      if (['flow', 'next', 'if-fails', 'loop'].includes(relationKind(edge)) && progressed.has(edge.from)) add(edge);
  } else {
    for (const edge of list)
      if (
        (focusedCards.has(edge.from) || focusedCards.has(edge.to)) &&
        (preset !== 'Research' || ['supports', 'contradicts', 'cites', 'derived-from'].includes(relationKind(edge)))
      )
        add(edge);
  }
  return { cards, links };
});
