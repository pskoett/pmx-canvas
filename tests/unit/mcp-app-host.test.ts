/**
 * Unit tests for the MCP app host session registry (plan-009 H7 remainder).
 *
 * The module keeps its registry in MODULE-LEVEL state that is lazily loaded
 * once per process and persisted to a file under the user's home directory
 * (`~/.pmx-canvas/workbench/mcp-app-host-state.json` unless
 * `PMX_MCP_APP_HOST_STATE_FILE` overrides it). Because `bun test` runs every
 * unit file in one shared process, exercising that state in-process would both
 * inherit whatever earlier suites did to the singleton and write into the
 * developer's real config dir. So every stateful scenario runs in a spawned
 * `bun` driver subprocess with a temp HOME and a temp state file — full
 * isolation per scenario, and load-time behavior (the interesting half of this
 * module) becomes directly testable. Only `isTrustedMcpAppDomain`, which
 * touches no module state, is tested in-process.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isTrustedMcpAppDomain } from '../../src/server/mcp-app-host.ts';

const MODULE_PATH = resolve(import.meta.dir, '../../src/server/mcp-app-host.ts');

interface DriverContext {
  root: string;
  stateFile: string;
}

interface DriverRun {
  out: Record<string, unknown>;
  stderr: string;
}

/** Shape of the persisted state file (subset the tests assert on). */
interface PersistedFileState {
  activeSessionId: string | null;
  sessions: Array<{ sessionId: string; state: string; url: string }>;
  capabilities: Array<{ serverName: string; state: string; reasonCode: string }>;
  metrics?: { hostedOpens?: number; fallbackTotal?: number; fallbackByReason?: Record<string, number> };
}

const tempRoots: string[] = [];

function createDriverContext(): DriverContext {
  const root = mkdtempSync(join(tmpdir(), 'pmx-mcp-app-host-'));
  tempRoots.push(root);
  mkdirSync(join(root, 'home'), { recursive: true });
  return { root, stateFile: join(root, 'host-state.json') };
}

function runDriver(ctx: DriverContext, name: string, body: string, extraEnv: Record<string, string> = {}): DriverRun {
  const driverPath = join(ctx.root, `${name}.ts`);
  writeFileSync(
    driverPath,
    [
      `import * as host from ${JSON.stringify(MODULE_PATH)};`,
      'const out: Record<string, unknown> = {};',
      body,
      'console.log(JSON.stringify(out));',
      '',
    ].join('\n'),
    'utf-8',
  );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  // The module reads these lazily at call time — scrub inherited values so
  // drivers are hermetic, then pin HOME + the state file into the temp root.
  delete env.PMX_MCP_APP_HOST_MODE;
  delete env.PMX_MCP_APP_HOST_ALLOWLIST;
  delete env.PMX_SESSION_LOG;
  delete env.PMX_TEST_LOG;
  env.HOME = join(ctx.root, 'home');
  env.USERPROFILE = join(ctx.root, 'home');
  env.PMX_MCP_APP_HOST_STATE_FILE = ctx.stateFile;
  Object.assign(env, extraEnv);

  const result = spawnSync(process.execPath, [driverPath], { env, encoding: 'utf-8', timeout: 30_000 });
  if (result.status !== 0) {
    throw new Error(`driver ${name} exited ${String(result.status)}: ${result.stderr}\n${result.stdout}`);
  }
  // tryParseUrl logs invalid URLs via console.debug (stdout) — the driver's
  // JSON payload is always the last non-empty line.
  const lines = result.stdout.split('\n').filter((line) => line.trim().length > 0);
  return { out: JSON.parse(lines[lines.length - 1]) as Record<string, unknown>, stderr: result.stderr };
}

function readStateFile(ctx: DriverContext): PersistedFileState {
  return JSON.parse(readFileSync(ctx.stateFile, 'utf-8')) as PersistedFileState;
}

afterAll(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('isTrustedMcpAppDomain (pure, no module state)', () => {
  test('built-in trusted domains and their subdomains', () => {
    expect(isTrustedMcpAppDomain('https://excalidraw.com/board')).toBe(true);
    expect(isTrustedMcpAppDomain('https://link.excalidraw.com/ro/x')).toBe(true);
    expect(isTrustedMcpAppDomain('https://modelcontextprotocol.io/x')).toBe(true);
    expect(isTrustedMcpAppDomain('https://apps.modelcontextprotocol.io/x')).toBe(true);
  });

  test('vercel hosts must contain mcp and end with .vercel.app', () => {
    expect(isTrustedMcpAppDomain('https://my-mcp-app.vercel.app/x')).toBe(true);
    expect(isTrustedMcpAppDomain('https://randommcpthing.vercel.app/x')).toBe(true);
    expect(isTrustedMcpAppDomain('https://innocent.vercel.app/x')).toBe(false);
    expect(isTrustedMcpAppDomain('https://mcp-app.evil.dev/x')).toBe(false);
  });

  test('suffix spoofing and unparseable URLs are rejected', () => {
    expect(isTrustedMcpAppDomain('https://evilexcalidraw.com/x')).toBe(false);
    expect(isTrustedMcpAppDomain('https://excalidraw.com.evil.com/x')).toBe(false);
    expect(isTrustedMcpAppDomain('not a url')).toBe(false);
    expect(isTrustedMcpAppDomain('')).toBe(false);
  });

  test('PMX_MCP_APP_HOST_ALLOWLIST extends trust (exact host or subdomain, case-insensitive)', () => {
    const original = process.env.PMX_MCP_APP_HOST_ALLOWLIST;
    try {
      process.env.PMX_MCP_APP_HOST_ALLOWLIST = 'apps.internal, Foo.Example.COM';
      expect(isTrustedMcpAppDomain('https://apps.internal/x')).toBe(true);
      expect(isTrustedMcpAppDomain('https://tool.apps.internal/x')).toBe(true);
      expect(isTrustedMcpAppDomain('https://foo.example.com/x')).toBe(true);
      expect(isTrustedMcpAppDomain('https://other.internal/x')).toBe(false);
    } finally {
      if (original === undefined) delete process.env.PMX_MCP_APP_HOST_ALLOWLIST;
      else process.env.PMX_MCP_APP_HOST_ALLOWLIST = original;
    }
  });
});

const LIFECYCLE_BODY = `
const snap0 = host.getMcpAppHostSnapshot();
out.initial_sessions = snap0.sessions.length;
out.initial_active = snap0.activeSessionId;
out.initial_runtimeEnabled = snap0.runtimeEnabled;
out.initial_hostedOpens = snap0.metrics.hostedOpens;
out.initial_fallbackTotal = snap0.metrics.fallbackTotal;

const missing = host.routeMcpAppCandidateToHost({ sourceServer: null, sourceTool: 'excalidraw_open', url: 'https://link.excalidraw.com/ro/x1', inferredType: 'diagram', keyHint: 'resource_link' });
out.missing_mode = missing.mode;
out.missing_reason = missing.reasonCode;
out.missing_capServer = missing.capability.serverName;
out.missing_sessionIsNull = missing.session === null;
out.missing_capStored = host.getMcpAppHostSnapshot().capabilities.some((c) => c.serverName === 'unknown');

const unverified = host.routeMcpAppCandidateToHost({ sourceServer: 'plain-server', sourceTool: 'fetch-data', url: 'https://link.excalidraw.com/ro/x2', inferredType: 'text', keyHint: 'content' });
out.unverified_mode = unverified.mode;
out.unverified_reason = unverified.reasonCode;
out.unverified_capState = unverified.capability.state;

const untrusted = host.routeMcpAppCandidateToHost({ sourceServer: 'my-mcp-server', sourceTool: 'open_board', url: 'https://untrusted.example.com/board', inferredType: 'mcp-app', keyHint: 'resource_link' });
out.untrusted_mode = untrusted.mode;
out.untrusted_reason = untrusted.reasonCode;
out.untrusted_trusted = untrusted.trustedDomain;

const invalid = host.routeMcpAppCandidateToHost({ sourceServer: 'my-mcp-server', sourceTool: 'open_board', url: 'not a url at all', inferredType: 'mcp-app', keyHint: 'resource_link' });
out.invalid_mode = invalid.mode;
out.invalid_reason = invalid.reasonCode;

const docsHost = host.routeMcpAppCandidateToHost({ sourceServer: 'mcp-docs', sourceTool: 'open_board', url: 'https://modelcontextprotocol.io/apps', inferredType: 'mcp-app', keyHint: 'resource_link' });
out.docsHost_mode = docsHost.mode;
out.docsHost_reason = docsHost.reasonCode;
out.docsHost_trusted = docsHost.trustedDomain;

const docsPath = host.routeMcpAppCandidateToHost({ sourceServer: 'excalidraw', sourceTool: 'excalidraw_open', url: 'https://excalidraw.com/docs/getting-started', inferredType: 'diagram', keyHint: 'resource_link' });
out.docsPath_reason = docsPath.reasonCode;

const mdFile = host.routeMcpAppCandidateToHost({ sourceServer: 'excalidraw', sourceTool: 'excalidraw_open', url: 'https://excalidraw.com/readme.md', inferredType: 'diagram', keyHint: 'resource_link' });
out.mdFile_reason = mdFile.reasonCode;

const reg = host.registerMcpAppHostCapability({ serverName: '  padded-server  ', state: 'supported', reasonCode: '   ', runtimeReady: true, serverSupportsHost: true });
out.reg_serverName = reg.serverName;
out.reg_reason = reg.reasonCode;

const a = host.routeMcpAppCandidateToHost({ sourceServer: 'excalidraw', sourceTool: 'excalidraw_create', url: 'https://link.excalidraw.com/ro/abc123', inferredType: 'diagram', keyHint: 'resource_link' });
out.a_mode = a.mode;
out.a_reason = a.reasonCode;
out.a_capState = a.capability.state;
out.a_sessionState = a.session ? a.session.state : null;
const aId = a.session ? a.session.sessionId : '';
out.a_isActive = host.getMcpAppHostSnapshot().activeSessionId === aId;

const aRepeat = host.routeMcpAppCandidateToHost({ sourceServer: 'excalidraw', sourceTool: 'excalidraw_create', url: 'https://link.excalidraw.com/ro/abc123', inferredType: 'diagram', keyHint: 'resource_link' });
out.repeat_sameSession = (aRepeat.session ? aRepeat.session.sessionId : '') === aId;
out.repeat_openCount = host.listMcpAppHostSessions().length;

const b = host.routeMcpAppCandidateToHost({ sourceServer: 'excalidraw', sourceTool: 'excalidraw_create', url: 'https://link.excalidraw.com/ro/def456', inferredType: 'diagram', keyHint: 'resource_link' });
const bId = b.session ? b.session.sessionId : '';
out.b_newSession = bId !== aId;
const afterB = host.getMcpAppHostSnapshot();
out.b_active = afterB.activeSessionId === bId;
out.b_aState = (afterB.sessions.find((s) => s.sessionId === aId) || { state: 'missing' }).state;
out.b_sortedHead = afterB.sessions[0] ? afterB.sessions[0].sessionId === bId : false;

const focused = host.focusMcpAppHostSession(aId);
out.focus_state = focused ? focused.state : null;
const afterFocus = host.getMcpAppHostSnapshot();
out.focus_active = afterFocus.activeSessionId === aId;
out.focus_bState = (afterFocus.sessions.find((s) => s.sessionId === bId) || { state: 'missing' }).state;

const closed = host.closeMcpAppHostSession(aId);
out.close_state = closed ? closed.state : null;
const afterClose = host.getMcpAppHostSnapshot();
out.close_promoted = afterClose.activeSessionId === bId;
out.close_bState = (afterClose.sessions.find((s) => s.sessionId === bId) || { state: 'missing' }).state;

const external = host.markMcpAppHostSessionOpenedExternally(bId);
out.external_marked = external ? external.lastExternalOpenAt !== null : null;
const externalClosed = host.markMcpAppHostSessionOpenedExternally(aId);
out.external_onClosed = externalClosed ? externalClosed.state : null;

out.list_default = host.listMcpAppHostSessions().map((s) => s.sessionId);
out.list_all = host.listMcpAppHostSessions({ includeClosed: true }).map((s) => s.sessionId).sort();
out.list_expected = [aId, bId].sort();
out.bId = bId;

out.null_focusClosed = host.focusMcpAppHostSession(aId) === null;
out.null_closeClosed = host.closeMcpAppHostSession(aId) === null;
out.null_focusBlank = host.focusMcpAppHostSession('   ') === null;
out.null_focusUnknown = host.focusMcpAppHostSession('app-does-not-exist') === null;
out.null_markUnknown = host.markMcpAppHostSessionOpenedExternally('app-does-not-exist') === null;

const mutable = host.getMcpAppHostSnapshot();
mutable.sessions[0].state = 'closed';
mutable.metrics.fallbackByReason['injected'] = 99;
const reread = host.getMcpAppHostSnapshot();
out.immutable_sessionState = (reread.sessions.find((s) => s.sessionId === bId) || { state: 'missing' }).state;
out.immutable_metricsClean = reread.metrics.fallbackByReason['injected'] === undefined;

process.env.PMX_MCP_APP_HOST_ALLOWLIST = 'apps.internal';
const allow = host.routeMcpAppCandidateToHost({ sourceServer: 'internal-tools-mcp', sourceTool: 'open_dashboard', url: 'https://board.apps.internal/x', inferredType: 'app-surface', keyHint: 'resourceUrl' });
out.allow_mode = allow.mode;
delete process.env.PMX_MCP_APP_HOST_ALLOWLIST;

const vercel = host.routeMcpAppCandidateToHost({ sourceServer: 'demo-server-mcp', sourceTool: 'open_app', url: 'https://demo-mcp-app.vercel.app/surface', inferredType: 'mcp-app', keyHint: 'resource_link' });
out.vercel_mode = vercel.mode;
out.vercel_sessionId = vercel.session ? vercel.session.sessionId : null;

const final = host.getMcpAppHostSnapshot();
out.final_hostedOpens = final.metrics.hostedOpens;
out.final_fallbackTotal = final.metrics.fallbackTotal;
out.final_fallbackByReason = final.metrics.fallbackByReason;
`;

describe('routing + session lifecycle (isolated driver process)', () => {
  let ctx: DriverContext;
  let run: DriverRun;

  beforeAll(() => {
    ctx = createDriverContext();
    run = runDriver(ctx, 'lifecycle', LIFECYCLE_BODY);
  });

  test('a fresh process starts empty with the runtime enabled', () => {
    expect(run.out.initial_sessions).toBe(0);
    expect(run.out.initial_active).toBeNull();
    expect(run.out.initial_runtimeEnabled).toBe(true);
    expect(run.out.initial_hostedOpens).toBe(0);
    expect(run.out.initial_fallbackTotal).toBe(0);
  });

  test('the degrade ladder names each fallback reason', () => {
    // No server name → synthetic 'unknown' capability that is NOT stored.
    expect(run.out.missing_mode).toBe('fallback');
    expect(run.out.missing_reason).toBe('missing_server_name');
    expect(run.out.missing_capServer).toBe('unknown');
    expect(run.out.missing_sessionIsNull).toBe(true);
    expect(run.out.missing_capStored).toBe(false);
    // No app-suggesting hints → capability_unverified.
    expect(run.out.unverified_mode).toBe('fallback');
    expect(run.out.unverified_reason).toBe('capability_unverified');
    expect(run.out.unverified_capState).toBe('degraded');
    // Untrusted domain, and an unparseable URL degrades the same way.
    expect(run.out.untrusted_reason).toBe('untrusted_domain');
    expect(run.out.untrusted_trusted).toBe(false);
    expect(run.out.invalid_mode).toBe('fallback');
    expect(run.out.invalid_reason).toBe('untrusted_domain');
    // Trusted but non-embeddable surfaces: the modelcontextprotocol.io family,
    // /docs paths, and document file extensions all stay out of the host.
    expect(run.out.docsHost_trusted).toBe(true);
    expect(run.out.docsHost_reason).toBe('not_embeddable_surface');
    expect(run.out.docsPath_reason).toBe('not_embeddable_surface');
    expect(run.out.mdFile_reason).toBe('not_embeddable_surface');
    // registerMcpAppHostCapability normalizes name + blank reason codes.
    expect(run.out.reg_serverName).toBe('padded-server');
    expect(run.out.reg_reason).toBe('unknown');
  });

  test('hosted routing activates a session, dedupes on url+server+tool, and honors allowlist/vercel trust', () => {
    expect(run.out.a_mode).toBe('hosted');
    expect(run.out.a_reason).toBe('supported');
    expect(run.out.a_capState).toBe('supported');
    expect(run.out.a_sessionState).toBe('active');
    expect(run.out.a_isActive).toBe(true);
    // Re-routing the identical candidate reuses the session.
    expect(run.out.repeat_sameSession).toBe(true);
    expect(run.out.repeat_openCount).toBe(1);
    // A different URL is a new session, which takes over as active.
    expect(run.out.b_newSession).toBe(true);
    expect(run.out.b_active).toBe(true);
    expect(run.out.b_aState).toBe('background');
    expect(run.out.b_sortedHead).toBe(true); // active sorts first
    expect(run.out.allow_mode).toBe('hosted');
    expect(run.out.vercel_mode).toBe('hosted');
  });

  test('focus/close/external lifecycle: focus backgrounds the rest, close promotes the next open session', () => {
    expect(run.out.focus_state).toBe('active');
    expect(run.out.focus_active).toBe(true);
    expect(run.out.focus_bState).toBe('background');
    expect(run.out.close_state).toBe('closed');
    expect(run.out.close_promoted).toBe(true);
    expect(run.out.close_bState).toBe('active');
    expect(run.out.external_marked).toBe(true);
    // Current behavior: marking a CLOSED session as opened externally still
    // succeeds (no closed-state guard) — the fallback flow uses this.
    expect(run.out.external_onClosed).toBe('closed');
    // Listing excludes closed sessions unless asked.
    expect(run.out.list_default).toEqual([run.out.bId]);
    expect(run.out.list_all).toEqual(run.out.list_expected);
    // Closed/blank/unknown ids are nulls, not throws.
    expect(run.out.null_focusClosed).toBe(true);
    expect(run.out.null_closeClosed).toBe(true);
    expect(run.out.null_focusBlank).toBe(true);
    expect(run.out.null_focusUnknown).toBe(true);
    expect(run.out.null_markUnknown).toBe(true);
  });

  test('snapshots are detached copies and metrics count opens + fallbacks by reason', () => {
    expect(run.out.immutable_sessionState).toBe('active');
    expect(run.out.immutable_metricsClean).toBe(true);
    expect(run.out.final_hostedOpens).toBe(5); // a, a-repeat, b, allowlist, vercel
    expect(run.out.final_fallbackTotal).toBe(7);
    expect(run.out.final_fallbackByReason).toEqual({
      missing_server_name: 1,
      capability_unverified: 1,
      untrusted_domain: 2,
      not_embeddable_surface: 3,
    });
  });

  test('the state file persists sessions, capabilities, and metrics', () => {
    const persisted = readStateFile(ctx);
    expect(persisted.sessions).toHaveLength(4); // closed A + B + allowlist + vercel
    expect(persisted.sessions.filter((s) => s.state === 'closed')).toHaveLength(1);
    expect(persisted.activeSessionId).toBe(run.out.vercel_sessionId as string);
    const capNames = persisted.capabilities.map((c) => c.serverName);
    expect(capNames).toContain('excalidraw');
    expect(capNames).toContain('padded-server');
    expect(capNames).not.toContain('unknown');
    expect(persisted.metrics?.hostedOpens).toBe(5);
    expect(persisted.metrics?.fallbackTotal).toBe(7);
  });
});

const RESTART_PHASE_A_BODY = `
host.registerMcpAppHostCapability({ serverName: 'custom-srv', state: 'supported', reasonCode: 'adapter_verified', runtimeReady: true, serverSupportsHost: true });
const r = host.routeMcpAppCandidateToHost({ sourceServer: 'excalidraw', sourceTool: 'excalidraw_create', url: 'https://link.excalidraw.com/ro/persist1', inferredType: 'diagram', keyHint: 'resource_link' });
out.mode = r.mode;
out.sessionId = r.session ? r.session.sessionId : null;
`;

const RESTART_PHASE_B_BODY = `
const snap = host.getMcpAppHostSnapshot();
out.sessions = snap.sessions.length;
out.active = snap.activeSessionId;
out.hostedOpens = snap.metrics.hostedOpens;
out.fallbackTotal = snap.metrics.fallbackTotal;
out.capNames = snap.capabilities.map((c) => c.serverName).sort();
out.customState = (snap.capabilities.find((c) => c.serverName === 'custom-srv') || { state: 'missing' }).state;
`;

describe('persistence across restarts', () => {
  test('sessions and metrics are runtime-scoped (cleared on the next boot); capabilities persist', () => {
    const ctx = createDriverContext();
    const phaseA = runDriver(ctx, 'restart-phase-a', RESTART_PHASE_A_BODY);
    expect(phaseA.out.mode).toBe('hosted');

    // Phase A persisted a live session + metrics + capabilities.
    const afterA = readStateFile(ctx);
    expect(afterA.sessions).toHaveLength(1);
    expect(afterA.sessions[0].state).toBe('active');
    expect(afterA.activeSessionId).toBe(phaseA.out.sessionId as string);
    expect(afterA.metrics?.hostedOpens).toBe(1);
    expect(afterA.capabilities.map((c) => c.serverName).sort()).toEqual(['custom-srv', 'excalidraw']);

    // A new process loads capabilities but wipes runtime state (sessions,
    // active pointer, metrics) — sessions never survive a restart.
    const phaseB = runDriver(ctx, 'restart-phase-b', RESTART_PHASE_B_BODY);
    expect(phaseB.out.sessions).toBe(0);
    expect(phaseB.out.active).toBeNull();
    expect(phaseB.out.hostedOpens).toBe(0);
    expect(phaseB.out.fallbackTotal).toBe(0);
    expect(phaseB.out.capNames).toEqual(['custom-srv', 'excalidraw']);
    expect(phaseB.out.customState).toBe('supported');

    // The wipe is persisted back immediately on load.
    const afterB = readStateFile(ctx);
    expect(afterB.sessions).toHaveLength(0);
    expect(afterB.activeSessionId).toBeNull();
  }, 20_000);
});

const LOAD_NORMALIZATION_BODY = `
const snap = host.getMcpAppHostSnapshot();
out.capNames = snap.capabilities.map((c) => c.serverName).sort();
const spacey = snap.capabilities.find((c) => c.serverName === 'spacey');
out.spacey_state = spacey ? spacey.state : null;
out.spacey_reason = spacey ? spacey.reasonCode : null;
out.spacey_runtimeReady = spacey ? spacey.runtimeReady : null;
out.spacey_updatedAtSet = spacey ? spacey.updatedAt.length > 0 : null;
const good = snap.capabilities.find((c) => c.serverName === 'good');
out.good_updatedAt = good ? good.updatedAt : null;
out.sessions = snap.sessions.length;
out.active = snap.activeSessionId;
out.hostedOpens = snap.metrics.hostedOpens;
out.fallbackTotal = snap.metrics.fallbackTotal;
out.fallbackReasons = Object.keys(snap.metrics.fallbackByReason);
`;

const CORRUPT_FILE_BODY = `
const snap = host.getMcpAppHostSnapshot();
out.sessions = snap.sessions.length;
out.caps = snap.capabilities.length;
const r = host.routeMcpAppCandidateToHost({ sourceServer: 'excalidraw', sourceTool: 'excalidraw_create', url: 'https://link.excalidraw.com/ro/recover', inferredType: 'diagram', keyHint: 'resource_link' });
out.recovered_mode = r.mode;
`;

describe('persisted-state loading', () => {
  test('malformed persisted entries are normalized or skipped; runtime state is wiped regardless', () => {
    const ctx = createDriverContext();
    writeFileSync(
      ctx.stateFile,
      JSON.stringify({
        activeSessionId: 'app-dangling',
        nextSessionId: 'garbage',
        capabilities: [
          // Normalized: trimmed name, bogus state → degraded, blank reason → unknown,
          // non-boolean runtimeReady → false, blank updatedAt → refreshed.
          {
            serverName: '  spacey  ',
            state: 'weird-state',
            reasonCode: '',
            runtimeReady: 'yes',
            serverSupportsHost: true,
            updatedAt: '',
          },
          { reasonCode: 'no-name' }, // skipped: no serverName
          null, // skipped: not an object
          {
            serverName: 'good',
            state: 'supported',
            reasonCode: 'ok',
            runtimeReady: true,
            serverSupportsHost: true,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        sessions: [
          {
            sessionId: 'app-legacy',
            sourceServer: 'excalidraw',
            sourceTool: 'excalidraw_create',
            url: 'https://link.excalidraw.com/ro/legacy',
            inferredType: 'diagram',
            trustedDomain: true,
            state: 'active',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastSeenAt: '2026-01-01T00:00:00.000Z',
            fallbackReason: null,
            lastExternalOpenAt: null,
          },
        ],
        metrics: { hostedOpens: 7, fallbackTotal: 'nope', fallbackByReason: { '  ': 3, stale: '2.9' } },
      }),
      'utf-8',
    );

    const run = runDriver(ctx, 'load-normalization', LOAD_NORMALIZATION_BODY);
    expect(run.out.capNames).toEqual(['good', 'spacey']);
    expect(run.out.spacey_state).toBe('degraded');
    expect(run.out.spacey_reason).toBe('unknown');
    expect(run.out.spacey_runtimeReady).toBe(false);
    expect(run.out.spacey_updatedAtSet).toBe(true);
    expect(run.out.good_updatedAt).toBe('2026-01-01T00:00:00.000Z');
    // Sessions/metrics are runtime state: wiped on load even when persisted.
    expect(run.out.sessions).toBe(0);
    expect(run.out.active).toBeNull();
    expect(run.out.hostedOpens).toBe(0);
    expect(run.out.fallbackTotal).toBe(0);
    expect(run.out.fallbackReasons).toEqual([]);
    expect(readStateFile(ctx).sessions).toHaveLength(0);
  }, 20_000);

  test('an unreadable state file warns, starts empty, and keeps the module functional', () => {
    const ctx = createDriverContext();
    writeFileSync(ctx.stateFile, '{{{ not json', 'utf-8');
    const run = runDriver(ctx, 'corrupt-file', CORRUPT_FILE_BODY);
    expect(run.stderr).toContain('load persisted state failed');
    expect(run.out.sessions).toBe(0);
    expect(run.out.caps).toBe(0);
    expect(run.out.recovered_mode).toBe('hosted');
  }, 20_000);
});

const RUNTIME_MODE_BODY = `
host.preRegisterKnownMcpAppHostCapabilities(['excalidraw', 'custom-unknown']);
const snap1 = host.getMcpAppHostSnapshot();
const pre = snap1.capabilities.find((c) => c.serverName === 'excalidraw');
out.pre_state = pre ? pre.state : null;
out.pre_reason = pre ? pre.reasonCode : null;
out.pre_customAbsent = !snap1.capabilities.some((c) => c.serverName === 'custom-unknown');
out.runtime_default = snap1.runtimeEnabled;

process.env.PMX_MCP_APP_HOST_MODE = 'off';
out.runtime_off = host.getMcpAppHostSnapshot().runtimeEnabled;

host.preRegisterKnownMcpAppHostCapabilities(['excalidraw']);
const kept = host.getMcpAppHostSnapshot().capabilities.find((c) => c.serverName === 'excalidraw');
out.skip_reason = kept ? kept.reasonCode : null;

host.preRegisterKnownMcpAppHostCapabilities(['json-render']);
const jr = host.getMcpAppHostSnapshot().capabilities.find((c) => c.serverName === 'json-render');
out.jr_state = jr ? jr.state : null;
out.jr_reason = jr ? jr.reasonCode : null;
out.jr_runtimeReady = jr ? jr.runtimeReady : null;

const r = host.routeMcpAppCandidateToHost({ sourceServer: 'excalidraw-live', sourceTool: 'excalidraw_create', url: 'https://link.excalidraw.com/ro/disabled', inferredType: 'diagram', keyHint: 'resource_link' });
out.disabled_mode = r.mode;
out.disabled_reason = r.reasonCode;

const variants = {};
for (const value of ['0', 'false', 'FALSE', 'disabled', 'on', '1', '']) {
  process.env.PMX_MCP_APP_HOST_MODE = value;
  variants[value === '' ? 'empty' : value] = host.getMcpAppHostSnapshot().runtimeEnabled;
}
out.mode_variants = variants;
`;

describe('runtime mode + capability pre-registration', () => {
  test('PMX_MCP_APP_HOST_MODE gates routing; preRegister covers known servers and never downgrades supported ones', () => {
    const ctx = createDriverContext();
    const run = runDriver(ctx, 'runtime-mode', RUNTIME_MODE_BODY);
    // Known servers pre-register as supported while the runtime is enabled;
    // unknown names are ignored.
    expect(run.out.pre_state).toBe('supported');
    expect(run.out.pre_reason).toBe('startup_preregistered');
    expect(run.out.pre_customAbsent).toBe(true);
    expect(run.out.runtime_default).toBe(true);
    expect(run.out.runtime_off).toBe(false);
    // Re-pre-registering with the runtime disabled skips an already-supported
    // capability instead of downgrading it…
    expect(run.out.skip_reason).toBe('startup_preregistered');
    // …but a fresh known server registers degraded with the disable reason.
    expect(run.out.jr_state).toBe('degraded');
    expect(run.out.jr_reason).toBe('runtime_disabled');
    expect(run.out.jr_runtimeReady).toBe(false);
    // Routing while disabled falls back even for a fully-trusted candidate.
    expect(run.out.disabled_mode).toBe('fallback');
    expect(run.out.disabled_reason).toBe('runtime_disabled');
    // Only 0/false/off/disabled (case-insensitive) disable; anything else enables.
    expect(run.out.mode_variants).toEqual({
      '0': false,
      false: false,
      FALSE: false,
      disabled: false,
      on: true,
      '1': true,
      empty: true,
    });
  }, 20_000);
});

const SESSION_BOUNDS_BODY = `
for (let i = 0; i < 28; i++) {
  host.routeMcpAppCandidateToHost({ sourceServer: 'excalidraw', sourceTool: 'excalidraw_create', url: 'https://link.excalidraw.com/ro/bulk-' + i, inferredType: 'diagram', keyHint: 'resource_link' });
}
const snap1 = host.getMcpAppHostSnapshot();
out.open_after_28 = snap1.sessions.filter((s) => s.state !== 'closed').length;
out.hostedOpens_after_28 = snap1.metrics.hostedOpens;
out.active_after_28 = snap1.activeSessionId !== null;

for (const s of host.listMcpAppHostSessions()) host.closeMcpAppHostSession(s.sessionId);
for (let j = 0; j < 16; j++) {
  const r = host.routeMcpAppCandidateToHost({ sourceServer: 'excalidraw', sourceTool: 'excalidraw_create', url: 'https://link.excalidraw.com/ro/extra-' + j, inferredType: 'diagram', keyHint: 'resource_link' });
  if (r.session) host.closeMcpAppHostSession(r.session.sessionId);
}
const snap2 = host.getMcpAppHostSnapshot();
out.closed_final = snap2.sessions.filter((s) => s.state === 'closed').length;
out.open_final = snap2.sessions.filter((s) => s.state !== 'closed').length;
out.active_final = snap2.activeSessionId;
`;

describe('session history bounds', () => {
  test('open sessions cap at 24 and closed history at 32; metrics keep counting past the trim', () => {
    const ctx = createDriverContext();
    const run = runDriver(ctx, 'session-bounds', SESSION_BOUNDS_BODY);
    expect(run.out.open_after_28).toBe(24); // MAX_ACTIVE_AND_BACKGROUND_SESSIONS
    expect(run.out.hostedOpens_after_28).toBe(28); // trim does not rewrite metrics
    expect(run.out.active_after_28).toBe(true);
    expect(run.out.closed_final).toBe(32); // MAX_CLOSED_SESSIONS
    expect(run.out.open_final).toBe(0);
    expect(run.out.active_final).toBeNull();
  }, 20_000);
});
