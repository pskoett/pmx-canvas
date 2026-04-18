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
    warnAlt: string;
    danger: string;
    purple: string;
    thinking: string;
    subagent: string;
    font: string;
    mono: string;
}
/** Return current canvas tokens (reads computed CSS vars). */
export declare function getCanvasTokens(): CanvasTokens;
/** Invalidate the cached tokens (call after theme switch). */
export declare function invalidateTokenCache(): void;
/** Agent execution phase → CSS color mapping. Shared by StatusNode and StatusSummary. */
export declare const PHASE_COLORS: Record<string, string>;
