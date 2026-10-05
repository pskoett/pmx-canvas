import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// surface-theme.css is a standalone copy of the core palette so the server can
// serve themed HTML surfaces without reading the DOM. This guards it against
// drifting from global.css (the canvas-shell source of truth). If you change a
// palette value, change it in BOTH files.

const themeDir = resolve(import.meta.dir, '../../src/client/theme');
const globalCss = readFileSync(resolve(themeDir, 'global.css'), 'utf-8');
const surfaceCss = readFileSync(resolve(themeDir, 'surface-theme.css'), 'utf-8');

const CORE_TOKENS = [
  '--c-bg',
  '--c-panel',
  '--c-panel-soft',
  '--c-line',
  '--c-text',
  '--c-text-soft',
  '--c-muted',
  '--c-dim',
  '--c-accent',
  '--c-ok',
  '--c-warn',
  '--c-warn-alt',
  '--c-danger',
  '--c-purple',
  '--c-pin',
  '--c-agent',
  '--c-subagent',
  '--c-rel-supports',
  '--c-rel-contradicts',
  '--c-rel-cites',
  '--c-rel-derived',
  '--c-rel-informs',
  '--c-rel-related',
];

const THEME_SELECTORS = [
  ':root',
  ':root[data-theme="light"]',
  ':root[data-theme="high-contrast"]',
  ':root[data-theme="midnight"]',
  ':root[data-theme="sepia"]',
  ':root[data-theme="arctic"]',
  ':root[data-theme="ember"]',
  ':root[data-theme="forest"]',
  ':root[data-theme="volt"]',
];

function selectorBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`selector not found: ${selector}`);
  return match[1];
}

function readVar(block: string, name: string): string | null {
  const escaped = name.replace(/-/g, '\\-');
  const match = block.match(new RegExp(`(?:^|[;{\\s])${escaped}\\s*:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
}

describe('surface-theme.css stays in sync with global.css', () => {
  for (const selector of THEME_SELECTORS) {
    test(`core palette matches for ${selector}`, () => {
      const globalBlock = selectorBlock(globalCss, selector);
      const surfaceBlock = selectorBlock(surfaceCss, selector);
      for (const token of CORE_TOKENS) {
        const expected = readVar(globalBlock, token);
        expect(expected, `${token} missing from global.css ${selector}`).not.toBeNull();
        expect(readVar(surfaceBlock, token), `${token} drift in surface-theme.css ${selector}`).toBe(expected);
      }
    });
  }

  test('font and scale tokens match in :root', () => {
    const globalBlock = selectorBlock(globalCss, ':root');
    const surfaceBlock = selectorBlock(surfaceCss, ':root');
    const scale = [
      '--fs-meta',
      '--fs-ui',
      '--fs-body',
      '--fs-title',
      '--fs-heading',
      '--space-1',
      '--space-2',
      '--space-3',
      '--space-4',
      '--space-6',
      '--space-8',
      '--r-control',
      '--r-node',
      '--r-overlay',
      '--r-pill',
      '--e-1',
      '--e-2',
    ];
    for (const token of ['--font-ui', '--font-code', ...scale]) {
      expect(readVar(globalBlock, token), `${token} missing from global.css :root`).not.toBeNull();
      expect(readVar(surfaceBlock, token)).toBe(readVar(globalBlock, token));
    }
  });

  test('light-theme elevation overrides match', () => {
    for (const selector of [':root[data-theme="light"]', ':root[data-theme="sepia"]']) {
      const globalBlock = selectorBlock(globalCss, selector);
      const surfaceBlock = selectorBlock(surfaceCss, selector);
      for (const token of ['--e-1', '--e-2']) {
        expect(readVar(globalBlock, token), `${token} missing from global.css ${selector}`).not.toBeNull();
        expect(readVar(surfaceBlock, token)).toBe(readVar(globalBlock, token));
      }
    }
  });

  // The --color-* aliases are written as literals per theme (so JS readers get a
  // resolved color). Each must mirror its core --c-* token in the same block.
  const ALIAS_TO_CORE: Record<string, string> = {
    '--color-bg': '--c-bg',
    '--color-panel': '--c-panel',
    '--color-surface': '--c-panel-soft',
    '--color-border': '--c-line',
    '--color-text': '--c-text',
    '--color-text-primary': '--c-text',
    '--color-text-secondary': '--c-text-soft',
    '--color-text-muted': '--c-muted',
    '--color-text-dim': '--c-dim',
    '--color-accent': '--c-accent',
    '--color-success': '--c-ok',
    '--color-warning': '--c-warn',
    '--color-danger': '--c-danger',
  };

  for (const selector of THEME_SELECTORS) {
    test(`--color-* aliases mirror core tokens for ${selector}`, () => {
      const block = selectorBlock(surfaceCss, selector);
      for (const [alias, core] of Object.entries(ALIAS_TO_CORE)) {
        expect(readVar(block, alias), `${alias} should equal ${core}`).toBe(readVar(block, core));
      }
    });
  }
});
