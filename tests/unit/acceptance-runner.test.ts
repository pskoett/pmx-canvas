import { expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('acceptance rejects runner and global errors even when individual tests passed', () => {
  const root = mkdtempSync(join(tmpdir(), 'pmx-acceptance-runner-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'tests/acceptance'), { recursive: true });
    cpSync(resolve(import.meta.dir, '../../scripts/acceptance.ts'), join(root, 'scripts/acceptance.ts'));
    writeFileSync(
      join(root, 'tests/acceptance/guide.ts'),
      `export const CORE_TOUCHES = [];
export const GUIDE = [{ id: '01', title: 'Fixture', touches: [], pass: ['Fixture passed'], e2e: ['fixture'] }];`,
    );
    writeFileSync(
      join(root, 'scripts/run-playwright.sh'),
      'printf "%s" "$FIXTURE_REPORT" > test-results/acceptance/playwright.json\nexit "$FIXTURE_EXIT"\n',
    );
    expect(Bun.spawnSync(['git', 'init', '--quiet'], { cwd: root }).exitCode).toBe(0);
    for (const [exitCode, errors, expected] of [
      [0, [], 'pass'],
      [1, [], 'fail'],
      [0, [{ message: 'Global teardown failed' }], 'fail'],
    ] as const) {
      const report = {
        errors,
        suites: [
          {
            title: '',
            specs: [{ title: 'fixture', tests: [{ projectName: 'fixture', status: 'expected', results: [] }] }],
          },
        ],
      };
      const run = Bun.spawnSync([process.execPath, 'scripts/acceptance.ts', '--all', '--no-build'], {
        cwd: root,
        env: { ...process.env, FIXTURE_REPORT: JSON.stringify(report), FIXTURE_EXIT: String(exitCode) },
      });
      expect(run.exitCode).toBe(expected === 'pass' ? 0 : 1);
      const ledger = JSON.parse(readFileSync(join(root, 'test-results/acceptance/ledger.json'), 'utf8'));
      const results = JSON.parse(readFileSync(join(root, 'test-results/acceptance/results.json'), 'utf8'));
      expect(ledger['01'].status).toBe(expected);
      expect(results.results[0].status).toBe(expected);
      expect(results.results[0].problems.length).toBe(expected === 'pass' ? 0 : 1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
