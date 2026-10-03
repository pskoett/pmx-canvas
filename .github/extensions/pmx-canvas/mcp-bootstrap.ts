import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  McpError,
  ReadResourceRequestSchema,
  ResourceUpdatedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ListRootsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { isAbsolute, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { canonicalWorkspace, ensurePmxServer, probePmxServer, runtimeCommand, runtimeVersion } from './runtime.mjs';

const connector = 'canvas_connect_workspace';
const packageRoot = canonicalWorkspace(dirname(fileURLToPath(import.meta.url)));
const catalog = ListToolsResultSchema.parse(JSON.parse(readFileSync(new URL('./tools.json', import.meta.url), 'utf8')));
const server = new Server(
  { name: 'pmx-canvas-plugin', version: runtimeVersion },
  {
    capabilities: { tools: { listChanged: true }, resources: { listChanged: true } },
    instructions: `Before using any PMX board tool, call ${connector} with the absolute active project directory. Never use the plugin installation directory as the workspace. Then read skill://pmx-canvas/SKILL.md for workbench guidance. The connection returns a browser workbench URL; the native Copilot canvas is client-specific.`,
  },
);
let upstream: Client | undefined;
let upstreamTransport: StdioClientTransport | undefined;
let binding: Promise<{ workspaceRoot: string; serverUrl: string }> | undefined;
let boundWorkspace: string | undefined;
let boundServerUrl: string | undefined;

async function connected(): Promise<Client> {
  if (!upstream || !boundServerUrl || !boundWorkspace) {
    throw new McpError(ErrorCode.InvalidRequest, `Call ${connector} with your absolute project directory first.`);
  }
  const health = await probePmxServer(boundServerUrl, boundWorkspace);
  if (!health.ok) {
    throw new McpError(ErrorCode.InvalidRequest, `The bound PMX server is unavailable or belongs to another workspace: ${health.error}`);
  }
  return upstream;
}

async function bindWorkspace(root: string) {
  if (!isAbsolute(root)) throw new McpError(ErrorCode.InvalidParams, 'workspaceRoot must be an absolute project directory.');
  root = canonicalWorkspace(root);
  const withinPackage = relative(packageRoot, root);
  if (!withinPackage || (withinPackage !== '..' && !withinPackage.startsWith(`..${sep}`) && !isAbsolute(withinPackage))) {
    throw new McpError(ErrorCode.InvalidParams, 'The plugin installation directory is not a project workspace.');
  }
  if (boundWorkspace && boundWorkspace !== root) {
    throw new McpError(ErrorCode.InvalidParams, 'This MCP session is already bound to another workspace. Start a new session.');
  }
  if (binding) {
    const target = await binding;
    await connected();
    return target;
  }
  boundWorkspace = root;
  binding = (async () => {
    const target = await ensurePmxServer(root);
    if (!target.ok || !target.baseUrl || !target.health) throw new Error(target.error ?? 'PMX Canvas is unavailable.');
    if (closing) throw new Error('MCP session closed while connecting the workspace.');
    const runtime = runtimeCommand();
    const transport = new StdioClientTransport({
      command: runtime.command,
      args: [...runtime.args, '--mcp'],
      cwd: root,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
        PMX_CANVAS_URL: target.baseUrl,
        PMX_CANVAS_WORKSPACE_ROOT: root,
        PMX_CANVAS_DISABLE_BROWSER_OPEN: '1',
      },
      stderr: 'inherit',
    });
    const capabilities = server.getClientCapabilities() ?? {};
    const client = new Client(
      { name: 'pmx-canvas-plugin', version: runtimeVersion },
      { capabilities },
    );
    if (capabilities.roots) client.setRequestHandler(ListRootsRequestSchema, () => server.listRoots());
    if (capabilities.sampling) {
      client.setRequestHandler(CreateMessageRequestSchema, (request) => server.createMessage(request.params));
    }
    if (capabilities.elicitation) {
      client.setRequestHandler(ElicitRequestSchema, (request) => server.elicitInput(request.params));
    }
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => server.sendToolListChanged());
    client.setNotificationHandler(ResourceListChangedNotificationSchema, () => server.sendResourceListChanged());
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => server.notification(notification));
    try {
      await client.connect(transport);
      if (closing) throw new Error('MCP session closed while connecting the workspace.');
      upstream = client;
      upstreamTransport = transport;
      boundServerUrl = target.baseUrl;
      await server.sendToolListChanged();
      await server.sendResourceListChanged();
    } catch (error) {
      upstream = undefined;
      upstreamTransport = undefined;
      boundServerUrl = undefined;
      await client.close();
      await transport.close();
      throw error;
    }
    return { workspaceRoot: root, serverUrl: target.baseUrl };
  })();
  try {
    return await binding;
  } catch (error) {
    binding = undefined;
    boundWorkspace = undefined;
    throw error;
  }
}

// Some hosts cache the initial tool set even after tools/list_changed; board tools stay locked until binding.
server.setRequestHandler(ListToolsRequestSchema, async (request) => ({
  tools: [
    {
      name: connector,
      description: 'Connect PMX Canvas to the user-selected project BEFORE using board tools. Pass the absolute active project directory, never the plugin installation folder. Returns the browser workbench URL and enables the PMX tools for this MCP session.',
      inputSchema: {
        type: 'object',
        properties: { workspaceRoot: { type: 'string', description: 'Absolute directory of the intended project.' } },
        required: ['workspaceRoot'],
        additionalProperties: false,
      },
    },
    ...(upstream ? (await (await connected()).listTools(request.params)).tools : catalog.tools),
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  if (request.params.name !== connector) {
    return await (await connected()).request(request, CallToolResultSchema, { signal: extra.signal });
  }
  const root = request.params.arguments?.workspaceRoot;
  if (typeof root !== 'string') throw new McpError(ErrorCode.InvalidParams, 'workspaceRoot is required.');
  try {
    const target = await bindWorkspace(root);
    return {
      content: [{ type: 'text', text: JSON.stringify({ ...target, workbenchUrl: `${target.serverUrl}/workbench` }) }],
      structuredContent: { ...target, workbenchUrl: `${target.serverUrl}/workbench` },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[pmx-canvas] Workspace connection failed: ${message}\n`);
    return { isError: true, content: [{ type: 'text', text: message }] };
  }
});
server.setRequestHandler(ListResourcesRequestSchema, async (request) =>
  upstream ? await (await connected()).listResources(request.params) : { resources: [] });
server.setRequestHandler(ListResourceTemplatesRequestSchema, async (request) =>
  upstream ? await (await connected()).listResourceTemplates(request.params) : { resourceTemplates: [] });
server.setRequestHandler(ReadResourceRequestSchema, async (request) => await (await connected()).readResource(request.params));

server.oninitialized = async () => {
  try {
    const configured = process.env.PMX_CANVAS_WORKSPACE_ROOT;
    if (configured) {
      await bindWorkspace(configured);
    } else if (server.getClientCapabilities()?.roots) {
      const { roots } = await server.listRoots();
      if (roots.length === 1 && roots[0].uri.startsWith('file:')) await bindWorkspace(fileURLToPath(roots[0].uri));
    }
  } catch (error) {
    process.stderr.write(`[pmx-canvas] Automatic workspace connection failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }
};
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try {
    await upstream?.close();
    await upstreamTransport?.close();
    await server.close();
  } catch (error) {
    process.stderr.write(`[pmx-canvas] MCP shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
server.onclose = () => void shutdown();
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
await server.connect(new StdioServerTransport());
