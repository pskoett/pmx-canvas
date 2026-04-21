import type { ExternalMcpTransportConfig } from './mcp-app-runtime.js';

export const EXCALIDRAW_MCP_URL = 'https://mcp.excalidraw.com/mcp';
export const EXCALIDRAW_SERVER_NAME = 'Excalidraw';
export const EXCALIDRAW_CREATE_VIEW_TOOL = 'create_view';

export const EXCALIDRAW_MCP_TRANSPORT: ExternalMcpTransportConfig = {
  type: 'http',
  url: EXCALIDRAW_MCP_URL,
};

export interface DiagramPresetOpenInput {
  elements: unknown;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface ExcalidrawOpenMcpAppInput {
  transport: ExternalMcpTransportConfig;
  toolName: string;
  serverName: string;
  toolArguments: { elements: string };
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export function normalizeExcalidrawElements(elements: unknown): string {
  if (typeof elements === 'string') {
    const trimmed = elements.trim();
    if (!trimmed) {
      throw new Error('diagram.elements must be a non-empty JSON array string or an array of Excalidraw elements.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`diagram.elements string is not valid JSON: ${reason}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error('diagram.elements string must encode a JSON array.');
    }
    return JSON.stringify(parsed);
  }
  if (Array.isArray(elements)) {
    return JSON.stringify(elements);
  }
  throw new Error('diagram.elements must be a JSON array string or an array of Excalidraw elements.');
}

export function buildExcalidrawOpenMcpAppInput(input: DiagramPresetOpenInput): ExcalidrawOpenMcpAppInput {
  const elements = normalizeExcalidrawElements(input.elements);
  const out: ExcalidrawOpenMcpAppInput = {
    transport: EXCALIDRAW_MCP_TRANSPORT,
    toolName: EXCALIDRAW_CREATE_VIEW_TOOL,
    serverName: EXCALIDRAW_SERVER_NAME,
    toolArguments: { elements },
  };
  if (typeof input.title === 'string' && input.title.trim().length > 0) out.title = input.title.trim();
  if (typeof input.x === 'number' && Number.isFinite(input.x)) out.x = input.x;
  if (typeof input.y === 'number' && Number.isFinite(input.y)) out.y = input.y;
  if (typeof input.width === 'number' && Number.isFinite(input.width)) out.width = input.width;
  if (typeof input.height === 'number' && Number.isFinite(input.height)) out.height = input.height;
  return out;
}
