import type { CanvasNodeState } from './canvas-state.js';

const DEFAULT_CONTEXT_TEXT_LENGTH = 700;
const DEFAULT_WEBPAGE_CONTEXT_TEXT_LENGTH = 1600;

export interface AgentContextNode {
  id: string;
  type: CanvasNodeState['type'];
  title: string | null;
  content: string | null;
  metadata?: Record<string, unknown>;
  position?: { x: number; y: number };
}

interface AgentContextOptions {
  defaultTextLength?: number;
  webpageTextLength?: number;
  includePosition?: boolean;
}

function normalizeContextText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateContextText(text: string, maxLength: number): string {
  if (maxLength <= 0) return '';
  const normalized = normalizeContextText(text);
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 1) return normalized.slice(0, maxLength);
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function stringifyContextValue(value: unknown, maxLength: number): string {
  if (typeof value === 'string') return truncateContextText(value, maxLength);
  if (value === null || value === undefined) return '';
  try {
    return truncateContextText(JSON.stringify(value), maxLength);
  } catch {
    return '';
  }
}

function summarizeWebpageData(data: Record<string, unknown>, maxLength: number): string {
  const parts: string[] = [];
  const url = typeof data.url === 'string' ? data.url : '';
  const pageTitle = typeof data.pageTitle === 'string' ? data.pageTitle : '';
  const description = typeof data.description === 'string' ? data.description : '';
  const status = typeof data.status === 'string' ? data.status : '';
  const statusCode = typeof data.statusCode === 'number' ? data.statusCode : null;
  const error = typeof data.error === 'string' ? data.error : '';
  const content = typeof data.content === 'string'
    ? data.content
    : typeof data.excerpt === 'string'
      ? data.excerpt
      : '';

  if (url) parts.push(`URL: ${url}`);
  if (pageTitle) parts.push(`Title: ${pageTitle}`);
  if (description) parts.push(`Description: ${description}`);
  if (status || statusCode !== null) {
    parts.push(`Fetch: ${status || 'unknown'}${statusCode !== null ? ` (${statusCode})` : ''}`);
  }
  if (error) parts.push(`Error: ${error}`);

  const header = parts.join('\n');
  const remaining = Math.max(0, maxLength - header.length - (header ? 2 : 0));
  const body = remaining > 0 ? truncateContextText(content, remaining) : '';

  if (header && body) return `${header}\n\n${body}`;
  if (header) return truncateContextText(header, maxLength);
  return truncateContextText(content, maxLength);
}

function summarizeExtAppInput(toolInput: unknown): string {
  if (toolInput === null || toolInput === undefined) return '';
  if (typeof toolInput !== 'object' || Array.isArray(toolInput)) return '';
  const elements = (toolInput as Record<string, unknown>).elements;
  if (Array.isArray(elements)) {
    return `Diagram elements: ${elements.length}`;
  }
  const keys = Object.keys(toolInput as Record<string, unknown>).sort();
  return keys.length > 0 ? `Input keys: ${keys.join(', ')}` : '';
}

function summarizeMcpAppData(data: Record<string, unknown>, maxLength: number): string {
  const parts: string[] = [];
  const title = typeof data.title === 'string' ? data.title : '';
  const mode = typeof data.mode === 'string' ? data.mode : '';
  const hostMode = typeof data.hostMode === 'string' ? data.hostMode : '';
  const serverName = typeof data.serverName === 'string' ? data.serverName : '';
  const toolName = typeof data.toolName === 'string' ? data.toolName : '';
  const resourceUri = typeof data.resourceUri === 'string' ? data.resourceUri : '';
  const path = typeof data.path === 'string' ? data.path : '';
  const url = typeof data.url === 'string' ? data.url : '';
  const sessionStatus = typeof data.sessionStatus === 'string' ? data.sessionStatus : '';
  const inputSummary = summarizeExtAppInput(data.toolInput);

  if (title) parts.push(`App: ${title}`);
  if (mode || hostMode) {
    parts.push(`Mode: ${[mode, hostMode].filter(Boolean).join(' / ')}`);
  }
  if (serverName || toolName) {
    parts.push(`Source: ${[serverName, toolName].filter(Boolean).join(' / ')}`);
  }
  if (resourceUri) parts.push(`Resource: ${resourceUri}`);
  if (path) parts.push(`Path: ${path}`);
  if (url) parts.push(`URL: ${url}`);
  if (sessionStatus) parts.push(`Session: ${sessionStatus}`);
  if (inputSummary) parts.push(inputSummary);

  if (parts.length === 0) return 'MCP App node';
  return truncateContextText(parts.join('\n'), maxLength);
}

function metadataForNode(node: CanvasNodeState): Record<string, unknown> | undefined {
  switch (node.type) {
    case 'webpage': {
      const metadata: Record<string, unknown> = {};
      for (const key of ['url', 'pageTitle', 'description', 'imageUrl', 'fetchedAt', 'status', 'statusCode', 'contentType']) {
        const value = node.data[key];
        if (value !== undefined && value !== null && value !== '') metadata[key] = value;
      }
      return Object.keys(metadata).length > 0 ? metadata : undefined;
    }
    case 'file': {
      const metadata: Record<string, unknown> = {};
      for (const key of ['path', 'updatedAt', 'lineCount']) {
        const value = node.data[key];
        if (value !== undefined && value !== null && value !== '') metadata[key] = value;
      }
      return Object.keys(metadata).length > 0 ? metadata : undefined;
    }
    case 'image': {
      const metadata: Record<string, unknown> = {};
      for (const key of ['src', 'path', 'mimeType', 'validationStatus', 'validationMessage']) {
        const value = node.data[key];
        if (value !== undefined && value !== null && value !== '') metadata[key] = value;
      }
      return Object.keys(metadata).length > 0 ? metadata : undefined;
    }
    case 'mcp-app': {
      const metadata: Record<string, unknown> = {};
      for (const key of ['url', 'path', 'mode', 'hostMode', 'serverName', 'toolName', 'resourceUri', 'sessionStatus']) {
        const value = node.data[key];
        if (value !== undefined && value !== null && value !== '') metadata[key] = value;
      }
      return Object.keys(metadata).length > 0 ? metadata : undefined;
    }
    default:
      return undefined;
  }
}

export function summarizeNodeForAgentContext(
  node: CanvasNodeState,
  options: AgentContextOptions = {},
): string {
  const defaultTextLength = options.defaultTextLength ?? DEFAULT_CONTEXT_TEXT_LENGTH;
  const webpageTextLength = options.webpageTextLength ?? DEFAULT_WEBPAGE_CONTEXT_TEXT_LENGTH;

  switch (node.type) {
    case 'markdown': {
      const content = (node.data.rendered as string) || (node.data.content as string) || '';
      return truncateContextText(content, defaultTextLength);
    }
    case 'mcp-app': {
      const chartCfg = node.data.chartConfig as Record<string, unknown> | undefined;
      if (chartCfg) {
        const chartTitle = (chartCfg.title as string) || 'Untitled chart';
        const chartType = (chartCfg.type as string) || 'unknown';
        const labels = Array.isArray(chartCfg.labels)
          ? (chartCfg.labels as string[]).join(', ')
          : '';
        return truncateContextText(`Chart: ${chartTitle} (${chartType}). Labels: ${labels}`, defaultTextLength);
      }
      return summarizeMcpAppData(node.data, defaultTextLength);
    }
    case 'webpage':
      return summarizeWebpageData(node.data, webpageTextLength);
    case 'json-render':
    case 'graph': {
      const graphCfg = node.data.graphConfig as Record<string, unknown> | undefined;
      if (graphCfg) return truncateContextText(`Graph: ${JSON.stringify(graphCfg)}`, defaultTextLength);
      return stringifyContextValue(node.data.spec ?? {}, defaultTextLength);
    }
    case 'prompt':
    case 'response': {
      const text = (node.data.text as string) || (node.data.content as string) || '';
      return truncateContextText(text, defaultTextLength);
    }
    case 'file': {
      const path = typeof node.data.path === 'string' ? node.data.path : '';
      const fileContent = typeof node.data.fileContent === 'string'
        ? node.data.fileContent
        : typeof node.data.content === 'string'
          ? node.data.content
          : '';
      const prefix = path ? `Path: ${path}\n\n` : '';
      const remaining = Math.max(0, defaultTextLength - prefix.length);
      return `${prefix}${truncateContextText(fileContent, remaining)}`.trim();
    }
    default:
      return stringifyContextValue(node.data, defaultTextLength);
  }
}

export function serializeNodeForAgentContext(
  node: CanvasNodeState,
  options: AgentContextOptions = {},
): AgentContextNode {
  const metadata = metadataForNode(node);
  return {
    id: node.id,
    type: node.type,
    title: typeof node.data.title === 'string' ? node.data.title : null,
    content: summarizeNodeForAgentContext(node, options) || null,
    ...(metadata ? { metadata } : {}),
    ...(options.includePosition ? { position: node.position } : {}),
  };
}

export function buildAgentContextPreamble(
  nodes: CanvasNodeState[],
  options: AgentContextOptions = {},
): string {
  const sections = nodes
    .map((node) => {
      const title = (typeof node.data.title === 'string' && node.data.title) ? node.data.title : node.id;
      const content = summarizeNodeForAgentContext(node, options);
      if (!content) return '';
      return `[Context from "${title}" (${node.type})]\n${content}\n`;
    })
    .filter((section) => section.length > 0);

  return sections.length > 0 ? `${sections.join('\n')}\n` : '';
}
