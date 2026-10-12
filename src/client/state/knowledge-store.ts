import { effect, signal } from '@preact/signals';
import type { KnowledgeResults } from '../../server/knowledge-lifecycle.js';
import { memoryKey } from '../../shared/memory-graph.js';
import { activeBoardId, boardIncarnation } from './boards-store';
import { requestJson } from './intent-bridge';

export const knowledge = signal<KnowledgeResults['list'] | null>(null);
export const knowledgeUnavailable = signal(false);
export const lifecycleFilter = signal<'All' | 'To review' | 'Retired'>('All');
effect(() => {
  activeBoardId.value;
  lifecycleFilter.value = 'All';
});
export const lifecycleTarget = signal<{ boardId: string; nodeId: string; incarnation: number } | null>(null);
export const retirementUndo = signal<{ boardId: string; nodeId: string; incarnation: number } | null>(null);
let sequence = 0;

export async function refreshKnowledge(): Promise<void> {
  const request = ++sequence;
  const incarnation = boardIncarnation;
  const result = await requestJson<KnowledgeResults['list'] | null>('knowledge', '/api/canvas/knowledge', null);
  if (request !== sequence || incarnation !== boardIncarnation) return;
  knowledgeUnavailable.value = !result;
  if (result) knowledge.value = result;
}

export function cardQualification(nodeId: string) {
  return activeBoardId.value
    ? knowledge.value?.cards[memoryKey({ boardId: activeBoardId.value, cardId: nodeId })]
    : undefined;
}

export function openLifecycle(nodeId: string): void {
  if (activeBoardId.value)
    lifecycleTarget.value = { boardId: activeBoardId.value, nodeId, incarnation: boardIncarnation };
}
