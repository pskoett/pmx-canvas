/**
 * Per-session theme override — host-default theming.
 *
 * Hosts that embed the workbench (the GitHub Copilot panel, the Claude Code
 * desktop browser pane, ChatGPT-style app browsers, …) can open it with
 * `?theme=<name>` or `?theme=auto` to give THEIR panel a fitting default
 * without touching the server-global theme every other client sees. The
 * override is client-local: server theme frames are ignored while it is
 * active, and it ends the moment the user explicitly picks a theme from the
 * picker (which then applies + saves globally as usual).
 *
 * `theme=auto` follows the host's prefers-color-scheme live, mapping to the
 * built-in light/dark themes — so a light-mode host panel gets a light canvas
 * by default and flips with the host appearance.
 */
import { type CanvasThemeName } from '../../shared/themes.js';
export declare function themeOverrideActive(): boolean;
/** The user picked a theme explicitly — the session override ends. */
export declare function clearThemeOverride(): void;
export declare function sessionThemeParam(): CanvasThemeName | 'auto' | null;
/**
 * Activate the override from the URL (no-op without a valid `?theme=`).
 * `apply` is the canvas theme applier (client-side only — never saved).
 */
export declare function initSessionThemeOverride(apply: (theme: CanvasThemeName) => void): void;
