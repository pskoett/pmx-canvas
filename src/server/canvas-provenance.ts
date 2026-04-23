import { pathToFileURL } from 'node:url';

export type CanvasNodeType =
  | 'markdown'
  | 'mcp-app'
  | 'webpage'
  | 'json-render'
  | 'graph'
  | 'prompt'
  | 'response'
  | 'status'
  | 'context'
  | 'ledger'
  | 'trace'
  | 'file'
  | 'image'
  | 'group';

export type CanvasNodeProvenanceSourceKind =
  | 'workspace-file'
  | 'webpage-url'
  | 'mcp-tool'
  | 'artifact-file'
  | 'image-url';

export type CanvasNodeRefreshStrategy =
  | 'file-watch'
  | 'file-read-write'
  | 'image-reload'
  | 'webpage-refresh'
  | 'mcp-app-rehydrate'
  | 'artifact-reopen';

export interface CanvasNodeProvenance {
  sourceKind: CanvasNodeProvenanceSourceKind;
  sourceUri: string;
  refreshStrategy: CanvasNodeRefreshStrategy;
  snapshotContent: boolean;
  syncedAt?: string;
  details?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function toFileUri(path: string): string {
  try {
    return pathToFileURL(path).toString();
  } catch {
    return `file://${path}`;
  }
}

function buildMcpToolUri(serverName: string, toolName: string): string {
  return `mcp-tool://${encodeURIComponent(serverName)}/${encodeURIComponent(toolName)}`;
}

function normalizeExistingProvenance(value: unknown): CanvasNodeProvenance | null {
  if (!isRecord(value)) return null;

  const sourceKind = pickString(value.sourceKind);
  const sourceUri = pickString(value.sourceUri);
  const refreshStrategy = pickString(value.refreshStrategy);
  if (!sourceKind || !sourceUri || !refreshStrategy) return null;

  const normalized: CanvasNodeProvenance = {
    sourceKind: sourceKind as CanvasNodeProvenanceSourceKind,
    sourceUri,
    refreshStrategy: refreshStrategy as CanvasNodeRefreshStrategy,
    snapshotContent: value.snapshotContent !== false,
  };

  const syncedAt = pickString(value.syncedAt);
  if (syncedAt) normalized.syncedAt = syncedAt;
  if (isRecord(value.details) && Object.keys(value.details).length > 0) {
    normalized.details = { ...value.details };
  }

  return normalized;
}

function mergeProvenance(
  existing: CanvasNodeProvenance | null,
  inferred: CanvasNodeProvenance | null,
): CanvasNodeProvenance | null {
  if (!inferred) return existing;
  if (!existing) return inferred;

  const mergedDetails = {
    ...(existing.details ?? {}),
    ...(inferred.details ?? {}),
  };

  return {
    ...existing,
    ...inferred,
    ...(Object.keys(mergedDetails).length > 0 ? { details: mergedDetails } : {}),
  };
}

function inferFileProvenance(
  nodeType: 'markdown' | 'file',
  data: Record<string, unknown>,
): CanvasNodeProvenance | null {
  const path = pickString(data.path);
  if (!path) return null;

  const syncedAt = pickString(data.updatedAt) ?? pickString(data.savedAt);
  return {
    sourceKind: 'workspace-file',
    sourceUri: toFileUri(path),
    refreshStrategy: nodeType === 'file' ? 'file-watch' : 'file-read-write',
    snapshotContent: true,
    ...(syncedAt ? { syncedAt } : {}),
    details: {
      path,
      nodeType,
    },
  };
}

function inferImageProvenance(data: Record<string, unknown>): CanvasNodeProvenance | null {
  const path = pickString(data.path);
  if (path) {
    return {
      sourceKind: 'workspace-file',
      sourceUri: toFileUri(path),
      refreshStrategy: 'image-reload',
      snapshotContent: true,
      details: { path, nodeType: 'image' },
    };
  }

  const src = pickString(data.src);
  if (!src || !/^https?:\/\//i.test(src)) return null;
  return {
    sourceKind: 'image-url',
    sourceUri: src,
    refreshStrategy: 'image-reload',
    snapshotContent: true,
    details: { url: src, nodeType: 'image' },
  };
}

function inferWebpageProvenance(data: Record<string, unknown>): CanvasNodeProvenance | null {
  const url = pickString(data.url);
  if (!url) return null;

  const details: Record<string, unknown> = { url, nodeType: 'webpage' };
  const pageTitle = pickString(data.pageTitle);
  if (pageTitle) details.pageTitle = pageTitle;

  const syncedAt = pickString(data.fetchedAt);
  return {
    sourceKind: 'webpage-url',
    sourceUri: url,
    refreshStrategy: 'webpage-refresh',
    snapshotContent: true,
    ...(syncedAt ? { syncedAt } : {}),
    details,
  };
}

function inferMcpAppProvenance(data: Record<string, unknown>): CanvasNodeProvenance | null {
  const path = pickString(data.path);
  const url = pickString(data.url);
  if (path && url?.startsWith('/artifact?')) {
    return {
      sourceKind: 'artifact-file',
      sourceUri: toFileUri(path),
      refreshStrategy: 'artifact-reopen',
      snapshotContent: true,
      details: {
        path,
        url,
        nodeType: 'mcp-app',
      },
    };
  }

  const serverName = pickString(data.serverName) ?? pickString(data.sourceServer);
  const toolName = pickString(data.toolName) ?? pickString(data.sourceTool);
  if (!serverName && !toolName) return null;

  const normalizedServer = serverName ?? 'unknown-server';
  const normalizedTool = toolName ?? 'unknown-tool';
  const details: Record<string, unknown> = {
    serverName: normalizedServer,
    toolName: normalizedTool,
    nodeType: 'mcp-app',
  };

  const resourceUri = pickString(data.resourceUri);
  if (resourceUri) details.resourceUri = resourceUri;
  const transportType = isRecord(data.transportConfig) ? pickString(data.transportConfig.type) : null;
  if (transportType) details.transportType = transportType;
  if (isRecord(data.toolInput)) details.toolInput = data.toolInput;

  return {
    sourceKind: 'mcp-tool',
    sourceUri: buildMcpToolUri(normalizedServer, normalizedTool),
    refreshStrategy: 'mcp-app-rehydrate',
    snapshotContent: true,
    details,
  };
}

export function inferCanvasNodeProvenance(
  nodeType: CanvasNodeType,
  data: Record<string, unknown>,
): CanvasNodeProvenance | null {
  if (nodeType === 'file' || nodeType === 'markdown') {
    return inferFileProvenance(nodeType, data);
  }
  if (nodeType === 'image') return inferImageProvenance(data);
  if (nodeType === 'webpage') return inferWebpageProvenance(data);
  if (nodeType === 'mcp-app') return inferMcpAppProvenance(data);
  return null;
}

export function normalizeCanvasNodeData<T extends Record<string, unknown>>(
  nodeType: CanvasNodeType,
  data: T,
): T {
  const existing = normalizeExistingProvenance(data.provenance);
  const inferred = inferCanvasNodeProvenance(nodeType, data);
  const provenance = mergeProvenance(existing, inferred);

  if (provenance) {
    return { ...data, provenance } as T;
  }
  if ('provenance' in data) {
    const nextData = { ...data };
    delete nextData.provenance;
    return nextData as T;
  }
  return data;
}
