import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The meaning colours (docs/design.md, "Token system") keep one meaning in every
// theme: blue = in the agent's context, violet = what the agent did, amber = needs
// a look, plus the relation inks. This keeps them readable on each theme's panel
// and apart from each other. surface-theme-tokens.test.ts keeps surface-theme.css
// identical, so global.css is the only file read here.

const globalCss = readFileSync(resolve(import.meta.dir, '../../src/client/theme/global.css'), 'utf-8');

const THEME_SELECTORS = [
  ':root',
  ':root[data-theme="daylight"]',
  ':root[data-theme="high-contrast"]',
  ':root[data-theme="midnight"]',
  ':root[data-theme="sepia"]',
  ':root[data-theme="arctic"]',
  ':root[data-theme="ember"]',
  ':root[data-theme="forest"]',
  ':root[data-theme="volt"]',
];

const CORE = ['--c-pin', '--c-agent', '--c-subagent', '--c-warn'];
const RELATIONS = [
  '--c-rel-supports',
  '--c-rel-contradicts',
  '--c-rel-cites',
  '--c-rel-derived',
  '--c-rel-informs',
  '--c-rel-related',
];

const MIN_CONTRAST = 3;
// OKLab distance; about three times a just-noticeable difference.
const MIN_SEPARATION = 0.06;

function themeBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = globalCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`selector not found: ${selector}`);
  return match[1];
}

function hexVar(block: string, name: string): string {
  const match = block.match(new RegExp(`(?:^|[;{\\s])${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!match) throw new Error(`${name} is not a 6-digit hex colour`);
  return match[1];
}

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
}

function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = channels(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function oklab(hex: string): number[] {
  const [r, g, b] = channels(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function separation(a: string, b: string): number {
  const p = oklab(a);
  const q = oklab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

describe('meaning colours', () => {
  for (const selector of THEME_SELECTORS) {
    const block = themeBlock(selector);

    test(`read at ${MIN_CONTRAST}:1 on the panel for ${selector}`, () => {
      const panel = hexVar(block, '--c-panel');
      for (const token of [...CORE, ...RELATIONS]) {
        const ratio = contrast(hexVar(block, token), panel);
        expect(ratio, `${token} on --c-panel is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      }
    });

    test(`stay apart for ${selector}`, () => {
      const tokens = [...CORE, ...RELATIONS];
      for (let i = 0; i < tokens.length; i++) {
        for (let j = i + 1; j < tokens.length; j++) {
          const d = separation(hexVar(block, tokens[i]), hexVar(block, tokens[j]));
          expect(d, `${tokens[i]} vs ${tokens[j]} OKLab distance ${d.toFixed(3)}`).toBeGreaterThanOrEqual(
            MIN_SEPARATION,
          );
        }
      }
    });
  }
});
