import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { defineCatalog } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { z } from 'zod';
import { normalizeAndValidateJsonRenderSpec } from '../../src/json-render/server.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import { findBundledSkillsRoot, listBundledSkills, readBundledSkill } from '../../src/server/bundled-skills.ts';
import { CANVAS_THEMES } from '../../src/shared/themes.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

describe('bundled skills', () => {
  test('shipped manifests follow the skill spec and resolve their license files', async () => {
    const manifest = z.strictObject({
      name: z
        .string()
        .max(64)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      description: z
        .string()
        .min(1)
        .max(1024)
        .regex(/^[^<>]*$/),
      license: z.string().optional(),
      compatibility: z.string().max(500).optional(),
      'allowed-tools': z.string().optional(),
      metadata: z.record(z.string(), z.string()).optional(),
    });
    for (const skill of listBundledSkills()) {
      const parsed = manifest.parse(skill.frontmatter);
      expect(parsed.name).toBe(skill.name);
      const markdown = readBundledSkill(skill.name)!;
      expect(markdown.split('\n').length, skill.name).toBeLessThanOrEqual(600);
      for (const license of parsed.license?.match(/LICENSE\.\w+/g) ?? []) {
        expect(await Bun.file(join(dirname(skill.filePath), license)).exists(), `${skill.name}/${license}`).toBe(true);
      }
    }
  });

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

  test('Codex setup examples parse as native MCP TOML with an explicit target and identity', async () => {
    const { version } = await Bun.file(new URL('../../package.json', import.meta.url)).json();
    const markdown = await Bun.file(
      new URL('../../skills/pmx-canvas/references/codex-app-adapter.md', import.meta.url),
    ).text();
    const config = z.object({
      mcp_servers: z.object({
        canvas: z.object({ command: z.string(), args: z.array(z.string()), env: z.record(z.string(), z.string()) }),
      }),
    });
    const examples = [...markdown.matchAll(/```toml\r?\n([\s\S]*?)\r?\n```/g)].map(
      (match) => config.parse(Bun.TOML.parse(match[1]!)).mcp_servers.canvas,
    );
    expect(examples).toHaveLength(2);
    expect(examples.map(({ command, args }) => ({ command, args }))).toEqual([
      { command: 'bunx', args: [`pmx-canvas@${version}`, '--mcp'] },
      { command: 'bun', args: ['run', '/absolute/path/to/pmx-canvas/src/cli/index.ts', '--mcp'] },
    ]);
    for (const example of examples) {
      expect(example.env).toEqual({
        PMX_CANVAS_WORKSPACE_ROOT: '/absolute/path/to/project',
        PMX_CANVAS_PORT: '14313',
        PMX_CANVAS_URL: '',
        PMX_CANVAS_AGENT_SOURCE: 'codex',
      });
    }
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

// The 0.12.1 skill audit ran shipped examples literally: an object-valued json-render root and a
// POST-grouped delivery poll both failed. These cases execute what the skills ship, not paraphrases.
describe('shipped skill examples execute', () => {
  test('json-render-react spec example validates against its catalog and PMX', async () => {
    const markdown = readBundledSkill('json-render-react')!;
    const block = markdown.match(/## Spec Structure[\s\S]*?```json\r?\n([\s\S]*?)\r?\n```/)?.[1];
    expect(block).toBeDefined();
    const spec = JSON.parse(block!);
    // The catalog shown in the skill's "Creating a Catalog" section.
    const skillCatalog = defineCatalog(schema, {
      components: {
        Button: {
          props: z.object({ label: z.string(), variant: z.enum(['primary', 'secondary']).nullable() }),
          description: 'Clickable button',
        },
        Card: { props: z.object({ title: z.string() }), description: 'Card container with title' },
      },
      actions: {},
    });
    expect(skillCatalog.validate(spec).success).toBe(true);
    expect(normalizeAndValidateJsonRenderSpec(spec).root).toBe(spec.root);
  });

  test('orchestration worker HTTP path uses the methods the server routes', async () => {
    const skill = readBundledSkill('pmx-canvas-orchestration')!;
    const bullet = skill.match(/\*\*No MCP in the subagent\?\*\*([\s\S]*?)\n- \*\*/)?.[1];
    expect(bullet).toBeDefined();
    let method = '';
    const calls: Array<[string, string]> = [];
    for (const [token] of bullet!.matchAll(/\b(?:GET|POST)\b|\/api\/[^\s,]+/g)) {
      if (token === 'GET' || token === 'POST') method = token;
      else calls.push([method, token]);
    }
    expect(calls).toEqual([
      ['POST', '/api/canvas/node'],
      ['POST', '/api/canvas/ax/presence'],
      ['GET', '/api/canvas/ax/delivery/pending?consumer=<agentId>'],
      ['POST', '/api/canvas/ax/delivery/:id/mark'],
    ]);

    const workspaceRoot = createTestWorkspace('pmx-canvas-skill-http-');
    resetCanvasForTests(workspaceRoot);
    const baseUrl = startCanvasServer({ workspaceRoot, port: 0, autoOpenBrowser: false });
    try {
      expect(baseUrl).toBeTruthy();
      const agentId = 'skill-worker';
      const steer = await fetch(`${baseUrl}/api/canvas/ax/steer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'take the next lane', source: 'browser', target: agentId }),
      });
      const steeringId = ((await steer.json()) as { steering: { id: string } }).steering.id;
      const bodies: Record<string, unknown> = {
        '/api/canvas/node': { type: 'markdown', title: 'Worker note', content: 'done', agentId },
        '/api/canvas/ax/presence': { source: 'api', agentId, phase: 'tooling' },
        '/api/canvas/ax/delivery/:id/mark': { consumer: agentId },
      };
      const responses: Record<string, { status: number; body: Record<string, unknown> }> = {};
      for (const [verb, path] of calls) {
        const url = path.replace('<agentId>', agentId).replace(':id', steeringId);
        const res = await fetch(`${baseUrl}${url}`, {
          method: verb,
          ...(verb === 'POST'
            ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodies[path]) }
            : {}),
        });
        responses[path] = { status: res.status, body: (await res.json()) as Record<string, unknown> };
      }
      for (const [path, response] of Object.entries(responses)) expect(response.status, path).toBeLessThan(300);
      const pending = responses['/api/canvas/ax/delivery/pending?consumer=<agentId>']!.body.pending as Array<{
        id: string;
      }>;
      expect(pending.map((message) => message.id)).toContain(steeringId);
      expect(responses['/api/canvas/ax/delivery/:id/mark']!.body.delivered).toBe(true);
    } finally {
      stopCanvasServer();
      removeTestWorkspace(workspaceRoot);
    }
  });
});
