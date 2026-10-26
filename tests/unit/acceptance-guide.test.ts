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
const sourceFiles = [...new Bun.Glob('**/*').scanSync({ cwd: ROOT, onlyFiles: true })].filter(
  (file) => !file.startsWith('node_modules/') && !file.startsWith('.git/'),
);

describe('owner acceptance guide manifest', () => {
  test('covers rows 01–23 once each', () => {
    expect(GUIDE.map((row) => row.id)).toEqual(Array.from({ length: 23 }, (_, i) => String(i + 1).padStart(2, '0')));
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
