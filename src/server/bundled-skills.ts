/**
 * Bundled-skill discovery for the PMX Canvas MCP server.
 *
 * Skill files ship inside the npm package under `skills/<name>/SKILL.md`
 * but until 0.1.2 they were not discoverable to the agent — an agent
 * calling `canvas_build_web_artifact` had no way to find the companion
 * `skills/web-artifacts-builder/SKILL.md` prompt that documents the
 * workflow, stack choices, and gotchas.
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

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BundledSkill {
  name: string;
  description: string;
  uri: string;
  filePath: string;
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

function parseFrontmatterDescription(markdown: string): string {
  // YAML frontmatter lives between two `---` fences at the very top.
  if (!markdown.startsWith('---')) return '';
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) return '';
  const frontmatter = markdown.slice(3, end);
  const lines = frontmatter.split('\n');

  // Support both single-line `description: ...` and block-scalar `description: >` /
  // `description: |` forms (indented continuation lines).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const match = /^description:\s*(.*)$/.exec(line);
    if (!match) continue;
    const first = (match[1] ?? '').trim();
    if (first && first !== '>' && first !== '|' && first !== '>-' && first !== '|-') {
      return first.slice(0, MAX_DESCRIPTION_LENGTH);
    }
    // Block scalar — concatenate indented follow-on lines.
    const parts: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const follow = lines[j] ?? '';
      if (follow.length === 0) {
        parts.push('');
        continue;
      }
      if (!/^\s/.test(follow)) break;
      parts.push(follow.trim());
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION_LENGTH);
  }
  return '';
}

/**
 * Enumerate every `<name>/SKILL.md` under the bundled skills root and return
 * a compact index. Hidden directories (dotfolders) and files that don't parse
 * are skipped silently rather than throwing — missing metadata should never
 * break the MCP server's resource listing.
 */
export function listBundledSkills(): BundledSkill[] {
  const root = findBundledSkillsRoot();
  if (!root) return [];
  const entries = readdirSync(root);
  const skills: BundledSkill[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const skillFile = join(root, entry, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    try {
      const markdown = readFileSync(skillFile, 'utf-8');
      const description = parseFrontmatterDescription(markdown);
      skills.push({
        name: entry,
        description,
        uri: `canvas://skills/${entry}`,
        filePath: skillFile,
      });
    } catch {
      // skip unreadable files
    }
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
