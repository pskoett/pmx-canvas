import { describe, expect, test } from 'bun:test';
import {
  findBundledSkillsRoot,
  listBundledSkills,
  readBundledSkill,
} from '../../src/server/bundled-skills.ts';

describe('bundled skills', () => {
  test('findBundledSkillsRoot resolves the packaged skills directory', () => {
    const root = findBundledSkillsRoot();
    expect(root).not.toBeNull();
    expect(typeof root).toBe('string');
    expect(root!.endsWith('/skills')).toBe(true);
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
});
