export declare const BUNDLED_SKILLS: readonly ["pmx-canvas", "pmx-canvas-testing"];
export interface SkillTreeComparison {
    inSync: boolean;
    /** Files present in the package tree but missing or different in the mirror. */
    missingOrDifferent: string[];
    /** Files present in the mirror but not in the package tree. */
    extra: string[];
}
export declare function compareSkillTrees(sourceRoot: string, targetRoot: string): SkillTreeComparison;
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
export declare function discoverInstalledSkillMirrors(workspaceRoot: string, packageSkillsRoot: string): InstalledSkillMirror[];
export interface SkillMirrorResult {
    host: string;
    skill: string;
    dir: string;
    status: 'in-sync' | 'synced' | 'drifted' | 'skipped-not-a-package-copy';
    missingOrDifferent?: string[];
    extra?: string[];
}
/**
 * A mirror is only replaceable when its SKILL.md frontmatter `name:` matches
 * the bundled skill it sits under. A user's own skill living in a same-named
 * directory (different frontmatter identity) must never be deleted — these
 * trees are typically gitignored, so a wrong replace is unrecoverable.
 */
export declare function mirrorIdentityMatches(mirrorDir: string, skill: string): boolean;
/** Sync (or, with check=true, only compare) every INSTALLED mirror against the package trees. */
export declare function syncInstalledSkillMirrors(packageSkillsRoot: string, workspaceRoot: string, opts: {
    check: boolean;
}): SkillMirrorResult[];
