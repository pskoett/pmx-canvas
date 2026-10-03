import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = resolve(root, 'plugins/pmx-canvas');
const adapterRoot = resolve(root, '.github/extensions/pmx-canvas');
const packageInfo = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };
const writeJson = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

mkdirSync(resolve(pluginRoot, 'com.github.copilot/extensions/pmx-canvas'), { recursive: true });
const workspace = mkdtempSync(resolve(tmpdir(), 'pmx-plugin-catalog-'));
const health = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: () => Response.json({ ok: true, workspace }),
});
const client = new Client({ name: 'pmx-plugin-build', version: packageInfo.version }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['run', resolve(root, 'src/mcp/server.ts')],
  cwd: workspace,
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    PMX_CANVAS_URL: `http://127.0.0.1:${health.port}`,
    PMX_CANVAS_WORKSPACE_ROOT: workspace,
    PMX_CANVAS_DISABLE_BROWSER_OPEN: '1',
  },
  stderr: 'inherit',
});
try {
  await client.connect(transport);
  writeJson(resolve(adapterRoot, 'tools.json'), await client.listTools());
} finally {
  await client.close();
  await transport.close();
  health.stop(true);
  rmSync(workspace, { recursive: true, force: true });
}
const launcher = await Bun.build({
  entrypoints: [resolve(adapterRoot, 'mcp-bootstrap.ts')],
  target: 'node',
  plugins: [{
    name: 'shared-runtime',
    setup(build) {
      build.onResolve({ filter: /runtime\.mjs$/ }, () => ({ path: './runtime.mjs', external: true }));
    },
  }],
  minify: true,
  metafile: true,
});
if (!launcher.success) throw new AggregateError(launcher.logs, 'MCP plugin launcher build failed.');
if (!launcher.metafile) throw new Error('MCP plugin launcher build did not produce dependency metadata.');
writeFileSync(resolve(adapterRoot, 'start-mcp.mjs'), (await launcher.outputs[0].text()).replace(/[ \t]+$/gm, ''));
const packages = new Set<string>();
for (const input of Object.keys(launcher.metafile.inputs)) {
  let directory = dirname(resolve(root, input));
  while (directory !== dirname(directory)) {
    const manifest = resolve(directory, 'package.json');
    if (existsSync(manifest)) {
      const metadata = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };
      if (metadata.name) {
        if (metadata.name !== 'pmx-canvas') packages.add(directory);
        break;
      }
    }
    directory = dirname(directory);
  }
}
const licenses = [...packages].sort().map((directory) => {
  const metadata = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as { name: string; version: string };
  const files = readdirSync(directory).filter((name) => /^(?:license|copying)(?:[.-].*)?$/i.test(name)).sort();
  if (!files.length) throw new Error(`Missing license text for bundled dependency ${metadata.name}`);
  return `${metadata.name}@${metadata.version}\n\n${files.map((file) => readFileSync(resolve(directory, file), 'utf8')).join('\n')}`;
});
writeFileSync(resolve(adapterRoot, 'THIRD_PARTY_LICENSES.txt'), `${licenses.join('\n\n---\n\n')}\n`);
writeJson(resolve(adapterRoot, 'runtime.json'), { version: packageInfo.version });
for (const name of ['extension.mjs', 'steering-delivery.mjs', 'runtime.mjs', 'runtime.json']) {
  copyFileSync(
    resolve(adapterRoot, name),
    resolve(pluginRoot, 'com.github.copilot/extensions/pmx-canvas', name),
  );
}
for (const name of ['runtime.mjs', 'runtime.json', 'start-mcp.mjs', 'tools.json', 'THIRD_PARTY_LICENSES.txt']) {
  copyFileSync(resolve(adapterRoot, name), resolve(pluginRoot, name));
}
copyFileSync(resolve(root, 'LICENSE'), resolve(pluginRoot, 'LICENSE'));
writeJson(resolve(pluginRoot, 'plugin.json'), {
  $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
  name: 'pmx-canvas',
  description: 'PMX Canvas spatial workbench and MCP tools, with a native canvas panel in the GitHub Copilot app.',
  version: packageInfo.version,
  author: { name: 'pskoett', url: 'https://github.com/pskoett' },
  repository: 'https://github.com/pskoett/pmx-canvas',
  homepage: 'https://github.com/pskoett/pmx-canvas#readme',
  license: 'MIT',
  keywords: ['canvas', 'mcp', 'spatial', 'copilot-canvas'],
});
writeJson(resolve(pluginRoot, 'mcp.json'), {
  $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
  mcpServers: {
    'pmx-canvas': {
      type: 'stdio',
      command: 'bun',
      args: ['${PLUGIN_ROOT}/start-mcp.mjs'],
    },
  },
});
console.log(`Built Agent Plugins package: plugins/pmx-canvas (${packageInfo.version})`);
