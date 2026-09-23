/**
 * Bundled-skill discovery for the PMX Canvas MCP server.
 *
 * Skill files ship inside the npm package under `skills/<name>/SKILL.md`
 * but until 0.1.2 they were not discoverable to the agent — an agent
 * calling `canvas_app` (`build-artifact` action) had no way to find the
 * companion `skills/web-artifacts-builder/SKILL.md` prompt that documents
 * the workflow, stack choices, and gotchas.
 *
 * This module locates the bundled `skills/` directory relative to the
 * package root (works for both repo-local development and global npm
 * installs), parses the YAML frontmatter of each `SKILL.md` to produce
 * a compact index, and reads individual skill content on demand.
 *
 * Exposed via MCP as:
 *   - `canvas://skills`          → JSON index
 *   - `canvas://skills/<name>`   → full markdown content
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const skillFrontmatterSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    description: z.string().min(1).max(1024),
  })
  .passthrough();

export interface BundledSkill {
  name: string;
  description: string;
  uri: string;
  filePath: string;
  frontmatter: z.infer<typeof skillFrontmatterSchema>;
}

const MAX_DESCRIPTION_LENGTH = 400;

/**
 * Resolve the packaged `skills/` directory. Walks parents from this module
 * looking for a sibling `skills/` that contains at least one `<name>/SKILL.md`,
 * so it works whether the code runs from source (`src/server/…`), from a
 * compiled bundle (`dist/…`), or from a global npm install
 * (`/opt/homebrew/lib/node_modules/pmx-canvas/src/server/…`).
 */
export function findBundledSkillsRoot(): string | null {
  let current = dirname(fileURLToPath(import.meta.url));
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const candidate = join(current, 'skills');
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isDirectory()) {
          const entries = readdirSync(candidate);
          for (const entry of entries) {
            if (existsSync(join(candidate, entry, 'SKILL.md'))) {
              return resolve(candidate);
            }
          }
        }
      } catch {
        // swallow and keep walking up — a permissions/transient error on this
        // candidate shouldn't prevent finding a valid skills root higher up.
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function parseFrontmatter(markdown: string): BundledSkill['frontmatter'] {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) throw new Error('Bundled skill is missing YAML frontmatter');
  return skillFrontmatterSchema.parse(Bun.YAML.parse(match[1]!));
}

/**
 * Enumerate every `<name>/SKILL.md` under the bundled skills root and return
 * a compact index. Invalid packaged skills fail explicitly rather than being
 * silently omitted from the Skills extension's integrity manifest.
 */
export function listBundledSkills(root = findBundledSkillsRoot()): BundledSkill[] {
  if (!root) return [];
  const entries = readdirSync(root);
  const skills: BundledSkill[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const skillFile = join(root, entry, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    if (lstatSync(join(root, entry)).isSymbolicLink() || lstatSync(skillFile).isSymbolicLink()) {
      throw new Error(`Bundled skill contains a symbolic link: ${entry}`);
    }
    if (!lstatSync(skillFile).isFile()) throw new Error(`Bundled skill contains a non-regular file: ${skillFile}`);
    const frontmatter = parseFrontmatter(readFileSync(skillFile, 'utf-8'));
    if (frontmatter.name !== entry) throw new Error(`Bundled skill name does not match directory: ${entry}`);
    skills.push({
      name: entry,
      description: frontmatter.description.slice(0, MAX_DESCRIPTION_LENGTH),
      uri: `canvas://skills/${entry}`,
      filePath: skillFile,
      frontmatter,
    });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

export function readBundledSkill(name: string): string | null {
  const skills = listBundledSkills();
  const match = skills.find((s) => s.name === name);
  if (!match) return null;
  try {
    return readFileSync(match.filePath, 'utf-8');
  } catch {
    return null;
  }
}

export interface SkillEntry {
  uri: string;
  frontmatter: BundledSkill['frontmatter'];
  resources: Array<{ uri: string; digest: string; size: number }>;
}

type SkillContent = { uri: string; mimeType: string } & ({ text: string } | { blob: string });

/** Capture immutable package bytes once per MCP process, never read caller-supplied paths. */
export function createBundledSkillCatalog(root = findBundledSkillsRoot()) {
  const skills: SkillEntry[] = [];
  const files = new Map<string, SkillContent>();
  for (const skill of listBundledSkills(root)) {
    const entry: SkillEntry = { uri: `skill://${skill.name}/SKILL.md`, frontmatter: skill.frontmatter, resources: [] };
    let totalBytes = 0;
    function walk(directory: string, prefix = ''): void {
      for (const child of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const filePath = join(directory, child.name);
        const relativePath = prefix + encodeURIComponent(child.name);
        if (child.isSymbolicLink()) throw new Error(`Bundled skill contains a symbolic link: ${filePath}`);
        if (child.isDirectory()) {
          walk(filePath, `${relativePath}/`);
          continue;
        }
        if (!child.isFile()) throw new Error(`Bundled skill contains a non-regular file: ${filePath}`);
        totalBytes += lstatSync(filePath).size;
        if (entry.resources.length >= 512 || totalBytes > 16 * 1024 * 1024) {
          throw new Error(`Bundled skill exceeds SEP-2640 file/byte limits: ${skill.name}`);
        }
        const bytes = readFileSync(filePath);
        const uri = `skill://${skill.name}/${relativePath}`;
        const mimeType = child.name.endsWith('.md') ? 'text/markdown' : Bun.file(filePath).type;
        // Round-trip detection preserves invalid UTF-8 and binary assets as blobs.
        const text = bytes.toString('utf8');
        const content =
          !bytes.includes(0) && Buffer.from(text).equals(bytes)
            ? { uri, mimeType, text }
            : { uri, mimeType, blob: bytes.toString('base64') };
        files.set(uri, content);
        entry.resources.push({
          uri,
          size: bytes.length,
          digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        });
        if (uri === entry.uri) entry.frontmatter = parseFrontmatter(text);
      }
    }
    walk(dirname(skill.filePath));
    if (entry.frontmatter.name !== skill.name)
      throw new Error(`Bundled skill name changed during loading: ${skill.name}`);
    entry.resources.sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0));
    skills.push(entry);
  }
  return { skills, files };
}
