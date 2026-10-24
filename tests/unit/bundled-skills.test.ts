import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { findBundledSkillsRoot, listBundledSkills, readBundledSkill } from '../../src/server/bundled-skills.ts';
import { CANVAS_THEMES } from '../../src/shared/themes.ts';

describe('bundled skills', () => {
  test('behavioral eval catalog has valid definitions, unique identities and shipped fixtures', async () => {
    const nonempty = z.string().trim().min(1);
    const definition = z.strictObject({
      id: z.number().int().positive(),
      name: nonempty,
      prompt: nonempty,
      expected_output: nonempty,
      files: z.array(nonempty).optional(),
      assertions: z
        .array(z.strictObject({ name: nonempty, description: nonempty, type: z.literal('output_check') }))
        .min(1),
    });
    const catalog = z
      .strictObject({ skill_name: z.literal('pmx-canvas'), evals: z.array(definition).min(1) })
      .parse(await Bun.file(new URL('../../skills/pmx-canvas/evals/evals.json', import.meta.url)).json());

    expect(new Set(catalog.evals.map((entry) => entry.id)).size).toBe(catalog.evals.length);
    expect(new Set(catalog.evals.map((entry) => entry.name)).size).toBe(catalog.evals.length);
    for (const entry of catalog.evals) {
      expect(new Set(entry.assertions.map((assertion) => assertion.name)).size).toBe(entry.assertions.length);
      for (const file of entry.files ?? []) {
        expect(file.startsWith('evals/fixtures/')).toBe(true);
        expect(file.split('/')).not.toContain('..');
        expect(await Bun.file(new URL(`../../skills/pmx-canvas/${file}`, import.meta.url)).exists()).toBe(true);
      }
    }

    const connectedMemoryEvals = [
      'folder-cli-without-removed-category',
      'whole-library-map-versus-full-content-delivery',
      'durable-background-create-replay',
      'background-create-conflicts-and-stale-active-guard',
      'board-qualified-native-relations',
      'wiki-bindings-survive-renames-without-guessing',
      'review-evidence-bound-to-checked-content-and-sources',
      'retirement-excludes-context-until-audited-restore',
    ];
    for (const name of connectedMemoryEvals) {
      const entry = catalog.evals.find((candidate) => candidate.name === name);
      expect(entry, name).toBeDefined();
      expect(entry!.assertions.length).toBeGreaterThanOrEqual(4);
    }
  });

  test('browser workflow theme names match the shipped registry', () => {
    const skill = readBundledSkill('pmx-canvas')!;
    const themeList = skill.match(/nine themes: ([^)]+)\)/)?.[1];
    expect(themeList?.split(',').map((theme) => theme.trim())).toEqual([...CANVAS_THEMES]);
  });

  test('routine AX state recipe explicitly excludes context', () => {
    const skill = readBundledSkill('pmx-canvas')!;
    const recipe = skill.match(/\*\*Token hygiene\.\*\*[\s\S]*?`canvas_ax_state (\{[^}]+\})`/)?.[1];
    expect(recipe).toBeDefined();
    expect(recipe).toMatch(/action:\s*"get"/);
    expect(recipe).toMatch(/includeContext:\s*false\b/);
  });

  test('Copilot adapter documentation links work outside the repository skill layout', async () => {
    const guide = await Bun.file(
      new URL('../../skills/pmx-canvas/references/github-copilot-app-adapter.md', import.meta.url),
    ).text();
    for (const document of ['agent-plugin.md', 'ax-host-adapter-contract.md']) {
      const target = [...guide.matchAll(/\]\(([^)]+)\)/g)].find((match) => match[1]!.endsWith(`/${document}`))?.[1];
      expect(target).toBeDefined();
      expect(target).toBe(`https://github.com/pskoett/pmx-canvas/blob/main/docs/${document}`);
      expect(await Bun.file(new URL(`../../docs/${document}`, import.meta.url)).exists()).toBe(true);
    }
  });

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

  test('the linked Amp setup guide pins the workspace, target and steering identity', async () => {
    const { version } = await Bun.file(new URL('../../package.json', import.meta.url)).json();
    const readme = await Bun.file(new URL('../../Readme.md', import.meta.url)).text();
    expect(readme).toContain('(skills/pmx-canvas/references/installing-pmx-canvas.md#amp-');
    const markdown = await Bun.file(
      new URL('../../skills/pmx-canvas/references/installing-pmx-canvas.md', import.meta.url),
    ).text();
    const configs = [...markdown.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)].map((match) => JSON.parse(match[1]!));
    const ampConfigs = configs.filter((config) => config['amp.mcpServers']);
    expect(ampConfigs).toHaveLength(1);
    expect(ampConfigs[0]['amp.mcpServers'].canvas).toEqual({
      command: 'bunx',
      args: [`pmx-canvas@${version}`, '--mcp'],
      includeTools: ['canvas_*'],
      env: {
        PMX_CANVAS_WORKSPACE_ROOT: '/absolute/path/to/project',
        PMX_CANVAS_PORT: '14313',
        PMX_CANVAS_URL: '',
        PMX_CANVAS_AGENT_SOURCE: 'amp',
      },
    });
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
      'amp-workspace-trust-and-target',
      'amp-native-steering-evidence-boundary',
      'json-focus-runtime-state-continuity',
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
