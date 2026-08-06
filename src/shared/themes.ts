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

export const CANVAS_THEMES = [
  'dark',
  'light',
  'high-contrast',
  'midnight',
  'sepia',
  'arctic',
  'ember',
  'forest',
  'volt',
] as const;

export type CanvasThemeName = (typeof CANVAS_THEMES)[number];

export function isCanvasTheme(value: unknown): value is CanvasThemeName {
  return typeof value === 'string' && (CANVAS_THEMES as readonly string[]).includes(value);
}

export function normalizeCanvasThemeName(value: unknown, fallback: CanvasThemeName = 'dark'): CanvasThemeName {
  return isCanvasTheme(value) ? value : fallback;
}

export interface CanvasThemeMeta {
  /** Human label shown in the theme picker. */
  label: string;
  /** Whether embedded viewers that only know dark/light should treat it as light. */
  scheme: 'dark' | 'light';
  /** Picker swatch colors — MUST match --c-bg / --c-accent in global.css. */
  swatchBg: string;
  swatchAccent: string;
}

export const CANVAS_THEME_META: Record<CanvasThemeName, CanvasThemeMeta> = {
  dark: { label: 'Dark', scheme: 'dark', swatchBg: '#081524', swatchAccent: '#4BBCFF' },
  light: { label: 'Light', scheme: 'light', swatchBg: '#F4EFE6', swatchAccent: '#1A7ABF' },
  'high-contrast': { label: 'High contrast', scheme: 'dark', swatchBg: '#000000', swatchAccent: '#00ffff' },
  midnight: { label: 'Midnight', scheme: 'dark', swatchBg: '#0A0D1C', swatchAccent: '#8B96FF' },
  sepia: { label: 'Sepia', scheme: 'light', swatchBg: '#F2E7D5', swatchAccent: '#B4632C' },
  arctic: { label: 'Arctic', scheme: 'dark', swatchBg: '#20242E', swatchAccent: '#7FC8DE' },
  ember: { label: 'Ember', scheme: 'dark', swatchBg: '#0B0B0C', swatchAccent: '#F34E1C' },
  forest: { label: 'Forest', scheme: 'dark', swatchBg: '#0C1712', swatchAccent: '#5CCF8F' },
  volt: { label: 'Volt', scheme: 'dark', swatchBg: '#0B0D0B', swatchAccent: '#F34E3F' },
};

/** Collapse a theme to the dark/light scheme embedded dark|light-only viewers understand. */
export function canvasThemeScheme(value: unknown): 'dark' | 'light' {
  return CANVAS_THEME_META[normalizeCanvasThemeName(value)].scheme;
}
