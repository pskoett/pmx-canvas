import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compareSkillTrees,
  discoverInstalledSkillMirrors,
  syncInstalledSkillMirrors,
} from '../../src/cli/commands/skills.ts';

// Release audits hit the same failure every cycle: installed skill copies
// drift from the package (whole-tree drift — references, evals, fixtures —
// not just SKILL.md). The sync command is DISCOVERY-based: it refreshes only
// the copies already installed in the workspace, whatever agent layout owns
// them, and never creates a mirror where none is installed.

let tempRoots: string[] = [];

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `pmx-skills-${label}-`));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
  tempRoots = [];
});

function skillMd(skill: string, body: string): string {
  return `---\nname: ${skill}\ndescription: test fixture\n---\n${body}`;
}

function makePackageSkills(): string {
  const root = tempDir('pkg');
  for (const skill of ['pmx-canvas', 'pmx-canvas-testing']) {
    mkdirSync(join(root, skill, 'references'), { recursive: true });
    writeFileSync(join(root, skill, 'SKILL.md'), skillMd(skill, 'current guidance'));
    writeFileSync(join(root, skill, 'references', 'ref.md'), `${skill} reference body`);
  }
  return root;
}

function installStaleCopy(pkg: string, workspaceRoot: string, hostDir: string, skill: string): string {
  const dir = join(workspaceRoot, hostDir, 'skills', skill);
  mkdirSync(join(dir, 'references'), { recursive: true });
  // A genuine old package copy: correct frontmatter identity, stale content.
  writeFileSync(join(dir, 'SKILL.md'), skillMd(skill, 'STALE old-release skill'));
  writeFileSync(join(dir, 'references', 'ref.md'), 'STALE reference');
  return dir;
}

describe('syncInstalledSkillMirrors', () => {
  test('refreshes only installed copies — any agent layout — and never creates new ones', () => {
    const pkg = makePackageSkills();
    const ws = tempDir('ws');
    // Two different agent layouts, one skill installed in each — including a
    // host dir the command has never heard of.
    installStaleCopy(pkg, ws, '.codex', 'pmx-canvas');
    installStaleCopy(pkg, ws, '.some-future-agent', 'pmx-canvas-testing');
    // A host dir with no installed skills must stay untouched.
    mkdirSync(join(ws, '.github'));

    const results = syncInstalledSkillMirrors(pkg, ws, { check: false });
    expect(results.map((r) => `${r.host}/${r.skill}:${r.status}`).sort()).toEqual([
      '.codex/pmx-canvas:synced',
      '.some-future-agent/pmx-canvas-testing:synced',
    ]);
    expect(readFileSync(join(ws, '.codex', 'skills', 'pmx-canvas', 'SKILL.md'), 'utf-8')).toContain('current guidance');
    // Nothing invented for hosts without an installed copy.
    expect(existsSync(join(ws, '.github', 'skills'))).toBe(false);
    expect(existsSync(join(ws, '.codex', 'skills', 'pmx-canvas-testing'))).toBe(false);

    // Second run: everything already in sync.
    const again = syncInstalledSkillMirrors(pkg, ws, { check: false });
    expect(again.every((r) => r.status === 'in-sync')).toBe(true);
  });

  test('check mode reports whole-tree drift (changed + extra files) without modifying anything', () => {
    const pkg = makePackageSkills();
    const ws = tempDir('ws');
    const mirror = installStaleCopy(pkg, ws, '.codex', 'pmx-canvas');
    syncInstalledSkillMirrors(pkg, ws, { check: false });

    writeFileSync(join(mirror, 'references', 'ref.md'), 'STALE again');
    writeFileSync(join(mirror, 'leftover.md'), 'file removed from the package');

    const checked = syncInstalledSkillMirrors(pkg, ws, { check: true });
    expect(checked).toHaveLength(1);
    expect(checked[0].status).toBe('drifted');
    expect(checked[0].missingOrDifferent).toEqual(['references/ref.md']);
    expect(checked[0].extra).toEqual(['leftover.md']);
    expect(readFileSync(join(mirror, 'references', 'ref.md'), 'utf-8')).toContain('STALE');

    // Sync repairs with a full-tree replace: stale content fixed AND the
    // extra file removed (a copy-over would have left it behind).
    syncInstalledSkillMirrors(pkg, ws, { check: false });
    expect(readFileSync(join(mirror, 'references', 'ref.md'), 'utf-8')).toContain('reference body');
    expect(existsSync(join(mirror, 'leftover.md'))).toBe(false);
  });

  test('a user-authored skill in a pmx-canvas-named directory is skipped, never replaced', () => {
    const pkg = makePackageSkills();
    const ws = tempDir('ws');
    // The user's OWN skill happens to live in .claude/skills/pmx-canvas but is
    // NOT a package copy (different frontmatter identity). It must survive.
    const dir = join(ws, '.claude', 'skills', 'pmx-canvas');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: my-own-canvas-notes\ndescription: personal\n---\nhands off');

    const results = syncInstalledSkillMirrors(pkg, ws, { check: false });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('skipped-not-a-package-copy');
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf-8')).toContain('hands off');
  });

  test('the package skills source itself is never treated as a mirror', () => {
    const pkg = makePackageSkills();
    // Workspace root IS the package root parent layout: <root>/skills/<name>.
    const root = tempDir('selfws');
    mkdirSync(join(root, 'skills'), { recursive: true });
    for (const skill of ['pmx-canvas', 'pmx-canvas-testing']) {
      mkdirSync(join(root, 'skills', skill), { recursive: true });
      writeFileSync(join(root, 'skills', skill, 'SKILL.md'), 'source tree');
    }
    // Discovery from the root whose own skills/ is the source.
    expect(discoverInstalledSkillMirrors(root, join(root, 'skills'))).toEqual([]);
    // (pkg is a different source root; root/skills is not under a child host
    // dir, so it is not discovered either.)
    expect(discoverInstalledSkillMirrors(root, pkg)).toEqual([]);
  });
});

describe('skills sync via the real CLI entry', () => {
  // Flag parsing lives ABOVE the inner functions (LRN-20260708-004): the
  // --check-eats-a-token bug and the --yes destructive gate are only
  // observable through src/cli/index.ts, so drive it as a subprocess.
  const cliEntry = join(import.meta.dir, '..', '..', 'src', 'cli', 'index.ts');

  async function runCli(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
    const proc = Bun.spawn([process.execPath, 'run', cliEntry, 'skills', 'sync', ...args], {
      cwd,
      env: { ...process.env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    return { code: proc.exitCode ?? -1, stdout };
  }

  test('without --yes it reports drift, exits 1, and changes nothing; --yes syncs', async () => {
    const ws = tempDir('ws-entry');
    // Install a stale copy of the REAL bundled skill so the packaged source
    // (the repo's own skills/) drifts against it.
    const dir = join(ws, '.codex', 'skills', 'pmx-canvas');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: pmx-canvas\ndescription: stale\n---\nSTALE');

    const report = await runCli(ws, []);
    expect(report.code).toBe(1);
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf-8')).toContain('STALE');
    expect(report.stdout).toContain('--yes');

    // --check with a stray trailing token must stay read-only (check must be
    // a boolean flag, not consume the token as its value).
    const strayCheck = await runCli(ws, ['--check', 'stray-token']);
    expect(strayCheck.code).toBe(1);
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf-8')).toContain('STALE');

    const synced = await runCli(ws, ['--yes']);
    expect(synced.code).toBe(0);
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf-8')).not.toContain('STALE');
  }, 30000);
});

describe('compareSkillTrees', () => {
  test('detects byte-level drift and extra files', () => {
    const pkg = makePackageSkills();
    const copy = tempDir('copy');
    mkdirSync(join(copy, 'references'), { recursive: true });
    writeFileSync(join(copy, 'SKILL.md'), skillMd('pmx-canvas', 'current guidance'));
    writeFileSync(join(copy, 'references', 'ref.md'), 'pmx-canvas reference body');
    expect(compareSkillTrees(join(pkg, 'pmx-canvas'), copy).inSync).toBe(true);

    writeFileSync(join(copy, 'references', 'ref.md'), 'edited');
    const cmp = compareSkillTrees(join(pkg, 'pmx-canvas'), copy);
    expect(cmp.inSync).toBe(false);
    expect(cmp.missingOrDifferent).toEqual(['references/ref.md']);
  });
});
