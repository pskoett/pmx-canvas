import type { MemoryTarget } from './memory-graph.js';

export interface SourceQualification extends MemoryTarget {
  title: string;
  reasons: string[];
  unavailable?: true;
  contentRevision?: number;
  observedRevision?: number;
  observedAt?: string;
}

export interface LifecycleQualification {
  retired: boolean;
  unknown: boolean;
  due: boolean;
  reasons: string[];
  changedSinceRead: boolean;
  lastReadAt: string | null;
  lastValidatedAt: string | null;
  contentRevision: number;
  contentChangedAt: string | null;
  /** The revisions a validating reviewer must have inspected, qualified by source relation. */
  observations: Record<string, number | null>;
  sources: SourceQualification[];
  relevance: 'card-pinned' | 'board-pinned' | 'not-selected';
}
