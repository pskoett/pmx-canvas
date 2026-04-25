import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ExternalMcpTransportConfig } from './mcp-app-runtime.js';

export const EXCALIDRAW_MCP_URL = 'https://mcp.excalidraw.com/mcp';
export const EXCALIDRAW_SERVER_NAME = 'Excalidraw';
export const EXCALIDRAW_CREATE_VIEW_TOOL = 'create_view';
export const EXCALIDRAW_SAVE_CHECKPOINT_TOOL = 'save_checkpoint';
export const EXCALIDRAW_READ_CHECKPOINT_TOOL = 'read_checkpoint';
const EXCALIDRAW_CAMERA_PADDING = 80;
const EXCALIDRAW_MIN_CAMERA_WIDTH = 320;
const EXCALIDRAW_MIN_CAMERA_HEIGHT = 240;
const EXCALIDRAW_CAMERA_ASPECT_RATIO = 4 / 3;
const EXCALIDRAW_CAMERA_SIZES = [
  { width: 400, height: 300 },
  { width: 600, height: 450 },
  { width: 800, height: 600 },
  { width: 1200, height: 900 },
  { width: 1600, height: 1200 },
];

export const DEFAULT_EXCALIDRAW_ELEMENTS: ReadonlyArray<Record<string, unknown>> = [
  {
    type: 'rectangle',
    id: 'pmx-start',
    x: 80,
    y: 80,
    width: 280,
    height: 120,
    roundness: { type: 3 },
    backgroundColor: '#a5d8ff',
    fillStyle: 'solid',
    label: {
      text: 'PMX Canvas',
      fontSize: 24,
    },
  },
];

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseExcalidrawElements(elements: unknown): Array<Record<string, unknown>> {
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
    return parsed.filter(isRecord);
  }

  if (Array.isArray(elements)) {
    return elements.filter(isRecord);
  }

  throw new Error('diagram.elements must be a JSON array string or an array of Excalidraw elements.');
}

function parseExcalidrawCheckpointElements(data: unknown): Array<Record<string, unknown>> | null {
  let parsed: unknown = data;
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data);
    } catch {
      return null;
    }
  }

  if (Array.isArray(parsed)) return parsed.filter(isRecord);
  if (isRecord(parsed) && Array.isArray(parsed.elements)) return parsed.elements.filter(isRecord);
  return null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function elementHasCameraUpdate(elements: Array<Record<string, unknown>>): boolean {
  return elements.some((element) => element.type === 'cameraUpdate');
}

function resolveExcalidrawCameraSize(width: number, height: number): { width: number; height: number } {
  const requiredWidth = Math.max(EXCALIDRAW_MIN_CAMERA_WIDTH, width);
  const requiredHeight = Math.max(EXCALIDRAW_MIN_CAMERA_HEIGHT, height);
  const standard = EXCALIDRAW_CAMERA_SIZES.find(
    (size) => size.width >= requiredWidth && size.height >= requiredHeight,
  );
  if (standard) return standard;

  const heightFromWidth = requiredWidth / EXCALIDRAW_CAMERA_ASPECT_RATIO;
  const widthFromHeight = requiredHeight * EXCALIDRAW_CAMERA_ASPECT_RATIO;
  const cameraWidth = Math.ceil(Math.max(requiredWidth, widthFromHeight));
  return {
    width: cameraWidth,
    height: Math.ceil(cameraWidth / EXCALIDRAW_CAMERA_ASPECT_RATIO),
  };
}

export function inferExcalidrawCameraUpdate(
  elements: Array<Record<string, unknown>>,
): Record<string, unknown> | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const includePoint = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const element of elements) {
    if (element.isDeleted === true || element.type === 'cameraUpdate' || element.type === 'restoreCheckpoint' || element.type === 'delete') {
      continue;
    }

    const x = finiteNumber(element.x);
    const y = finiteNumber(element.y);
    if (x === null || y === null) continue;

    includePoint(x, y);
    const width = finiteNumber(element.width) ?? 0;
    const height = finiteNumber(element.height) ?? 0;
    includePoint(x + width, y + height);

    if (Array.isArray(element.points)) {
      for (const point of element.points) {
        if (!Array.isArray(point)) continue;
        const pointX = finiteNumber(point[0]);
        const pointY = finiteNumber(point[1]);
        if (pointX === null || pointY === null) continue;
        includePoint(x + pointX, y + pointY);
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const padding = Math.max(
    EXCALIDRAW_CAMERA_PADDING,
    Math.round(Math.max(contentWidth, contentHeight) * 0.18),
  );
  const camera = resolveExcalidrawCameraSize(contentWidth + padding * 2, contentHeight + padding * 2);
  const centerX = minX + contentWidth / 2;
  const centerY = minY + contentHeight / 2;

  return {
    type: 'cameraUpdate',
    x: Math.round(centerX - camera.width / 2),
    y: Math.round(centerY - camera.height / 2),
    width: camera.width,
    height: camera.height,
  };
}

function withInferredCameraUpdate(
  elements: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (elementHasCameraUpdate(elements)) return elements;
  const camera = inferExcalidrawCameraUpdate(elements);
  return camera ? [camera, ...elements] : elements;
}

export function normalizeExcalidrawElements(elements: unknown): string {
  const parsed = parseExcalidrawElements(elements);
  return JSON.stringify(parsed.length > 0 ? parsed : DEFAULT_EXCALIDRAW_ELEMENTS);
}

export function normalizeExcalidrawElementsForToolInput(elements: unknown): string {
  const parsed = parseExcalidrawElements(elements);
  const seeded = parsed.length > 0 ? parsed : [...DEFAULT_EXCALIDRAW_ELEMENTS];
  return JSON.stringify(withInferredCameraUpdate(seeded));
}

export function normalizeExcalidrawCheckpointDataForToolInput(data: unknown): string | null {
  const elements = parseExcalidrawCheckpointElements(data);

  return elements ? JSON.stringify(withInferredCameraUpdate(elements)) : null;
}

export function buildExcalidrawRestoreCheckpointToolInput(checkpointId: string, data?: unknown): string {
  const elements = parseExcalidrawCheckpointElements(data);
  const camera = elements ? inferExcalidrawCameraUpdate(elements) : null;
  return JSON.stringify([
    { type: 'restoreCheckpoint', id: checkpointId },
    ...(camera ? [camera] : []),
  ]);
}

export function isExcalidrawCreateView(serverName: unknown, toolName: unknown): boolean {
  return serverName === EXCALIDRAW_SERVER_NAME && toolName === EXCALIDRAW_CREATE_VIEW_TOOL;
}

export function buildExcalidrawCheckpointId(seed: string): string {
  const safe = seed.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96);
  return `pmx-${safe || 'checkpoint'}`;
}

export function getExcalidrawCheckpointIdFromToolResult(result: unknown): string | null {
  if (!isRecord(result) || !isRecord(result.structuredContent)) return null;
  const checkpointId = result.structuredContent.checkpointId;
  return typeof checkpointId === 'string' && checkpointId.trim().length > 0 ? checkpointId.trim() : null;
}

export function withExcalidrawCheckpointId(
  result: CallToolResult,
  checkpointId: string,
): CallToolResult {
  const structuredContent = isRecord(result.structuredContent) ? result.structuredContent : {};
  return {
    ...result,
    structuredContent: {
      ...structuredContent,
      checkpointId,
    },
  };
}

export function ensureExcalidrawCheckpointId(
  result: CallToolResult,
  seed: string,
  checkpointId?: string | null,
): CallToolResult {
  return withExcalidrawCheckpointId(
    result,
    checkpointId ?? getExcalidrawCheckpointIdFromToolResult(result) ?? buildExcalidrawCheckpointId(seed),
  );
}

export function buildExcalidrawOpenMcpAppInput(input: DiagramPresetOpenInput): ExcalidrawOpenMcpAppInput {
  const elements = normalizeExcalidrawElementsForToolInput(input.elements);
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
