#!/usr/bin/env bun
/**
 * Owner acceptance runner: reruns only the guide rows whose files changed since they last passed.
 *
 *   bun run acceptance                 # changed rows only; unchanged passes carry forward
 *   bun run acceptance --all           # every row, ignoring earlier passes
 *   bun run acceptance --rows 05,12    # only these rows (still carried while unchanged)
 *   flags: --headed  --no-build  --ledger <path>
 *
 * A row's fingerprint is the content hash of its definition plus every file matching its
 * `touches` and CORE_TOUCHES. A pass is carried forward while the fingerprint is unchanged, so
 * the result does not depend on commits, patches or which checkout produced it.
 * Writes test-results/acceptance/{report.md,results.json} and per-test videos.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { CORE_TOUCHES, GUIDE, type GuideRow, type UnitRef } from '../tests/acceptance/guide.js';

const ROOT = resolve(import.meta.dir, '..');
const OUT = resolve(ROOT, 'test-results/acceptance');
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const LEDGER = resolve(ROOT, option('--ledger') ?? 'test-results/acceptance/ledger.json');

type RowStatus = 'pass' | 'fail' | 'carried' | 'not-run';
interface TestResult {
  title: string;
  project: string;
  status: string;
  error?: string;
  videos: string[];
}
interface LedgerEntry {
  status: 'pass' | 'fail';
  fingerprint: string;
  files: Record<string, string>;
  commit: string;
  at: string;
}
interface RowResult {
  row: GuideRow;
  status: RowStatus;
  reason: string;
  tests: TestResult[];
  unit: Array<{ ref: string; exitCode: number; log: string }>;
  problems: string[];
  since?: LedgerEntry;
}

function run(cmd: string[], env: Record<string, string> = {}, capture = false) {
  const proc = Bun.spawnSync(cmd, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdout: capture ? 'pipe' : 'inherit',
    stderr: capture ? 'pipe' : 'inherit',
  });
  return { exitCode: proc.exitCode, stdout: proc.stdout?.toString() ?? '', stderr: proc.stderr?.toString() ?? '' };
}

const sha = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const commit = run(['git', 'rev-parse', '--short', 'HEAD'], {}, true).stdout.trim() || 'unknown';
const workspaceFiles = run(['git', 'ls-files', '-co', '--exclude-standard'], {}, true)
  .stdout.split('\n')
  .filter((file) => file && existsSync(resolve(ROOT, file)));

function rowFiles(row: GuideRow): Record<string, string> {
  const globs = [...CORE_TOUCHES, ...row.touches].map((pattern) => new Bun.Glob(pattern));
  const files: Record<string, string> = {};
  for (const file of workspaceFiles) {
    if (globs.some((glob) => glob.match(file))) files[file] = sha(readFileSync(resolve(ROOT, file)));
  }
  return files;
}

const fingerprint = (row: GuideRow, files: Record<string, string>) =>
  sha(JSON.stringify([row, Object.entries(files).sort()]));

const ledger: Record<string, LedgerEntry> = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};
const requested = option('--rows')?.split(',').map((id) => id.trim().padStart(2, '0'));

const results: RowResult[] = GUIDE.map((row) => {
  const files = rowFiles(row);
  const previous = ledger[row.id];
  const base = { row, tests: [], unit: [], problems: [], since: previous };
  if (requested && !requested.includes(row.id)) return { ...base, status: 'not-run', reason: 'not requested' };
  if (!flag('--all') && previous?.status === 'pass' && previous.fingerprint === fingerprint(row, files)) {
    return { ...base, status: 'carried', reason: `unchanged since pass at ${previous.commit} (${previous.at})` };
  }
  const changed = previous
    ? Object.keys({ ...files, ...previous.files }).filter((file) => files[file] !== previous.files[file])
    : [];
  const reason = !previous
    ? 'no earlier result'
    : changed.length
      ? `changed: ${changed.slice(0, 5).join(', ')}${changed.length > 5 ? ` +${changed.length - 5}` : ''}`
      : previous.status === 'fail'
        ? 'failed last time'
        : 'row definition changed or rerun requested';
  return { ...base, status: 'fail', reason };
});
const toRun = results.filter((result) => result.status === 'fail');

mkdirSync(OUT, { recursive: true });
if (toRun.length && !flag('--no-build')) {
  if (run(['bun', 'run', 'build']).exitCode !== 0) throw new Error('bun run build failed');
}

// One Playwright run for every selected row; tests are attributed to rows by title afterwards.
const patterns = [...new Set(toRun.flatMap((result) => result.row.e2e))];
const executed: TestResult[] = [];
if (patterns.length) {
  const grep = patterns.map((pattern) => pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  run(['bash', 'scripts/run-playwright.sh', '--config', 'playwright.acceptance.config.ts', '--grep', grep, ...(flag('--headed') ? ['--headed'] : [])]);
  const report = JSON.parse(readFileSync(resolve(OUT, 'playwright.json'), 'utf8'));
  interface Suite {
    title: string;
    suites?: Suite[];
    specs?: Array<{
      title: string;
      tests: Array<{
        projectName: string;
        status: string;
        results: Array<{ error?: { message?: string }; attachments: Array<{ name: string; path?: string }> }>;
      }>;
    }>;
  }
  const walk = (suite: Suite, path: string[]) => {
    const here = suite.title ? [...path, suite.title] : path;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const last = test.results.at(-1);
        executed.push({
          title: [...here, spec.title].join(' › '),
          project: test.projectName,
          status: test.status,
          error: last?.error?.message?.split('\n')[0],
          videos: test.results.flatMap((result) =>
            result.attachments.filter((a) => a.name === 'video' && a.path).map((a) => relative(OUT, a.path!)),
          ),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
}

for (const result of toRun) {
  for (const pattern of result.row.e2e) {
    const matched = executed.filter((test) => test.title.includes(pattern));
    if (!matched.length) result.problems.push(`no e2e test matched "${pattern}"`);
    for (const test of matched) if (!result.tests.includes(test)) result.tests.push(test);
  }
  for (const entry of result.row.unit ?? []) {
    const ref: UnitRef = typeof entry === 'string' ? { file: entry } : entry;
    const client = ref.file.startsWith('tests/client/');
    const cmd = ['bun', 'test', ...(client ? ['--preload', './tests/client/setup.ts'] : []), `./${ref.file}`];
    if (ref.name) cmd.push('-t', ref.name);
    const out = run(
      cmd,
      { PMX_MCP_APP_HOST_STATE_FILE: '/tmp/pmx-canvas-test-app-host-state.json', PMX_CANVAS_DISABLE_BROWSER_OPEN: '1' },
      true,
    );
    const log = `unit-${result.row.id}-${sha(JSON.stringify(ref))}.log`;
    writeFileSync(resolve(OUT, log), out.stdout + out.stderr);
    result.unit.push({ ref: ref.name ? `${ref.file} -t "${ref.name}"` : ref.file, exitCode: out.exitCode, log });
  }
  const failedTests = result.tests.filter((test) => test.status !== 'expected' && test.status !== 'flaky');
  const failedUnit = result.unit.filter((unit) => unit.exitCode !== 0);
  result.status = result.problems.length || failedTests.length || failedUnit.length ? 'fail' : 'pass';
  const files = rowFiles(result.row);
  ledger[result.row.id] = {
    status: result.status,
    fingerprint: fingerprint(result.row, files),
    files,
    commit,
    at: new Date().toISOString(),
  };
}
writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);

const count = (status: RowStatus) => results.filter((result) => result.status === status).length;
const lines = [
  `# Owner acceptance at ${commit}`,
  '',
  `${count('pass')} passed, ${count('carried')} carried forward, ${count('fail')} failed, ${count('not-run')} not run. Generated ${new Date().toISOString()}.`,
  '',
  'Carried rows passed earlier and none of their files changed since. Owner checks are never automated.',
  '',
  '| Row | Title | Status | Evidence | Why |',
  '|---|---|---|---|---|',
  ...results.map((result) => {
    const passed = result.tests.filter((test) => test.status === 'expected' || test.status === 'flaky').length;
    const units = result.unit.filter((unit) => unit.exitCode === 0).length;
    const evidence =
      result.status === 'pass' || result.status === 'fail'
        ? `e2e ${passed}/${result.tests.length}, unit ${units}/${result.unit.length}`
        : '';
    return `| ${result.row.id} | ${result.row.title} | ${result.status} | ${evidence} | ${result.reason} |`;
  }),
  '',
];
for (const result of results.filter((r) => r.status === 'pass' || r.status === 'fail')) {
  lines.push(`## ${result.row.id} · ${result.row.title} — ${result.status}`, '');
  lines.push(...result.row.pass.map((criterion) => `- ${criterion}`), '');
  for (const problem of result.problems) lines.push(`- **Problem:** ${problem}`);
  for (const test of result.tests) {
    const video = test.videos.map((path, index) => `[video ${index + 1}](${path})`).join(' ');
    lines.push(`- ${test.status === 'expected' ? 'pass' : test.status}: ${test.title} (${test.project}) ${video}`);
    if (test.error) lines.push(`  - ${test.error}`);
  }
  for (const unit of result.unit) lines.push(`- ${unit.exitCode === 0 ? 'pass' : 'fail'}: \`${unit.ref}\` ([log](${unit.log}))`);
  if (result.row.ownerChecks?.length) {
    lines.push('', 'Owner checks:', ...result.row.ownerChecks.map((check) => `- [ ] ${check}`));
  }
  lines.push('');
}
const ownerOnly = results.filter((result) => result.status === 'carried' && result.row.ownerChecks?.length);
if (ownerOnly.length) {
  lines.push('## Owner checks on carried rows', '');
  for (const result of ownerOnly) lines.push(...result.row.ownerChecks!.map((check) => `- [ ] ${result.row.id}: ${check}`));
  lines.push('');
}
writeFileSync(resolve(OUT, 'report.md'), lines.join('\n'));
writeFileSync(
  resolve(OUT, 'results.json'),
  `${JSON.stringify({ commit, results: results.map(({ row, since, ...rest }) => ({ id: row.id, title: row.title, ...rest, since: since && { status: since.status, commit: since.commit, at: since.at } })) }, null, 2)}\n`,
);
console.log(`\nAcceptance report: ${relative(ROOT, resolve(OUT, 'report.md'))}`);
console.log(`${count('pass')} passed, ${count('carried')} carried, ${count('fail')} failed, ${count('not-run')} not run`);
process.exit(count('fail') ? 1 : 0);
