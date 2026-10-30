/** Measure discovery bytes, not estimated tokens. No canvas reads or writes. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const workspace = mkdtempSync(join(tmpdir(), 'pmx-mcp-catalog-'));
const transport = new StdioClientTransport({
  command: 'bun',
  args: ['run', fileURLToPath(new URL('../src/mcp/server.ts', import.meta.url))],
  cwd: workspace,
  env: {
    ...process.env,
    PMX_CANVAS_WORKSPACE_ROOT: workspace,
    PMX_CANVAS_DB_PATH: join(workspace, 'canvas.db'),
    PMX_CANVAS_DISABLE_BROWSER_OPEN: '1',
  },
  stderr: 'pipe',
});
const client = new Client({ name: 'catalog-measurement', version: '1' });
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
try {
  await client.connect(transport);
  const catalog = await client.listTools();
  console.log(JSON.stringify({
    server: client.getServerVersion(),
    tools: catalog.tools.length,
    catalogBytes: bytes(catalog),
    perTool: catalog.tools.map((tool) => ({
      name: tool.name,
      bytes: bytes(tool),
      inputSchemaBytes: bytes(tool.inputSchema),
      outputSchemaBytes: tool.outputSchema ? bytes(tool.outputSchema) : 0,
    })),
  }, null, 2));
} finally {
  await client.close();
  await transport.close();
  rmSync(workspace, { recursive: true, force: true });
}
