/** Canvas design tokens — reads from CSS custom properties for theme support. */

export interface CanvasTokens {
  bg: string;
  panel: string;
  panelSoft: string;
  line: string;
  text: string;
  textSoft: string;
  muted: string;
  dim: string;
  accent: string;
  ok: string;
  warn: string;
  danger: string;
  agent: string;
  subagent: string;
  font: string;
  mono: string;
}

let cached: CanvasTokens | null = null;

function read(prop: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
}

/** Return current canvas tokens (reads computed CSS vars). */
export function getCanvasTokens(): CanvasTokens {
  if (cached) return cached;
  cached = {
    bg: read('--c-bg'),
    panel: read('--c-panel'),
    panelSoft: read('--c-panel-soft'),
    line: read('--c-line'),
    text: read('--c-text'),
    textSoft: read('--c-text-soft'),
    muted: read('--c-muted'),
    dim: read('--c-dim'),
    accent: read('--c-accent'),
    ok: read('--c-ok'),
    warn: read('--c-warn'),
    danger: read('--c-danger'),
    agent: read('--c-agent'),
    subagent: read('--c-subagent'),
    font: read('--font-ui'),
    mono: read('--font-code'),
  };
  return cached;
}

/** Invalidate the cached tokens (call after theme switch). */
export function invalidateTokenCache(): void {
  cached = null;
}

/** Agent execution phase → CSS color mapping. Shared by StatusNode and StatusSummary. */
export const PHASE_COLORS: Record<string, string> = {
  idle: 'var(--c-muted)',
  running: 'var(--c-accent)',
  planning: 'var(--c-agent)',
  thinking: 'var(--c-agent)',
  drafting: 'var(--c-accent)',
  tooling: 'var(--c-accent)',
  review: 'var(--c-ok)',
  'waiting-approval': 'var(--c-warn)',
  waiting: 'var(--c-warn)',
};
