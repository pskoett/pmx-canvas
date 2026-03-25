import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export type McpAppHostCapabilityState = 'supported' | 'unsupported' | 'degraded';

export interface McpAppHostCapability {
  serverName: string;
  state: McpAppHostCapabilityState;
  reasonCode: string;
  runtimeReady: boolean;
  serverSupportsHost: boolean;
  updatedAt: string;
}

export type McpAppHostSessionState = 'active' | 'background' | 'closed';

export interface McpAppHostSession {
  sessionId: string;
  sourceServer: string | null;
  sourceTool: string;
  url: string;
  inferredType: string;
  trustedDomain: boolean;
  state: McpAppHostSessionState;
  createdAt: string;
  lastSeenAt: string;
  fallbackReason: string | null;
  lastExternalOpenAt: string | null;
}

export interface McpAppHostSnapshot {
  runtimeEnabled: boolean;
  activeSessionId: string | null;
  sessions: McpAppHostSession[];
  capabilities: McpAppHostCapability[];
  metrics: {
    hostedOpens: number;
    fallbackTotal: number;
    fallbackByReason: Record<string, number>;
  };
}

export interface McpAppCandidateInput {
  sourceServer: string | null;
  sourceTool: string;
  url: string;
  inferredType: string;
  keyHint: string;
}

export interface McpAppHostRoutingResult {
  mode: 'hosted' | 'fallback';
  reasonCode: string;
  trustedDomain: boolean;
  capability: McpAppHostCapability;
  session: McpAppHostSession | null;
}

// Use a local config directory instead of PMX_CONFIG_DIR
const PMX_CANVAS_CONFIG_DIR = join(homedir(), '.pmx-canvas');

function ensureConfigDir(): void {
  if (!existsSync(PMX_CANVAS_CONFIG_DIR)) {
    mkdirSync(PMX_CANVAS_CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

const DEFAULT_MCP_APP_HOST_STATE_FILE = join(
  PMX_CANVAS_CONFIG_DIR,
  'workbench',
  'mcp-app-host-state.json',
);

function sessionDiagLogPath(): string {
  return String(process.env.PMX_SESSION_LOG || process.env.PMX_TEST_LOG || '').trim();
}

function sessionDiagLog(tag: string, payload: Record<string, unknown>): void {
  const logPath = sessionDiagLogPath();
  if (!logPath) return;
  try {
    appendFileSync(
      logPath,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        scope: 'mcp-app-host',
        tag,
        ...payload,
      })}\n`,
      'utf-8',
    );
  } catch {
    // Ignore optional diagnostics logging failures.
  }
}

function mcpAppHostStateFilePath(): string {
  const override = String(process.env.PMX_MCP_APP_HOST_STATE_FILE || '').trim();
  return override.length > 0 ? override : DEFAULT_MCP_APP_HOST_STATE_FILE;
}
const MAX_ACTIVE_AND_BACKGROUND_SESSIONS = 24;
const MAX_CLOSED_SESSIONS = 32;

const capabilities = new Map<string, McpAppHostCapability>();
const sessions = new Map<string, McpAppHostSession>();
let activeSessionId: string | null = null;
let nextSessionId = 1;
let stateLoaded = false;
const metrics = {
  hostedOpens: 0,
  fallbackTotal: 0,
  fallbackByReason: {} as Record<string, number>,
};

interface PersistedHostState {
  activeSessionId: string | null;
  nextSessionId: number;
  capabilities: McpAppHostCapability[];
  sessions: McpAppHostSession[];
  metrics?: {
    hostedOpens?: number;
    fallbackTotal?: number;
    fallbackByReason?: Record<string, number>;
  };
}

function normalizeServerName(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function resetRuntimeMetrics(): void {
  metrics.hostedOpens = 0;
  metrics.fallbackTotal = 0;
  for (const key of Object.keys(metrics.fallbackByReason)) {
    delete metrics.fallbackByReason[key];
  }
}

function clearPersistedRuntimeSessionsOnLoad(): void {
  const hadSessions = sessions.size;
  const hadMetrics =
    metrics.hostedOpens > 0 ||
    metrics.fallbackTotal > 0 ||
    Object.keys(metrics.fallbackByReason).length > 0;
  if (hadSessions === 0 && !activeSessionId && !hadMetrics) return;

  sessions.clear();
  activeSessionId = null;
  nextSessionId = 1;
  resetRuntimeMetrics();
  sessionDiagLog('reset-persisted-runtime-state', {
    clearedSessions: hadSessions,
    clearedMetrics: hadMetrics,
  });
  persistState();
}

function ensureStateLoaded(): void {
  if (stateLoaded) return;
  stateLoaded = true;

  try {
    const stateFile = mcpAppHostStateFilePath();
    if (!existsSync(stateFile)) {
      return;
    }
    const raw = readFileSync(stateFile, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedHostState;
    if (Array.isArray(parsed.capabilities)) {
      for (const entry of parsed.capabilities) {
        if (!entry || typeof entry !== 'object') continue;
        if (typeof entry.serverName !== 'string' || entry.serverName.trim().length === 0) continue;
        const normalized: McpAppHostCapability = {
          serverName: entry.serverName.trim(),
          state:
            entry.state === 'supported' ||
            entry.state === 'unsupported' ||
            entry.state === 'degraded'
              ? entry.state
              : 'degraded',
          reasonCode:
            typeof entry.reasonCode === 'string' && entry.reasonCode.trim().length > 0
              ? entry.reasonCode.trim()
              : 'unknown',
          runtimeReady: entry.runtimeReady === true,
          serverSupportsHost: entry.serverSupportsHost === true,
          updatedAt:
            typeof entry.updatedAt === 'string' && entry.updatedAt.trim().length > 0
              ? entry.updatedAt
              : nowIso(),
        };
        capabilities.set(normalized.serverName, normalized);
      }
    }

    if (Array.isArray(parsed.sessions)) {
      for (const entry of parsed.sessions) {
        if (!entry || typeof entry !== 'object') continue;
        if (typeof entry.sessionId !== 'string' || entry.sessionId.trim().length === 0) continue;
        if (typeof entry.url !== 'string' || entry.url.trim().length === 0) continue;
        const normalized: McpAppHostSession = {
          sessionId: entry.sessionId.trim(),
          sourceServer: normalizeServerName(entry.sourceServer),
          sourceTool:
            typeof entry.sourceTool === 'string' && entry.sourceTool.trim().length > 0
              ? entry.sourceTool.trim()
              : 'mcp-tool',
          url: entry.url.trim(),
          inferredType:
            typeof entry.inferredType === 'string' && entry.inferredType.trim().length > 0
              ? entry.inferredType.trim()
              : 'mcp-app',
          trustedDomain: entry.trustedDomain === true,
          state:
            entry.state === 'active' || entry.state === 'background' || entry.state === 'closed'
              ? entry.state
              : 'background',
          createdAt:
            typeof entry.createdAt === 'string' && entry.createdAt.trim().length > 0
              ? entry.createdAt
              : nowIso(),
          lastSeenAt:
            typeof entry.lastSeenAt === 'string' && entry.lastSeenAt.trim().length > 0
              ? entry.lastSeenAt
              : nowIso(),
          fallbackReason:
            typeof entry.fallbackReason === 'string' && entry.fallbackReason.trim().length > 0
              ? entry.fallbackReason
              : null,
          lastExternalOpenAt:
            typeof entry.lastExternalOpenAt === 'string' &&
            entry.lastExternalOpenAt.trim().length > 0
              ? entry.lastExternalOpenAt
              : null,
        };
        sessions.set(normalized.sessionId, normalized);
      }
    }

    activeSessionId = normalizeServerName(parsed.activeSessionId);
    if (activeSessionId && !sessions.has(activeSessionId)) {
      activeSessionId = null;
    }

    if (typeof parsed.nextSessionId === 'number' && Number.isFinite(parsed.nextSessionId)) {
      nextSessionId = Math.max(1, Math.floor(parsed.nextSessionId));
    }

    if (parsed.metrics && typeof parsed.metrics === 'object') {
      const loadedHostedOpens = Number(parsed.metrics.hostedOpens ?? 0);
      const loadedFallbackTotal = Number(parsed.metrics.fallbackTotal ?? 0);
      metrics.hostedOpens = Number.isFinite(loadedHostedOpens)
        ? Math.max(0, Math.floor(loadedHostedOpens))
        : 0;
      metrics.fallbackTotal = Number.isFinite(loadedFallbackTotal)
        ? Math.max(0, Math.floor(loadedFallbackTotal))
        : 0;
      if (parsed.metrics.fallbackByReason && typeof parsed.metrics.fallbackByReason === 'object') {
        for (const [reason, count] of Object.entries(parsed.metrics.fallbackByReason)) {
          const normalizedReason = reason.trim();
          if (!normalizedReason) continue;
          const numeric = Number(count);
          if (!Number.isFinite(numeric)) continue;
          metrics.fallbackByReason[normalizedReason] = Math.max(0, Math.floor(numeric));
        }
      }
    }

    trimSessionHistory();
    pruneNonEmbeddableHostedSessions();
    clearPersistedRuntimeSessionsOnLoad();
  } catch {
    // Best-effort state load; ignore malformed files.
  }
}

function ensurePersistDirectory(): void {
  ensureConfigDir();
  const dir = dirname(mcpAppHostStateFilePath());
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function persistState(): void {
  try {
    ensurePersistDirectory();
    const payload: PersistedHostState = {
      activeSessionId,
      nextSessionId,
      capabilities: [...capabilities.values()],
      sessions: [...sessions.values()],
      metrics: {
        hostedOpens: metrics.hostedOpens,
        fallbackTotal: metrics.fallbackTotal,
        fallbackByReason: { ...metrics.fallbackByReason },
      },
    };
    writeFileSync(mcpAppHostStateFilePath(), JSON.stringify(payload, null, 2), 'utf-8');
  } catch {
    // Ignore persistence failures; runtime behavior should continue.
  }
}

function hostAllowlistHosts(): string[] {
  const envValue = String(process.env.PMX_MCP_APP_HOST_ALLOWLIST || '').trim();
  if (!envValue) return [];
  return envValue
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isTrustedMcpAppDomain(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (host === 'modelcontextprotocol.io' || host.endsWith('.modelcontextprotocol.io')) {
      return true;
    }
    if (host === 'excalidraw.com' || host.endsWith('.excalidraw.com')) {
      return true;
    }
    if (host.includes('mcp-app') && host.endsWith('.vercel.app')) {
      return true;
    }
    if (host.includes('mcp') && host.endsWith('.vercel.app')) {
      return true;
    }

    const allowlist = hostAllowlistHosts();
    return allowlist.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

function isHostRuntimeEnabled(): boolean {
  const raw = String(process.env.PMX_MCP_APP_HOST_MODE || '')
    .trim()
    .toLowerCase();
  if (!raw) return true;
  return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'disabled');
}

function supportsHostSessionByHint(input: McpAppCandidateInput): boolean {
  const sourceServer = String(input.sourceServer || '').toLowerCase();
  const sourceTool = String(input.sourceTool || '').toLowerCase();
  const keyHint = String(input.keyHint || '').toLowerCase();
  const inferredType = String(input.inferredType || '').toLowerCase();

  const keySuggestsApps =
    /resource|resource_link|resourceurl|resource_url|app|uri|url|link|viewer|preview|canvas/.test(
      keyHint,
    );
  const sourceSuggestsApps =
    sourceServer.includes('mcp') ||
    sourceServer.includes('excalidraw') ||
    sourceTool.includes('mcp') ||
    sourceTool.includes('excalidraw') ||
    sourceTool.includes('app') ||
    sourceTool.includes('resource') ||
    sourceTool.includes('viewer');
  const typeSuggestsApps =
    inferredType === 'mcp-app' ||
    inferredType === 'diagram' ||
    inferredType === 'design' ||
    inferredType.endsWith('viewer') ||
    inferredType === 'app-surface';

  return keySuggestsApps || sourceSuggestsApps || typeSuggestsApps;
}

function isLikelyEmbeddableMcpAppSurface(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const href = parsed.toString().toLowerCase();

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    if (host === 'modelcontextprotocol.io' || host.endsWith('.modelcontextprotocol.io')) {
      return false;
    }

    if (/\.(?:md|txt|json|pdf|csv|yaml|yml)(?:$|[?#])/.test(href)) return false;
    if (path.includes('/docs/') || path.startsWith('/docs')) return false;
    if (path.includes('/blog/') || path.startsWith('/blog')) return false;

    if (host === 'excalidraw.com' || host.endsWith('.excalidraw.com')) return true;
    if (host.includes('mcp-app') && host.endsWith('.vercel.app')) return true;
    if (host.includes('mcp') && host.endsWith('.vercel.app')) return true;

    const allowlist = hostAllowlistHosts();
    if (allowlist.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return true;

    return false;
  } catch {
    return false;
  }
}

function nextHostSessionId(): string {
  const value = `app-${Date.now().toString(36)}-${nextSessionId.toString(36)}`;
  nextSessionId += 1;
  return value;
}

function sortedSessions(includeClosed = true): McpAppHostSession[] {
  const entries = [...sessions.values()];
  const filtered = includeClosed ? entries : entries.filter((entry) => entry.state !== 'closed');
  return filtered.sort((left, right) => {
    if (left.state === 'active' && right.state !== 'active') return -1;
    if (left.state !== 'active' && right.state === 'active') return 1;
    return right.lastSeenAt.localeCompare(left.lastSeenAt);
  });
}

function trimSessionHistory(): void {
  const activeAndBackground = sortedSessions(false);
  const closed = sortedSessions(true).filter((entry) => entry.state === 'closed');

  for (const entry of activeAndBackground.slice(MAX_ACTIVE_AND_BACKGROUND_SESSIONS)) {
    sessions.delete(entry.sessionId);
    if (activeSessionId === entry.sessionId) activeSessionId = null;
  }
  for (const entry of closed.slice(MAX_CLOSED_SESSIONS)) {
    sessions.delete(entry.sessionId);
    if (activeSessionId === entry.sessionId) activeSessionId = null;
  }
}

function pruneNonEmbeddableHostedSessions(): void {
  let changed = false;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.state === 'closed') continue;
    if (isLikelyEmbeddableMcpAppSurface(session.url)) continue;
    sessionDiagLog('prune-non-embeddable', {
      sessionId,
      sourceServer: session.sourceServer,
      sourceTool: session.sourceTool,
      inferredType: session.inferredType,
      url: session.url,
    });
    sessions.delete(sessionId);
    if (activeSessionId === sessionId) {
      activeSessionId = null;
    }
    changed = true;
  }

  if (!activeSessionId) {
    const next = sortedSessions(false).find((entry) => entry.state !== 'closed');
    if (next) {
      activateSession(next.sessionId);
      changed = true;
    }
  }

  if (changed) {
    trimSessionHistory();
    persistState();
  }
}

function upsertCapability(next: McpAppHostCapability): McpAppHostCapability {
  ensureStateLoaded();
  const normalized: McpAppHostCapability = {
    ...next,
    serverName: next.serverName.trim(),
    reasonCode: next.reasonCode.trim() || 'unknown',
    updatedAt: next.updatedAt || nowIso(),
  };
  capabilities.set(normalized.serverName, normalized);
  persistState();
  return normalized;
}

export function registerMcpAppHostCapability(input: {
  serverName: string;
  state: McpAppHostCapabilityState;
  reasonCode: string;
  runtimeReady: boolean;
  serverSupportsHost: boolean;
}): McpAppHostCapability {
  return upsertCapability({
    serverName: input.serverName,
    state: input.state,
    reasonCode: input.reasonCode,
    runtimeReady: input.runtimeReady,
    serverSupportsHost: input.serverSupportsHost,
    updatedAt: nowIso(),
  });
}

const KNOWN_MCP_APP_HOST_SERVERS: ReadonlySet<string> = new Set(['excalidraw', 'json-render']);

export function preRegisterKnownMcpAppHostCapabilities(serverNames: string[]): void {
  ensureStateLoaded();
  const runtimeReady = isHostRuntimeEnabled();
  for (const name of serverNames) {
    if (!KNOWN_MCP_APP_HOST_SERVERS.has(name)) continue;
    const existing = capabilities.get(name);
    if (existing?.state === 'supported') continue;
    upsertCapability({
      serverName: name,
      state: runtimeReady ? 'supported' : 'degraded',
      reasonCode: runtimeReady ? 'startup_preregistered' : 'runtime_disabled',
      runtimeReady,
      serverSupportsHost: true,
      updatedAt: nowIso(),
    });
    sessionDiagLog('preregister-capability', { serverName: name, runtimeReady });
  }
}

function resolveCapabilityForCandidate(
  input: McpAppCandidateInput,
  trustedDomain: boolean,
): McpAppHostCapability {
  const runtimeReady = isHostRuntimeEnabled();
  const serverName = normalizeServerName(input.sourceServer);
  const serverSupportsHost = supportsHostSessionByHint(input);
  const embeddableSurface = isLikelyEmbeddableMcpAppSurface(input.url);

  if (!serverName) {
    return {
      serverName: 'unknown',
      state: 'degraded',
      reasonCode: 'missing_server_name',
      runtimeReady,
      serverSupportsHost,
      updatedAt: nowIso(),
    };
  }

  if (!runtimeReady) {
    return upsertCapability({
      serverName,
      state: 'degraded',
      reasonCode: 'runtime_disabled',
      runtimeReady,
      serverSupportsHost,
      updatedAt: nowIso(),
    });
  }

  if (!serverSupportsHost) {
    return upsertCapability({
      serverName,
      state: 'degraded',
      reasonCode: 'capability_unverified',
      runtimeReady,
      serverSupportsHost,
      updatedAt: nowIso(),
    });
  }

  if (!trustedDomain) {
    return upsertCapability({
      serverName,
      state: 'degraded',
      reasonCode: 'untrusted_domain',
      runtimeReady,
      serverSupportsHost,
      updatedAt: nowIso(),
    });
  }

  if (!embeddableSurface) {
    return upsertCapability({
      serverName,
      state: 'degraded',
      reasonCode: 'not_embeddable_surface',
      runtimeReady,
      serverSupportsHost,
      updatedAt: nowIso(),
    });
  }

  return upsertCapability({
    serverName,
    state: 'supported',
    reasonCode: 'supported',
    runtimeReady,
    serverSupportsHost,
    updatedAt: nowIso(),
  });
}

function activateSession(sessionId: string): void {
  ensureStateLoaded();
  const target = sessions.get(sessionId);
  if (!target || target.state === 'closed') return;
  activeSessionId = sessionId;
  const seenAt = nowIso();
  for (const [key, session] of sessions.entries()) {
    if (session.state === 'closed') continue;
    if (key === sessionId) {
      sessions.set(key, {
        ...session,
        state: 'active',
        lastSeenAt: seenAt,
      });
      continue;
    }
    sessions.set(key, {
      ...session,
      state: 'background',
    });
  }
}

function findMatchingOpenSession(input: McpAppCandidateInput): McpAppHostSession | null {
  const sourceServer = normalizeServerName(input.sourceServer);
  for (const session of sessions.values()) {
    if (session.state === 'closed') continue;
    if (session.url !== input.url) continue;
    if (normalizeServerName(session.sourceServer) !== sourceServer) continue;
    if (session.sourceTool !== input.sourceTool.trim()) continue;
    return session;
  }
  return null;
}

function registerFallback(reasonCode: string): void {
  metrics.fallbackTotal += 1;
  const normalizedReason = reasonCode.trim() || 'fallback';
  metrics.fallbackByReason[normalizedReason] =
    (metrics.fallbackByReason[normalizedReason] ?? 0) + 1;
}

export function routeMcpAppCandidateToHost(input: McpAppCandidateInput): McpAppHostRoutingResult {
  ensureStateLoaded();

  const trustedDomain = isTrustedMcpAppDomain(input.url);
  const capability = resolveCapabilityForCandidate(input, trustedDomain);
  sessionDiagLog('route-candidate', {
    sourceServer: normalizeServerName(input.sourceServer),
    sourceTool: input.sourceTool.trim() || 'mcp-tool',
    inferredType: input.inferredType.trim() || 'mcp-app',
    keyHint: input.keyHint.trim() || 'unknown',
    url: input.url,
    trustedDomain,
    capabilityState: capability.state,
    capabilityReason: capability.reasonCode,
  });

  if (capability.state !== 'supported') {
    registerFallback(capability.reasonCode);
    persistState();
    sessionDiagLog('route-fallback', {
      sourceServer: normalizeServerName(input.sourceServer),
      sourceTool: input.sourceTool.trim() || 'mcp-tool',
      url: input.url,
      reasonCode: capability.reasonCode,
      trustedDomain,
    });
    return {
      mode: 'fallback',
      reasonCode: capability.reasonCode,
      trustedDomain,
      capability,
      session: null,
    };
  }

  const normalizedSourceServer = normalizeServerName(input.sourceServer);
  const sourceTool = input.sourceTool.trim() || 'mcp-tool';
  const existing = findMatchingOpenSession(input);
  let session: McpAppHostSession;
  if (existing) {
    session = {
      ...existing,
      inferredType: input.inferredType.trim() || existing.inferredType,
      trustedDomain,
      fallbackReason: null,
      lastSeenAt: nowIso(),
    };
    sessions.set(session.sessionId, session);
  } else {
    session = {
      sessionId: nextHostSessionId(),
      sourceServer: normalizedSourceServer,
      sourceTool,
      url: input.url,
      inferredType: input.inferredType.trim() || 'mcp-app',
      trustedDomain,
      state: 'background',
      createdAt: nowIso(),
      lastSeenAt: nowIso(),
      fallbackReason: null,
      lastExternalOpenAt: null,
    };
    sessions.set(session.sessionId, session);
  }

  activateSession(session.sessionId);
  metrics.hostedOpens += 1;
  trimSessionHistory();
  persistState();
  sessionDiagLog('route-hosted', {
    sessionId: session.sessionId,
    sourceServer: session.sourceServer,
    sourceTool: session.sourceTool,
    inferredType: session.inferredType,
    url: session.url,
  });

  return {
    mode: 'hosted',
    reasonCode: 'supported',
    trustedDomain,
    capability,
    session: sessions.get(session.sessionId) ?? session,
  };
}

export function focusMcpAppHostSession(sessionId: string): McpAppHostSession | null {
  ensureStateLoaded();
  const normalized = sessionId.trim();
  if (!normalized) return null;
  const session = sessions.get(normalized);
  if (!session || session.state === 'closed') return null;
  activateSession(normalized);
  persistState();
  sessionDiagLog('focus-session', { sessionId: normalized, found: true });
  return sessions.get(normalized) ?? null;
}

export function closeMcpAppHostSession(sessionId: string): McpAppHostSession | null {
  ensureStateLoaded();
  const normalized = sessionId.trim();
  if (!normalized) return null;
  const session = sessions.get(normalized);
  if (!session || session.state === 'closed') return null;
  sessions.set(normalized, {
    ...session,
    state: 'closed',
    lastSeenAt: nowIso(),
  });
  if (activeSessionId === normalized) {
    activeSessionId = null;
    const next = sortedSessions(false).find((entry) => entry.state !== 'closed');
    if (next) {
      activateSession(next.sessionId);
    }
  }
  trimSessionHistory();
  persistState();
  sessionDiagLog('close-session', { sessionId: normalized, found: true });
  return sessions.get(normalized) ?? null;
}

export function markMcpAppHostSessionOpenedExternally(sessionId: string): McpAppHostSession | null {
  ensureStateLoaded();
  const normalized = sessionId.trim();
  if (!normalized) return null;
  const session = sessions.get(normalized);
  if (!session) return null;
  sessions.set(normalized, {
    ...session,
    lastExternalOpenAt: nowIso(),
  });
  persistState();
  sessionDiagLog('open-external', { sessionId: normalized });
  return sessions.get(normalized) ?? null;
}

export function listMcpAppHostSessions(options?: { includeClosed?: boolean }): McpAppHostSession[] {
  ensureStateLoaded();
  const includeClosed = options?.includeClosed === true;
  return sortedSessions(includeClosed).map((entry) => ({ ...entry }));
}

export function getMcpAppHostSnapshot(): McpAppHostSnapshot {
  ensureStateLoaded();
  const runtimeEnabled = isHostRuntimeEnabled();
  const sessionList = sortedSessions(true).map((entry) => ({ ...entry }));
  const capabilityList = [...capabilities.values()]
    .map((entry) => ({ ...entry }))
    .sort((left, right) => left.serverName.localeCompare(right.serverName));

  return {
    runtimeEnabled,
    activeSessionId,
    sessions: sessionList,
    capabilities: capabilityList,
    metrics: {
      hostedOpens: metrics.hostedOpens,
      fallbackTotal: metrics.fallbackTotal,
      fallbackByReason: { ...metrics.fallbackByReason },
    },
  };
}
