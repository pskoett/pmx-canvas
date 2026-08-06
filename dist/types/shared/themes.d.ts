/**
 * Canonical canvas theme registry — single source of truth for every layer
 * that validates, stores, or renders a theme name (client shell, HTML
 * surfaces, json-render viewer, CLI/env plumbing, persistence).
 *
 * Adding a theme: add the name here, author its variable blocks in
 * src/client/theme/global.css AND src/client/theme/surface-theme.css (guarded
 * by tests/unit/surface-theme-tokens.test.ts), and give it meta below. The
 * theme picker, server validation, and surface documents pick it up from this
 * list.
 */
export declare const CANVAS_THEMES: readonly ["dark", "light", "high-contrast", "midnight", "sepia", "arctic", "ember", "forest", "volt"];
export type CanvasThemeName = (typeof CANVAS_THEMES)[number];
export declare function isCanvasTheme(value: unknown): value is CanvasThemeName;
export declare function normalizeCanvasThemeName(value: unknown, fallback?: CanvasThemeName): CanvasThemeName;
export interface CanvasThemeMeta {
    /** Human label shown in the theme picker. */
    label: string;
    /** Whether embedded viewers that only know dark/light should treat it as light. */
    scheme: 'dark' | 'light';
    /** Picker swatch colors — MUST match --c-bg / --c-accent in global.css. */
    swatchBg: string;
    swatchAccent: string;
}
export declare const CANVAS_THEME_META: Record<CanvasThemeName, CanvasThemeMeta>;
/** Collapse a theme to the dark/light scheme embedded dark|light-only viewers understand. */
export declare function canvasThemeScheme(value: unknown): 'dark' | 'light';
