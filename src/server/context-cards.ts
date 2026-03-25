/**
 * Context cards — standalone version.
 *
 * In the full PMX project this reads project memory and context doc definitions.
 * In the standalone canvas, we expose the types and a simplified builder that
 * returns an empty card list (the host application can populate cards via the API).
 */

export type WorkbenchContextCardCategory = 'profile' | 'planning' | 'tooling' | 'memory';

export interface WorkbenchContextCard {
  key: string;
  label: string;
  summary: string;
  path: string;
  exists: boolean;
  required: boolean;
  staleDays: number;
  mtimeMs: number | null;
  state: 'loaded' | 'missing' | 'stale' | 'invalid';
  sourceKind: 'workspace' | 'global';
  note: string | null;
  injectMode: 'startup';
  category: WorkbenchContextCardCategory;
}

export function buildWorkbenchContextCards(_workspaceRoot = process.cwd()): WorkbenchContextCard[] {
  // Standalone canvas does not have access to PMX context doc definitions.
  // Return empty — the host application populates cards via the event API.
  return [];
}
