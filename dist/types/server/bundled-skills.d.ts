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
import { z } from 'zod';
declare const skillFrontmatterSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
}, z.core.$loose>;
export interface BundledSkill {
    name: string;
    description: string;
    uri: string;
    filePath: string;
    frontmatter: z.infer<typeof skillFrontmatterSchema>;
}
/**
 * Resolve the packaged `skills/` directory. Walks parents from this module
 * looking for a sibling `skills/` that contains at least one `<name>/SKILL.md`,
 * so it works whether the code runs from source (`src/server/…`), from a
 * compiled bundle (`dist/…`), or from a global npm install
 * (`/opt/homebrew/lib/node_modules/pmx-canvas/src/server/…`).
 */
export declare function findBundledSkillsRoot(): string | null;
/**
 * Enumerate every `<name>/SKILL.md` under the bundled skills root and return
 * a compact index. Invalid packaged skills fail explicitly rather than being
 * silently omitted from the Skills extension's integrity manifest.
 */
export declare function listBundledSkills(root?: string | null): BundledSkill[];
export declare function readBundledSkill(name: string): string | null;
export interface SkillEntry {
    uri: string;
    frontmatter: BundledSkill['frontmatter'];
    resources: Array<{
        uri: string;
        digest: string;
        size: number;
    }>;
}
type SkillContent = {
    uri: string;
    mimeType: string;
} & ({
    text: string;
} | {
    blob: string;
});
/** Capture immutable package bytes once per MCP process, never read caller-supplied paths. */
export declare function createBundledSkillCatalog(root?: string | null): {
    skills: SkillEntry[];
    files: Map<string, SkillContent>;
};
export {};
