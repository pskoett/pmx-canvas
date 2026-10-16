import { computed, signal } from '@preact/signals';
import { knowledgeLifecycleEnabled } from './workspace-settings';
import type { KnowledgeResults } from '../../server/knowledge-lifecycle.js';
import { memoryKey } from '../../shared/memory-graph.js';
import { activeBoardId, boardIncarnation, lifecycleFilter } from './boards-store';
import { contextPinnedNodeIds } from './canvas-store';
import { requestJson } from './intent-bridge';

import { lifecycleTarget } from './boards-store';
export { lifecycleFilter, lifecycleTarget } from './boards-store';

export const knowledge = signal<KnowledgeResults['list'] | null>(null);
export const knowledgeUnavailable = signal(false);
export const effectiveLifecycleFilter = computed(() =>
  knowledgeLifecycleEnabled.value ? lifecycleFilter.value : 'All',
);
export const retirementUndo = signal<{ boardId: string; nodeId: string; incarnation: number } | null>(null);
let sequence = 0;

export async function refreshKnowledge(): Promise<void> {
  const request = ++sequence;
  const incarnation = boardIncarnation;
  const result = await requestJson<KnowledgeResults['list'] | null>('knowledge', '/api/canvas/knowledge', null);
  if (request !== sequence || incarnation !== boardIncarnation) return;
  knowledgeUnavailable.value = result?.ok !== true;
  if (result?.ok === true) knowledge.value = result;
}

export function cardQualification(nodeId: string) {
  return activeBoardId.value
    ? knowledge.value?.cards[memoryKey({ boardId: activeBoardId.value, cardId: nodeId })]
    : undefined;
}

/** Raw pin membership survives retirement, but retired cards are not delivered. */
export const activeContextPinnedNodeIds = computed(
  () => new Set([...contextPinnedNodeIds.value].filter((id) => !cardQualification(id)?.retired)),
);

export function openLifecycle(nodeId: string): void {
  if (knowledgeLifecycleEnabled.value && activeBoardId.value)
    lifecycleTarget.value = { boardId: activeBoardId.value, nodeId, incarnation: boardIncarnation };
}
