import { describe, expect, test } from 'bun:test';
import { findBundledSkillsRoot, listBundledSkills, readBundledSkill } from '../../src/server/bundled-skills.ts';

describe('bundled skills', () => {
  test('installation pins and runtime prerequisite match the package version', async () => {
    const { version } = await Bun.file(new URL('../../package.json', import.meta.url)).json();
    const guide = await Bun.file(
      new URL('../../skills/pmx-canvas/references/installing-pmx-canvas.md', import.meta.url),
    ).text();
    const pins = [...guide.matchAll(/pmx-canvas@(\d+\.\d+\.\d+(?:-[\w.-]+)?)/g)].map((match) => match[1]);
    expect(pins.length).toBeGreaterThanOrEqual(3);
    expect(new Set(pins)).toEqual(new Set([version]));
    expect(guide).toContain(`PMX Canvas ${version}`);
    expect(readBundledSkill('pmx-canvas')).toContain(`PMX Canvas ${version} requires`);
  });

  test('findBundledSkillsRoot resolves the packaged skills directory', () => {
    const root = findBundledSkillsRoot();
    expect(root).not.toBeNull();
    expect(typeof root).toBe('string');
    // Separator-agnostic: join() yields backslashes on Windows.
    expect(root!.split(/[\\/]/).at(-1)).toBe('skills');
  });

  test('listBundledSkills returns at least the canonical product skills', () => {
    const skills = listBundledSkills();
    const names = skills.map((s) => s.name);

    // These are hand-maintained product skills, always shipped.
    expect(names).toContain('pmx-canvas');
    expect(names).toContain('web-artifacts-builder');

    // Every entry should have a usable URI and a non-empty description.
    for (const skill of skills) {
      expect(skill.uri).toBe(`canvas://skills/${skill.name}`);
      expect(skill.description.length).toBeGreaterThan(0);
    }

    // Sorted by name so the MCP resource listing is stable.
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  test('readBundledSkill returns the full SKILL.md contents', () => {
    const markdown = readBundledSkill('web-artifacts-builder');
    expect(markdown).not.toBeNull();
    expect(markdown!.startsWith('---')).toBe(true);
    expect(markdown!).toContain('name: web-artifacts-builder');
    expect(markdown!).toContain('init-artifact.sh');
  });

  test('readBundledSkill returns null for unknown skills', () => {
    expect(readBundledSkill('this-skill-does-not-exist')).toBeNull();
  });

  test('0.7 audit guidance is bundled and behavioral eval definitions are distinct from benchmark results', async () => {
    const skill = readBundledSkill('pmx-canvas')!;
    const testing = readBundledSkill('pmx-canvas-testing')!;
    const tourGuide = await Bun.file(
      new URL('../../skills/pmx-canvas/references/tours-and-recording.md', import.meta.url),
    ).text();
    const evalDocument = await Bun.file(new URL('../../skills/pmx-canvas/evals/evals.json', import.meta.url)).json();
    const evals = evalDocument.evals as Array<{ name: string; assertions: unknown[] }>;

    expect(skill).toContain('[Tours and recording](references/tours-and-recording.md)');
    expect(skill).not.toContain('See `docs/cli.md` for the full tour model');
    expect(tourGuide).toContain('screen = world * scale + offset');
    expect(tourGuide).toContain('A saved `{ "stops": [] }` intentionally has no stops');
    expect(tourGuide).toContain('max(1, ceil(duration * fps))');
    expect(skill).toContain('--include-derived-text');
    expect(skill).toContain('Do not fall back to a raw');
    expect(testing).toContain('document.visibilityState');
    expect(testing).toContain('capture a screenshot');

    const auditEvals = [
      'tour-authoring-and-capture',
      'multi-board-targeting',
      'readme-preservation',
      'import-consent-distrust-and-provenance',
      'independent-export-privacy-consent',
    ];
    for (const name of auditEvals) {
      const definition = evals.find((entry) => entry.name === name);
      expect(definition).toBeTruthy();
      expect(definition!.assertions.length).toBeGreaterThanOrEqual(3);
    }
    // This shipped file defines scenarios and output checks; it does not claim a model run occurred.
    expect(evalDocument).not.toHaveProperty('benchmark_results');
    expect(evalDocument).not.toHaveProperty('scores');
  });
});
