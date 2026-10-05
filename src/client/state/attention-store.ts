import { signal } from '@preact/signals';

export type AttentionTone = 'context' | 'relationship' | 'group' | 'cluster' | 'neighborhood' | 'remove';

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
export const attentionPulseNodeIds = signal<Set<string>>(new Set());
export const attentionHistoryOpen = signal<boolean>(false);
export const attentionHistoryUnread = signal<number>(0);

export function resetAttentionState(): void {
  attentionToast.value = null;
  attentionHistory.value = [];
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
