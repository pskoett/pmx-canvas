import type { CanvasLayout, CanvasNodeState } from './canvas-state.js';
import type { AgentContextNode } from './agent-context.js';

export type PmxAxSource = 'agent' | 'api' | 'browser' | 'cli' | 'codex' | 'copilot' | 'mcp' | 'sdk' | 'system';

export interface PmxAxFocusState {
  nodeIds: string[];
  primaryNodeId: string | null;
  updatedAt: string | null;
  source: PmxAxSource | null;
}

export interface PmxAxState {
  version: 1;
  focus: PmxAxFocusState;
}

export interface PmxAxPinnedContext {
  preamble: string;
  nodeIds: string[];
  count: number;
  nodes: AgentContextNode[];
}

export interface PmxAxFocusContext extends PmxAxFocusState {
  nodes: AgentContextNode[];
}

export interface PmxAxContext {
  version: 1;
  generatedAt: string;
  surface: {
    nodeCount: number;
    edgeCount: number;
  };
  pinned: PmxAxPinnedContext;
  focus: PmxAxFocusContext;
}

const AX_SOURCES = new Set<PmxAxSource>(['agent', 'api', 'browser', 'cli', 'codex', 'copilot', 'mcp', 'sdk', 'system']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSource(value: unknown): PmxAxSource | null {
  return typeof value === 'string' && AX_SOURCES.has(value as PmxAxSource)
    ? value as PmxAxSource
    : null;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeNodeIds(value: unknown, validNodeIds?: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    if (validNodeIds && !validNodeIds.has(item)) continue;
    if (!ids.includes(item)) ids.push(item);
  }
  return ids;
}

export function createEmptyAxFocusState(): PmxAxFocusState {
  return {
    nodeIds: [],
    primaryNodeId: null,
    updatedAt: null,
    source: null,
  };
}

export function createEmptyAxState(): PmxAxState {
  return {
    version: 1,
    focus: createEmptyAxFocusState(),
  };
}

export function normalizeAxFocusState(input: unknown, validNodeIds?: Set<string>): PmxAxFocusState {
  if (!isRecord(input)) return createEmptyAxFocusState();
  const nodeIds = normalizeNodeIds(input.nodeIds, validNodeIds);
  const primaryNodeId = typeof input.primaryNodeId === 'string' && nodeIds.includes(input.primaryNodeId)
    ? input.primaryNodeId
    : nodeIds[0] ?? null;
  return {
    nodeIds,
    primaryNodeId,
    updatedAt: normalizeTimestamp(input.updatedAt),
    source: normalizeSource(input.source),
  };
}

export function normalizeAxState(input: unknown, validNodeIds?: Set<string>): PmxAxState {
  if (!isRecord(input)) return createEmptyAxState();
  return {
    version: 1,
    focus: normalizeAxFocusState(input.focus, validNodeIds),
  };
}

export function buildAxContext(input: {
  layout: CanvasLayout;
  pinned: PmxAxPinnedContext;
  focus: PmxAxFocusState;
  focusNodes: AgentContextNode[];
}): PmxAxContext {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    surface: {
      nodeCount: input.layout.nodes.length,
      edgeCount: input.layout.edges.length,
    },
    pinned: input.pinned,
    focus: {
      ...input.focus,
      nodes: input.focusNodes,
    },
  };
}

export function nodeSetFromLayout(nodes: CanvasNodeState[]): Set<string> {
  return new Set(nodes.map((node) => node.id));
}
