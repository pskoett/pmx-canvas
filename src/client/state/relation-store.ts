import { computed, effect, signal } from '@preact/signals';
import { relationKind, relationPreset, relationSourceEnd } from '../../shared/relations.js';
import { activeBoard, activeBoardId } from './boards-store';
import { activeNodeId, edges, nodes, selectedNodeIds } from './canvas-store';

export const relationFilter = signal<{ boardId: string; kind: string } | null>(null);

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
