import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CORE_TOUCHES, GUIDE } from '../acceptance/guide.ts';

// The acceptance runner carries a row forward while its files are unchanged, so a stale
// reference in the manifest would silently stop proving that row. Fail at unit-test time instead.
const ROOT = resolve(import.meta.dir, '../..');
const e2eSource = readdirSync(join(ROOT, 'tests/e2e'))
  .filter((file) => file.endsWith('.pw.ts'))
  .map((file) => readFileSync(join(ROOT, 'tests/e2e', file), 'utf8'))
  .join('\n');
// The same file set the runner fingerprints: tracked and untracked, minus ignored files.
const sourceFiles = Bun.spawnSync(['git', 'ls-files', '-co', '--exclude-standard'], { cwd: ROOT })
  .stdout.toString()
  .split('\n')
  .filter(Boolean);

describe('owner acceptance guide manifest', () => {
  test('numbers rows 01..N once each, in order', () => {
    expect(GUIDE.map((row) => row.id)).toEqual(GUIDE.map((_, i) => String(i + 1).padStart(2, '0')));
  });

  // The guide follows development: a new source file must join a row (or a new row) before it
  // ships, otherwise changes to it would never rerun acceptance.
  test('every source file is watched by at least one row', () => {
    const globs = [...CORE_TOUCHES, ...GUIDE.flatMap((row) => row.touches)].map((pattern) => new Bun.Glob(pattern));
    const unwatched = sourceFiles.filter(
      (file) => file.startsWith('src/') && !file.endsWith('.d.ts') && !globs.some((glob) => glob.match(file)),
    );
    expect(unwatched).toEqual([]);
  });

  for (const row of GUIDE) {
    test(`row ${row.id} references existing tests and files`, () => {
      expect(row.e2e.filter((title) => !e2eSource.includes(title))).toEqual([]);
      for (const entry of row.unit ?? []) {
        const ref = typeof entry === 'string' ? { file: entry, name: undefined } : entry;
        expect(existsSync(join(ROOT, ref.file))).toBe(true);
        // `name` is passed to `bun test -t`, so it must appear in a test or describe title.
        if (ref.name) {
          const titles =
            readFileSync(join(ROOT, ref.file), 'utf8').match(/\b(?:test|it|describe)\(\s*['`"][^\n]*/g) ?? [];
          expect(titles.some((title) => title.includes(ref.name!))).toBe(true);
        }
      }
      const unmatched = [...CORE_TOUCHES, ...row.touches].filter(
        (pattern) => !sourceFiles.some((file) => new Bun.Glob(pattern).match(file)),
      );
      expect(unmatched).toEqual([]);
    });
  }
});
