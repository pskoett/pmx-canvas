import { cpSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const output = resolve(root, 'dist/amp-plugin/pmx-canvas');
const adapter = resolve(root, '.github/extensions/pmx-canvas');
mkdirSync(output, { recursive: true });
for (const [entry, name] of [
  ['plugins/amp/index.ts', 'index.js'],
  ['.github/extensions/pmx-canvas/mcp-bootstrap.ts', 'start-mcp.mjs'],
]) {
  const build = await Bun.build({
    entrypoints: [resolve(root, entry)],
    target: 'bun',
    minify: false,
    plugins: [
      {
        name: 'amp-supervised-runtime',
        setup(builder) {
          builder.onResolve({ filter: /runtime\.mjs$/ }, (args) =>
            args.importer.endsWith('mcp-bootstrap.ts')
              ? { path: resolve(root, 'plugins/amp/mcp-runtime.ts') }
              : { path: './shared-runtime.mjs', external: true },
          );
        },
      },
    ],
  });
  if (!build.success) throw new AggregateError(build.logs, 'Amp plugin build failed');
  writeFileSync(resolve(output, name), await build.outputs[0].text());
}
copyFileSync(resolve(adapter, 'runtime.mjs'), resolve(output, 'shared-runtime.mjs'));
for (const name of ['runtime.json', 'tools.json', 'THIRD_PARTY_LICENSES.txt'])
  copyFileSync(resolve(adapter, name), resolve(output, name));
copyFileSync(resolve(root, 'LICENSE'), resolve(output, 'LICENSE'));
for (const name of ['pmx-canvas', 'pmx-canvas-testing', 'pmx-canvas-orchestration']) {
  cpSync(resolve(root, 'skills', name), resolve(output, 'skills', name), { recursive: true });
}
const tools = JSON.parse(readFileSync(resolve(adapter, 'tools.json'), 'utf8')) as { tools: Array<{ name: string }> };
writeFileSync(
  resolve(output, 'skills/pmx-canvas/mcp.json'),
  `${JSON.stringify(
    {
      'pmx-canvas': {
        command: 'bun',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: expanded by Amp during skill discovery.
        args: ['${AMP_SKILL_DIR}/../../start-mcp.mjs'],
        includeTools: ['canvas_connect_workspace', ...tools.tools.map((tool) => tool.name)],
      },
    },
    null,
    2,
  )}\n`,
);
console.log(`Built Amp directory plugin: ${output}`);
