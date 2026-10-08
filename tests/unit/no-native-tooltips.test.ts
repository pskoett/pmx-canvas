import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// CLAUDE.md, "No native browser UI in client flows": a `title` tooltip is a
// silent no-op in the embedded panes (Claude, Copilot, Codex) the workbench
// runs in. Hints use BarHint. A frame's `title` is its accessible name, not a
// tooltip, so iframes keep theirs. Components (capitalised) take a `title`
// prop of their own; only HTML elements render the attribute.

const ROOT = join(import.meta.dir, '../../src/client');
const FRAME_TAGS = new Set(['iframe']);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

/** The JSX tag a `title=` at `index` belongs to: the nearest unclosed `<Tag` before it. */
function enclosingTag(source: string, index: number): string | null {
  const before = source.slice(0, index);
  const open = before.lastIndexOf('<');
  const match = /^<([A-Za-z][\w.]*)/.exec(before.slice(open));
  return match ? match[1]! : null;
}

describe('no native title tooltips in the client', () => {
  test('no HTML element in src/client carries a title tooltip, except frames', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(ROOT)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\stitle=[{"]/g)) {
        const tag = enclosingTag(source, match.index!);
        if (!tag || FRAME_TAGS.has(tag) || /^[A-Z]/.test(tag)) continue;
        const line = source.slice(0, match.index!).split('\n').length;
        offenders.push(`${relative(ROOT, file)}:${line} <${tag ?? '?'}>`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
