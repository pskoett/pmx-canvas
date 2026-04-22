import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  CallToolResult,
  ClientCapabilities,
  ListPromptsResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListToolsResult,
  ReadResourceResult,
  TextResourceContents,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  EXTENSION_ID,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import type {
  McpUiClientCapabilities,
  McpUiResourceCsp,
  McpUiResourceMeta,
} from '@modelcontextprotocol/ext-apps';
import { getToolUiResourceUri } from '@modelcontextprotocol/ext-apps/app-bridge';
import { normalizeExtAppToolResult } from './ext-app-tool-result.js';

export interface ExternalMcpHttpTransportConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export interface ExternalMcpStdioTransportConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export type ExternalMcpTransportConfig =
  | ExternalMcpHttpTransportConfig
  | ExternalMcpStdioTransportConfig;

export interface OpenMcpAppInput {
  transport: ExternalMcpTransportConfig;
  toolName: string;
  toolArguments?: Record<string, unknown>;
  serverName?: string;
}

export interface OpenMcpAppResult {
  sessionId: string;
  serverName: string;
  toolName: string;
  tool: Tool;
  toolInput: Record<string, unknown>;
  toolResult: CallToolResult;
  resourceUri: string;
  html: string;
  resourceMeta?: McpUiResourceMeta;
}

export interface ExtAppModelContextUpdateInput {
  content?: unknown[];
  structuredContent?: Record<string, unknown>;
}

type RuntimeTransport = StdioClientTransport | StreamableHTTPClientTransport;

interface McpAppSession {
  id: string;
  serverName: string;
  client: Client;
  transport: RuntimeTransport;
  tools: Tool[];
}

const uiCapabilities: McpUiClientCapabilities = {
  mimeTypes: [RESOURCE_MIME_TYPE],
};

const clientCapabilities: ClientCapabilities & {
  extensions: Record<string, unknown>;
} = {
  extensions: {
    [EXTENSION_ID]: uiCapabilities,
  },
};

const sessions = new Map<string, McpAppSession>();
const STORAGE_SHIM_SOURCE = `<script>
(function() {
  function createStorage() {
    const data = new Map();
    return {
      getItem(key) {
        const normalized = String(key);
        return data.has(normalized) ? data.get(normalized) : null;
      },
      setItem(key, value) {
        data.set(String(key), String(value));
      },
      removeItem(key) {
        data.delete(String(key));
      },
      clear() {
        data.clear();
      },
      key(index) {
        const keys = Array.from(data.keys());
        return typeof index === 'number' && index >= 0 && index < keys.length ? keys[index] : null;
      },
      get length() {
        return data.size;
      },
    };
  }

  function installStorage(name) {
    const storage = createStorage();

    function installOn(target) {
      try {
        Object.defineProperty(target, name, {
          configurable: true,
          enumerable: true,
          get() {
            return storage;
          },
        });
        return true;
      } catch {
        return false;
      }
    }

    try {
      void window[name];
      return;
    } catch {}

    if (installOn(window)) return;
    installOn(Object.getPrototypeOf(window));
  }

  installStorage('localStorage');
  installStorage('sessionStorage');
})();
</script>`;

function randomId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([key, headerValue]) => [key, headerValue.trim()] as const)
    .filter(([, headerValue]) => headerValue.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function defaultServerName(transport: ExternalMcpTransportConfig): string {
  if (transport.type === 'http') {
    try {
      return new URL(transport.url).hostname;
    } catch {
      return 'mcp-http';
    }
  }

  const parts = transport.command.split(/[\\/]/);
  return parts[parts.length - 1] || 'mcp-stdio';
}

function normalizeServerName(raw: string | undefined, transport: ExternalMcpTransportConfig): string {
  const trimmed = String(raw || '').trim();
  return trimmed.length > 0 ? trimmed : defaultServerName(transport);
}

function buildTransport(config: ExternalMcpTransportConfig): RuntimeTransport {
  if (config.type === 'http') {
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: {
        headers: normalizeHeaders(config.headers),
      },
    });
  }

  return new StdioClientTransport({
    command: config.command,
    ...(Array.isArray(config.args) ? { args: config.args } : {}),
    ...(typeof config.cwd === 'string' && config.cwd.trim().length > 0 ? { cwd: config.cwd } : {}),
    env: Object.fromEntries(
      Object.entries({ ...process.env, ...(config.env ?? {}) }).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
    stderr: 'pipe',
  });
}

async function createSession(
  transportConfig: ExternalMcpTransportConfig,
  serverName?: string,
): Promise<McpAppSession> {
  const transport = buildTransport(transportConfig);
  const client = new Client(
    { name: 'pmx-canvas-app-host', version: '0.1.0' },
    { capabilities: clientCapabilities },
  );
  await client.connect(transport);

  const toolList = await client.listTools();
  const session: McpAppSession = {
    id: randomId('mcp-app-session'),
    serverName: normalizeServerName(serverName, transportConfig),
    client,
    transport,
    tools: toolList.tools,
  };
  sessions.set(session.id, session);
  return session;
}

async function closeSession(session: McpAppSession): Promise<void> {
  sessions.delete(session.id);
  await session.transport.close();
}

function sessionById(sessionId: string): McpAppSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`MCP app session "${sessionId}" not found.`);
  }
  return session;
}

async function refreshTools(session: McpAppSession): Promise<Tool[]> {
  const toolList = await session.client.listTools();
  session.tools = toolList.tools;
  return session.tools;
}

async function findTool(session: McpAppSession, toolName: string): Promise<Tool> {
  const direct = session.tools.find((tool) => tool.name === toolName);
  if (direct) return direct;
  const refreshed = await refreshTools(session);
  const found = refreshed.find((tool) => tool.name === toolName);
  if (!found) {
    throw new Error(`Tool "${toolName}" not found on MCP server "${session.serverName}".`);
  }
  return found;
}

function toolVisibility(tool: Tool): string[] {
  const uiMeta = isRecord(tool._meta) && isRecord(tool._meta.ui) ? tool._meta.ui : null;
  const visibility = uiMeta?.visibility;
  if (!Array.isArray(visibility)) return ['model', 'app'];
  return visibility.filter((value): value is string => typeof value === 'string');
}

function assertToolVisibleToApp(tool: Tool): void {
  if (!toolVisibility(tool).includes('app')) {
    throw new Error(`Tool "${tool.name}" is not app-callable.`);
  }
}

function contentMeta(content: { _meta?: Record<string, unknown> }): McpUiResourceMeta | undefined {
  if (!isRecord(content._meta) || !isRecord(content._meta.ui)) return undefined;
  return content._meta.ui as McpUiResourceMeta;
}

function resourceMetaFromReadResult(result: ReadResourceResult): McpUiResourceMeta | undefined {
  for (const content of result.contents) {
    const meta = contentMeta(content);
    if (meta) return meta;
  }
  return undefined;
}

function htmlContentFromReadResult(result: ReadResourceResult, resourceUri: string): string {
  for (const content of result.contents) {
    if ('text' in content && typeof content.text === 'string') {
      const textContent = content as TextResourceContents;
      if (textContent.uri === resourceUri || String(textContent.mimeType || '').startsWith('text/html')) {
        return textContent.text;
      }
    }
  }
  throw new Error(`Resource "${resourceUri}" did not return HTML content.`);
}

function cspSources(values: string[] | undefined, fallback: string): string {
  if (!values || values.length === 0) return fallback;
  return values.join(' ');
}

function buildCspContent(csp: McpUiResourceCsp | undefined): string | null {
  if (!csp) return null;
  const resources = cspSources(csp.resourceDomains, `'none'`);
  const connects = cspSources(csp.connectDomains, `'none'`);
  const frames = cspSources(csp.frameDomains, `'none'`);
  const baseUri = cspSources(csp.baseUriDomains, `'self'`);
  return [
    `default-src 'none'`,
    `script-src 'unsafe-inline' ${resources}`,
    `style-src 'unsafe-inline' ${resources}`,
    `img-src data: blob: ${resources}`,
    `font-src data: ${resources}`,
    `media-src blob: data: ${resources}`,
    `connect-src ${connects}`,
    `frame-src ${frames}`,
    `worker-src blob:`,
    `base-uri ${baseUri}`,
    `form-action 'none'`,
  ].join('; ');
}

function injectIntoHead(html: string, injected: string): string {
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch) {
    const index = headMatch.index ?? 0;
    const head = headMatch[0];
    const insertAt = index + head.length;
    return `${html.slice(0, insertAt)}${injected}${html.slice(insertAt)}`;
  }

  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (match) => `${match}<head>${injected}</head>`);
  }

  return `<!doctype html><html><head>${injected}</head><body>${html}</body></html>`;
}

function prepareResourceHtml(html: string, meta: McpUiResourceMeta | undefined): string {
  const injections = [STORAGE_SHIM_SOURCE];
  const cspContent = buildCspContent(meta?.csp);
  if (cspContent) {
    const escaped = cspContent.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    injections.unshift(`<meta http-equiv="Content-Security-Policy" content="${escaped}">`);
  }
  return injectIntoHead(html, injections.join(''));
}

export async function openMcpApp(input: OpenMcpAppInput): Promise<OpenMcpAppResult> {
  const session = await createSession(input.transport, input.serverName);
  try {
    const tool = await findTool(session, input.toolName);
    const resourceUri = getToolUiResourceUri(tool);
    if (!resourceUri) {
      throw new Error(`Tool "${input.toolName}" does not declare an MCP App resource.`);
    }

    const toolInput = isRecord(input.toolArguments) ? input.toolArguments : {};
    const rawToolResult = await session.client.callTool({
      name: tool.name,
      arguments: toolInput,
    });
    const toolResult = normalizeExtAppToolResult({ result: rawToolResult });
    const readResult = await session.client.readResource({ uri: resourceUri });
    const resourceMeta = resourceMetaFromReadResult(readResult);
    const html = prepareResourceHtml(htmlContentFromReadResult(readResult, resourceUri), resourceMeta);

    return {
      sessionId: session.id,
      serverName: session.serverName,
      toolName: tool.name,
      tool,
      toolInput,
      toolResult,
      resourceUri,
      html,
      ...(resourceMeta ? { resourceMeta } : {}),
    };
  } catch (error) {
    void closeSession(session).catch((closeError) => {
      console.debug('[mcp-app-runtime] failed to close openMcpApp session after error', {
        sessionId: session.id,
        error: closeError instanceof Error ? closeError.message : String(closeError),
      });
    });
    throw error;
  }
}

export async function callMcpAppTool(
  sessionId: string,
  toolName: string,
  args?: Record<string, unknown>,
): Promise<CallToolResult> {
  const session = sessionById(sessionId);
  const tool = await findTool(session, toolName);
  assertToolVisibleToApp(tool);
  const rawResult = await session.client.callTool({
    name: tool.name,
    arguments: isRecord(args) ? args : {},
  });
  return normalizeExtAppToolResult({ result: rawResult });
}

export async function readMcpAppResource(sessionId: string, uri: string): Promise<ReadResourceResult> {
  const session = sessionById(sessionId);
  return session.client.readResource({ uri });
}

export async function listMcpAppTools(sessionId: string): Promise<ListToolsResult> {
  const session = sessionById(sessionId);
  const tools = await refreshTools(session);
  return {
    tools: tools.filter((tool) => toolVisibility(tool).includes('app')),
  };
}

export async function listMcpAppResources(sessionId: string): Promise<ListResourcesResult> {
  const session = sessionById(sessionId);
  return session.client.listResources();
}

export async function listMcpAppResourceTemplates(sessionId: string): Promise<ListResourceTemplatesResult> {
  const session = sessionById(sessionId);
  return session.client.listResourceTemplates();
}

export async function listMcpAppPrompts(sessionId: string): Promise<ListPromptsResult> {
  const session = sessionById(sessionId);
  return session.client.listPrompts();
}

export function closeMcpAppSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  void closeSession(session).catch((error) => {
    console.debug('[mcp-app-runtime] session close failed', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export function closeAllMcpAppSessions(): void {
  for (const sessionId of [...sessions.keys()]) {
    closeMcpAppSession(sessionId);
  }
}

export function hasMcpAppSession(sessionId: string): boolean {
  return sessions.has(sessionId);
}

export function listMcpAppSessionIds(): string[] {
  return [...sessions.keys()];
}
