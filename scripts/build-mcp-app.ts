import { readFile } from 'node:fs/promises';

const result = await Bun.build({
  entrypoints: ['src/client/mcp-app/index.tsx'],
  target: 'browser',
  format: 'iife',
  minify: true,
});
if (!result.success) throw new AggregateError(result.logs, 'MCP App build failed');
const js = (await result.outputs[0]!.text()).replace(/<\/script/gi, '<\\/script');
const css = await readFile('src/client/theme/global.css', 'utf8') + '\n' + await readFile('src/client/mcp-app/style.css', 'utf8');
await Bun.write('dist/canvas/mcp-app.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PMX Canvas</title><style>${css}</style></head>
<body><div id="app"></div><script>${js}</script></body></html>`);
