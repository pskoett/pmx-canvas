import { describe, expect, test } from 'bun:test';
import { parseUnifiedDiff } from '../../src/client/nodes/DiffNode.tsx';

describe('parseUnifiedDiff', () => {
  test('splits a multi-file git diff into per-file sections', () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      'index 1234567..89abcde 100644',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,3 +1,3 @@',
      ' const keep = 1;',
      '-const removed = 2;',
      '+const added = 2;',
      'diff --git a/src/other.ts b/src/other.ts',
      '--- a/src/other.ts',
      '+++ b/src/other.ts',
      '@@ -10,2 +10,3 @@ export function other() {',
      ' context line',
      '+new line',
    ].join('\n');

    const sections = parseUnifiedDiff(diff);
    expect(sections.length).toBe(2);
    expect(sections[0]?.path).toBe('src/app.ts');
    expect(sections[1]?.path).toBe('src/other.ts');

    const first = sections[0]?.lines ?? [];
    expect(first.map((line) => line.kind)).toEqual(['context', 'hunk', 'context', 'remove', 'add']);
    expect(first[1]?.text).toBe('@@ -1,3 +1,3 @@');

    const second = sections[1]?.lines ?? [];
    // Hunk headers keep their trailing context text.
    expect(second[0]?.kind).toBe('hunk');
    expect(second[0]?.text).toBe('@@ -10,2 +10,3 @@ export function other() {');
    expect(second.map((line) => line.kind)).toEqual(['hunk', 'context', 'add']);
  });

  test('parses a headerless raw hunk diff as one anonymous section', () => {
    const diff = ['@@ -1,2 +1,2 @@', '-old', '+new', ' same', '\\ No newline at end of file'].join('\n');
    const sections = parseUnifiedDiff(diff);
    expect(sections.length).toBe(1);
    expect(sections[0]?.path).toBeNull();
    expect(sections[0]?.lines.map((line) => line.kind)).toEqual(['hunk', 'remove', 'add', 'context', 'context']);
  });

  test('does not misclassify ---/+++ header lines as remove/add', () => {
    const diff = ['--- a/file.txt', '+++ b/file.txt', '@@ -1 +1 @@', '-old', '+new'].join('\n');
    const sections = parseUnifiedDiff(diff);
    expect(sections.length).toBe(1);
    expect(sections[0]?.path).toBe('file.txt');
    const kinds = sections[0]?.lines.map((line) => line.kind) ?? [];
    expect(kinds).toEqual(['hunk', 'remove', 'add']);
    // The header pair never appears in the line list.
    expect(sections[0]?.lines.some((line) => line.text.startsWith('--- ') || line.text.startsWith('+++ '))).toBe(false);
  });

  test('falls back to the --- path when the +++ side is /dev/null', () => {
    const diff = ['--- a/deleted.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-gone'].join('\n');
    const sections = parseUnifiedDiff(diff);
    expect(sections[0]?.path).toBe('deleted.txt');
  });

  test('returns no sections for empty or whitespace-only content', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('   \n \n')).toEqual([]);
  });
});
