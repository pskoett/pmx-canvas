import type { PluginAPI } from '@ampcode/plugin';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const description =
  'PMX Canvas SDLC tools: pmx_canvas_health (is the canvas up, which checkout and bundle it serves, is dist stale) and pmx_release_status (package, tag, npm, GitHub release and CI for one version).';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

function newestMtime(path: string): number {
  if (!statSync(path).isDirectory()) return statSync(path).mtimeMs;
  return Math.max(0, ...readdirSync(path).map((name) => newestMtime(join(path, name))));
}

// What the client bundle is built from (type-only server imports excluded).
const BUNDLE_INPUTS = ['src/client', 'src/shared', 'src/server/spatial-analysis.ts'];

export default function (amp: PluginAPI) {
  const root = amp.system.workspaceRoot ? amp.helpers.filePathFromURI(amp.system.workspaceRoot) : process.cwd();
  const version = () => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string;

  amp.registerTool({
    name: 'pmx_canvas_health',
    title: 'Check PMX Canvas health',
    description:
      'Check a running PMX Canvas server before testing or reporting UI results: whether it is up, which workspace and version it serves, whether the bytes it serves match this checkout, whether dist/ is older than src/client (needs `bun run build`), and whether open tabs still run an older bundle (needs a server restart). Also lists portal URLs. Defaults to port 4313, the .amp/services.yaml canvas service.',
    inputSchema: {
      type: 'object',
      properties: { port: { type: 'number', description: 'Server port (default 4313).' } },
    },
    async execute(input) {
      const port = typeof input.port === 'number' ? input.port : 4313;
      const base = `http://127.0.0.1:${port}`;
      const lines: string[] = [];
      const problems: string[] = [];
      let health: { workspace?: string; version?: string; pid?: number; bundleStamp?: string; persistence?: { ok?: boolean } };
      try {
        health = await (await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) })).json();
      } catch {
        return `DOWN: nothing answers ${base}/health. Start it with \`amp orb services ensure\` (declared in .amp/services.yaml).`;
      }
      lines.push(`up on ${port}: pid ${health.pid}, version ${health.version}, workspace ${health.workspace}`);
      if (health.workspace !== root) problems.push(`serves workspace ${health.workspace}, not this checkout ${root}`);
      if (health.version !== version()) problems.push(`server version ${health.version} != package.json ${version()}`);
      if (health.persistence && health.persistence.ok === false) problems.push('persistence degraded (saves failing)');

      const bundle = join(root, 'dist/canvas/index.js');
      if (!existsSync(bundle)) {
        problems.push('dist/canvas/index.js missing: run `bun run build`');
      } else {
        const stat = statSync(bundle);
        const servedBytes = new Uint8Array(await (await fetch(`${base}/canvas/index.js`)).arrayBuffer());
        if (sha(servedBytes) !== sha(readFileSync(bundle))) {
          problems.push('served /canvas/index.js differs from this checkout’s dist: another checkout or build is serving');
        }
        if (health.bundleStamp !== `${Math.round(stat.mtimeMs)}-${stat.size}`) {
          problems.push(
            'dist was rebuilt after the server started: open tabs keep old JS until `amp orb service restart canvas`',
          );
        }
        const stale = BUNDLE_INPUTS.find((input) => newestMtime(join(root, input)) > stat.mtimeMs);
        if (stale) problems.push(`${stale} changed after the last build: run \`bun run build\`, then restart the server`);
      }
      const portals = join(root, '.amp/portals');
      if (existsSync(portals)) {
        for (const file of readdirSync(portals).filter((name) => name.endsWith('.json'))) {
          const manifest = JSON.parse(readFileSync(join(portals, file), 'utf8'));
          for (const link of manifest.links ?? []) if (link.url) lines.push(`portal: ${link.label ?? file} ${link.url}`);
        }
      }
      return [problems.length ? `STALE OR WRONG (${problems.length})` : 'HEALTHY', ...problems.map((p) => `- ${p}`), ...lines].join('\n');
    },
  });

  amp.registerTool({
    name: 'pmx_release_status',
    title: 'Check PMX Canvas release status',
    description:
      'Report where one pmx-canvas version is in the release pipeline: package.json, git tag (local and origin), npm registry (dist-tags and the published gitHead), GitHub release, and CI runs for the tagged commit. Use instead of polling npm or GitHub by hand. Defaults to the package.json version.',
    inputSchema: {
      type: 'object',
      properties: { version: { type: 'string', description: 'Version such as 0.11.0 (default: package.json).' } },
    },
    async execute(input) {
      const v = typeof input.version === 'string' ? input.version.replace(/^v/, '') : version();
      // The version reaches shell commands, so accept only a semver string.
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v)) throw new Error(`Not a version: ${v}`);
      const tag = `v${v}`;
      const lines: string[] = [];
      const sh = async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const out = await amp.$(strings, ...values);
        return out.exitCode === 0 ? out.stdout.trim() : `unavailable (${(out.stderr || out.stdout).trim().split('\n')[0]})`;
      };
      const local = await amp.$`git -C ${root} rev-parse --verify --quiet ${`${tag}^{commit}`}`;
      const localTag = local.exitCode === 0 ? local.stdout.trim() : '';
      // Peeled ref: annotated tags list the tag object first; `^{}` is the commit it points at.
      const remoteTag = (await sh`git -C ${root} ls-remote --tags origin ${`refs/tags/${tag}^{}`}`).split(/\s+/)[0] ?? '';
      // The registry API, not the npm CLI: npm crashes under the plugin runtime's environment.
      let npmTags = 'unavailable';
      let npmVersion = 'not published';
      try {
        const doc = await (await fetch('https://registry.npmjs.org/pmx-canvas', { signal: AbortSignal.timeout(8000) })).json();
        npmTags = JSON.stringify(doc['dist-tags']);
        const published = doc.versions?.[v];
        if (published) npmVersion = `gitHead ${published.gitHead}, published ${doc.time?.[v]}`;
      } catch (error) {
        npmTags = `unavailable (${String(error)})`;
      }
      const release = await sh`gh release view ${tag} --repo pskoett/pmx-canvas --json tagName,isDraft,publishedAt,url`;
      const commit = /^[0-9a-f]{40}$/.test(localTag) ? localTag : remoteTag;
      if (/^[0-9a-f]{40}$/.test(localTag) && /^[0-9a-f]{40}$/.test(remoteTag) && localTag !== remoteTag) {
        lines.push(`WARNING: local ${tag} (${localTag}) != origin (${remoteTag})`);
      }
      const ci = /^[0-9a-f]{40}$/.test(commit)
        ? await sh`gh run list --repo pskoett/pmx-canvas --commit ${commit} --json name,status,conclusion,url`
        : 'no tagged commit yet';
      return [
        `version ${v} (package.json ${version()})`,
        `git tag local: ${localTag || 'missing'}`,
        `git tag origin: ${remoteTag || 'missing'}`,
        `npm dist-tags: ${npmTags}`,
        `npm ${v}: ${npmVersion || 'not published'}`,
        `GitHub release: ${release}`,
        `CI on tagged commit: ${ci}`,
        ...lines,
      ].join('\n');
    },
  });

  // Workspace MCP approval is a trust decision, so it stays a human-run palette command, not a tool.
  amp.registerCommand(
    'approve-canvas-mcp',
    { title: 'approve canvas MCP', category: 'pmx', description: 'Approve this workspace’s canvas MCP server' },
    async (ctx) => {
      const name = (await ctx.ui.input({ title: 'Workspace MCP server to approve', initialValue: 'canvas' }))?.trim();
      if (!name) return;
      const out = await ctx.$`amp mcp approve ${name}`;
      await ctx.ui.notify(out.exitCode === 0 ? `Approved ${name}` : `Approval failed: ${(out.stderr || out.stdout).trim()}`);
    },
  );
}
