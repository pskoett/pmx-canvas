// Skill mirror commands: skills sync (+ --check drift detection).
//
// Every release cycle found installed skill copies stale against the package,
// and testers hand-synced complete trees before results were trustworthy.
// This command automates that WITHOUT assuming any agent layout: it discovers
// the pmx-canvas skill copies already installed in the workspace (any
// `<dir>/skills/<skill-name>/SKILL.md`, whatever agent owns `<dir>`) and
// compares/replaces whole trees — references, evals, fixtures included. It
// never creates a mirror where none is installed.

import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmd, output, parseFlags, showCommandHelp } from '../shared.js';

export const BUNDLED_SKILLS = ['pmx-canvas', 'pmx-canvas-testing'] as const;

function listFilesRecursive(root: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(join(root, entry.name), rel));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out.sort();
}

export interface SkillTreeComparison {
  inSync: boolean;
  /** Files present in the package tree but missing or different in the mirror. */
  missingOrDifferent: string[];
  /** Files present in the mirror but not in the package tree. */
  extra: string[];
}

export function compareSkillTrees(sourceRoot: string, targetRoot: string): SkillTreeComparison {
  const sourceFiles = listFilesRecursive(sourceRoot);
  const targetFiles = listFilesRecursive(targetRoot);
  const targetSet = new Set(targetFiles);
  const missingOrDifferent: string[] = [];
  for (const rel of sourceFiles) {
    if (!targetSet.has(rel)) {
      missingOrDifferent.push(rel);
      continue;
    }
    if (!readFileSync(join(sourceRoot, rel)).equals(readFileSync(join(targetRoot, rel)))) {
      missingOrDifferent.push(rel);
    }
  }
  const sourceSet = new Set(sourceFiles);
  const extra = targetFiles.filter((rel) => !sourceSet.has(rel));
  return { inSync: missingOrDifferent.length === 0 && extra.length === 0, missingOrDifferent, extra };
}

export interface InstalledSkillMirror {
  /** The directory that owns the skills/ folder (e.g. ".codex", ".github", or any agent dir). */
  host: string;
  skill: string;
  dir: string;
}

/**
 * Find the bundled skills' installed copies in this workspace: any immediate
 * child directory holding `skills/<skill>/SKILL.md`, regardless of which agent
 * that directory belongs to. The package's own skills source is excluded so
 * running inside the pmx-canvas checkout never compares a tree to itself.
 */
export function discoverInstalledSkillMirrors(
  workspaceRoot: string,
  packageSkillsRoot: string,
): InstalledSkillMirror[] {
  const found: InstalledSkillMirror[] = [];
  for (const entry of readdirSync(workspaceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const skillsDir = join(workspaceRoot, entry.name, 'skills');
    if (!existsSync(skillsDir)) continue;
    for (const skill of BUNDLED_SKILLS) {
      const dir = join(skillsDir, skill);
      if (!existsSync(join(dir, 'SKILL.md'))) continue;
      if (resolve(dir) === resolve(join(packageSkillsRoot, skill))) continue;
      found.push({ host: entry.name, skill, dir });
    }
  }
  return found;
}

export interface SkillMirrorResult {
  host: string;
  skill: string;
  dir: string;
  status: 'in-sync' | 'synced' | 'drifted';
  missingOrDifferent?: string[];
  extra?: string[];
}

/** Sync (or, with check=true, only compare) every INSTALLED mirror against the package trees. */
export function syncInstalledSkillMirrors(
  packageSkillsRoot: string,
  workspaceRoot: string,
  opts: { check: boolean },
): SkillMirrorResult[] {
  const results: SkillMirrorResult[] = [];
  for (const mirror of discoverInstalledSkillMirrors(workspaceRoot, packageSkillsRoot)) {
    const source = join(packageSkillsRoot, mirror.skill);
    const cmp = compareSkillTrees(source, mirror.dir);
    if (cmp.inSync) {
      results.push({ ...mirror, status: 'in-sync' });
      continue;
    }
    if (opts.check) {
      results.push({ ...mirror, status: 'drifted', ...cmp });
      continue;
    }
    // Full-tree replace: a copy-over would leave deleted package files behind
    // in the mirror, which is exactly the drift class release audits kept
    // hitting even when SKILL.md hashes matched.
    rmSync(mirror.dir, { recursive: true, force: true });
    cpSync(source, mirror.dir, { recursive: true });
    results.push({ ...mirror, status: 'synced' });
  }
  return results;
}

// ── skills sync ──────────────────────────────────────────────
cmd(
  'skills sync',
  'Refresh the pmx-canvas skill copies already installed in this workspace (any agent layout)',
  ['pmx-canvas skills sync', 'pmx-canvas skills sync --check'],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('skills sync');

    const packageSkillsRoot = fileURLToPath(new URL('../../../skills', import.meta.url));
    const check = flags.check === true;
    const results = syncInstalledSkillMirrors(packageSkillsRoot, process.cwd(), { check });

    const drifted = results.filter((r) => r.status === 'drifted');
    const ok = drifted.length === 0;
    output({
      ok,
      check,
      packageSkillsRoot,
      mirrorsFound: results.length,
      ...(results.length === 0 ? { note: 'No installed pmx-canvas skill copies found in this workspace.' } : {}),
      results,
    });
    if (!ok) process.exitCode = 1;
  },
);
