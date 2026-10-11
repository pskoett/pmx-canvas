import { computed, signal } from '@preact/signals';
import { relationKind, relationPreset, relationSourceEnd } from '../../shared/relations.js';
import { activeBoard, activeBoardId } from './boards-store';
import { activeNodeId, edges, nodes } from './canvas-store';
import { hoveredNodeId } from './near-pin-store';

export const relationFilter = signal<{ boardId: string; kind: string } | null>(null);

/** View-only highlights. They never infer evidence, change a decision or execute a flow. */
export const relationHighlight = computed(() => {
  const preset = relationPreset(activeBoard()?.relationVocabulary);
  const focus = hoveredNodeId.value ?? activeNodeId.value;
  const kind = relationFilter.value?.boardId === activeBoardId.value ? relationFilter.value.kind : null;
  const list = [...edges.value.values()].filter((edge) => !edge.toBoardId || edge.toBoardId === activeBoardId.value);
  if (!focus && !kind && preset !== 'Flow') return null;
  const cards = new Set<string>(focus ? [focus] : []);
  const links = new Set<string>();
  const add = (edge: (typeof list)[number]) => {
    links.add(edge.id);
    cards.add(edge.from);
    cards.add(edge.to);
  };
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
        (edge.from === focus || edge.to === focus) &&
        (preset !== 'Research' || ['supports', 'contradicts', 'cites', 'derived-from'].includes(relationKind(edge)))
      )
        add(edge);
  }
  return { cards, links };
});
