import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const pluginRoot = resolve('plugins/pmx-canvas');
const adapterRoot = resolve('.github/extensions/pmx-canvas');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

describe('portable PMX Canvas plugin', () => {
  test('packages MCP portably and the native panel only in the Copilot namespace', () => {
    const plugin = readJson(resolve(pluginRoot, 'plugin.json'));
    const mcp = readJson(resolve(pluginRoot, 'mcp.json'));
    const version = readJson('package.json').version;
    expect(plugin).toMatchObject({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'pmx-canvas',
      version,
    });
    expect(plugin.skills).toBeUndefined();
    expect(plugin.agents).toBeUndefined();
    expect(plugin.mcpServers).toBeUndefined();
    expect(mcp).toEqual({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: {
        'pmx-canvas': {
          type: 'stdio',
          command: 'bun',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: Agent Plugins expands this placeholder, not JavaScript.
          args: ['${PLUGIN_ROOT}/start-mcp.mjs'],
        },
      },
    });
    expect(readdirSync(resolve(pluginRoot, 'com.github.copilot/extensions'))).toEqual(['pmx-canvas']);
    expect(readJson(resolve(pluginRoot, 'runtime.json')).version).toBe(version);
    expect(readJson('package.json').files).toContain('plugins/pmx-canvas/');
  });

  test('generated copies cannot drift from the canonical adapter or version pin', () => {
    for (const file of ['extension.mjs', 'steering-delivery.mjs', 'runtime.mjs', 'runtime.json']) {
      expect(readFileSync(resolve(pluginRoot, 'com.github.copilot/extensions/pmx-canvas', file), 'utf8')).toBe(
        readFileSync(resolve(adapterRoot, file), 'utf8'),
      );
    }
    for (const file of ['runtime.mjs', 'runtime.json', 'start-mcp.mjs', 'tools.json', 'THIRD_PARTY_LICENSES.txt']) {
      expect(readFileSync(resolve(pluginRoot, file), 'utf8')).toBe(readFileSync(resolve(adapterRoot, file), 'utf8'));
    }
  });
});
