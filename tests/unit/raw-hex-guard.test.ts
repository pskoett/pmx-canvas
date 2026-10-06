import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

// Raw colour values live only in the theme blocks of the two theme files
// (docs/design.md, "Token system"); everything else references tokens. The
// allowlist holds colours that are content, not theme: data a person picks or
// that a page draws itself. Shrink it, never grow it without a reason.

const root = resolve(import.meta.dir, '../..');
const clientDir = join(root, 'src/client');
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

const ALLOWED: Record<string, string[]> = {
  // Group frame colours a person picks from the menu; stored on the node.
  'src/client/canvas/ContextMenu.tsx': ['#4bbcFF', '#3b82f6', '#22c55e', '#eab308', '#ef4444', '#6b7280', '#a855f7'],
  // Default stroke for a freehand annotation; stored on the annotation.
  'src/client/state/sse-bridge.ts': ['#f97316'],
  // A webpage preview draws on the page's own white, as a browser would.
  'src/client/nodes/WebpageNode.tsx': ['#fff'],
  // Fallback in the embedded Mermaid viewer, which can load without the theme
  // stylesheet; goes when the frame host passes tokens (wave 4).
  'src/client/mermaid-entry.ts': ['#8a93a6'],
};

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'theme' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('raw hex colours stay in the theme files', () => {
  test('client components reference tokens', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(clientDir)) {
      const rel = relative(root, file).split(sep).join('/');
      const allowed = ALLOWED[rel] ?? [];
      for (const hex of stripComments(readFileSync(file, 'utf-8')).match(HEX) ?? []) {
        if (!allowed.includes(hex)) offenders.push(`${rel}: ${hex}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('global.css has hex colours only inside theme blocks', () => {
    const css = stripComments(readFileSync(join(clientDir, 'theme/global.css'), 'utf-8'));
    const outsideThemes = css.replace(/:root(\[data-theme="[a-z-]+"\])?\s*\{[^}]*\}/g, '');
    expect(outsideThemes.match(HEX) ?? []).toEqual([]);
  });
});
