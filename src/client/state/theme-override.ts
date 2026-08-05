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
import { type CanvasThemeName, isCanvasTheme } from '../../shared/themes.js';

let active = false;
// Latched when the user explicitly ends the override: the URL param survives
// reconnects (connectSSE re-inits on every transport drop), but the user's
// choice must stick for the page lifetime — only a reload re-activates.
let userEnded = false;
let schemeQuery: MediaQueryList | null = null;
let schemeListener: (() => void) | null = null;

export function themeOverrideActive(): boolean {
  return active;
}

/** Test-only: reset the module state, including the page-lifetime latch. */
export function resetThemeOverrideForTests(): void {
  active = false;
  userEnded = false;
  detachSchemeListener();
}

/** The user picked a theme explicitly — the session override ends for good. */
export function clearThemeOverride(): void {
  active = false;
  userEnded = true;
  detachSchemeListener();
}

function detachSchemeListener(): void {
  if (schemeQuery && schemeListener) {
    schemeQuery.removeEventListener('change', schemeListener);
  }
  schemeQuery = null;
  schemeListener = null;
}

export function sessionThemeParam(): CanvasThemeName | 'auto' | null {
  // DOM-less callers (server-side rendering of the module graph, unit tests
  // that import the sse-bridge without a DOM) have no override.
  if (typeof window === 'undefined' || !window.location) return null;
  const value = new URLSearchParams(window.location.search).get('theme');
  if (value === 'auto') return 'auto';
  return isCanvasTheme(value) ? value : null;
}

/**
 * Activate the override from the URL (no-op without a valid `?theme=`).
 * `apply` is the canvas theme applier (client-side only — never saved).
 */
export function initSessionThemeOverride(apply: (theme: CanvasThemeName) => void): void {
  if (userEnded) return;
  const param = sessionThemeParam();
  if (!param) return;
  // Re-init happens on every reconnect — replace any prior listener instead
  // of accumulating one per reconnect cycle.
  detachSchemeListener();
  active = true;
  if (param !== 'auto') {
    apply(param);
    return;
  }
  schemeQuery = window.matchMedia('(prefers-color-scheme: light)');
  schemeListener = () => {
    if (active && schemeQuery) apply(schemeQuery.matches ? 'light' : 'dark');
  };
  schemeListener();
  schemeQuery.addEventListener('change', schemeListener);
}
