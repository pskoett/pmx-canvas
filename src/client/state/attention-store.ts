import { signal } from '@preact/signals';
import type { SemanticAttentionRegion } from '../../shared/semantic-attention.js';

export type AttentionTone =
  | 'context'
  | 'relationship'
  | 'group'
  | 'cluster'
  | 'neighborhood'
  | 'remove';

export interface AttentionEntry {
  id: string;
  tone: AttentionTone;
  title: string;
  detail: string;
  nodeIds: string[];
  createdAt: number;
}

export const attentionToast = signal<AttentionEntry | null>(null);
export const attentionHistory = signal<AttentionEntry[]>([]);
export const attentionPrimaryNodeIds = signal<Set<string>>(new Set());
export const attentionSecondaryNodeIds = signal<Set<string>>(new Set());
export const attentionRegions = signal<SemanticAttentionRegion[]>([]);
export const attentionPulseNodeIds = signal<Set<string>>(new Set());
export const attentionHistoryOpen = signal<boolean>(false);
export const attentionHistoryUnread = signal<number>(0);

export function resetAttentionState(): void {
  attentionToast.value = null;
  attentionHistory.value = [];
  attentionPrimaryNodeIds.value = new Set();
  attentionSecondaryNodeIds.value = new Set();
  attentionRegions.value = [];
  attentionPulseNodeIds.value = new Set();
  attentionHistoryOpen.value = false;
  attentionHistoryUnread.value = 0;
}

export function openAttentionHistory(): void {
  attentionHistoryOpen.value = true;
  attentionHistoryUnread.value = 0;
}

export function closeAttentionHistory(): void {
  attentionHistoryOpen.value = false;
}

export function setAttentionFocus(
  primaryNodeIds: string[],
  secondaryNodeIds: string[],
  regions: SemanticAttentionRegion[],
): void {
  attentionPrimaryNodeIds.value = new Set(primaryNodeIds);
  attentionSecondaryNodeIds.value = new Set(secondaryNodeIds);
  attentionRegions.value = regions;
}

export function setAttentionToast(entry: AttentionEntry | null): void {
  attentionToast.value = entry;
}

export function pushAttentionHistory(entry: AttentionEntry, limit = 6): void {
  attentionHistory.value = [entry, ...attentionHistory.value].slice(0, limit);
  if (!attentionHistoryOpen.value) {
    attentionHistoryUnread.value = Math.min(99, attentionHistoryUnread.value + 1);
  }
}

export function setAttentionPulse(nodeIds: string[]): void {
  attentionPulseNodeIds.value = new Set(nodeIds);
}
