import { describe, expect, test } from 'bun:test';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCanvasAccess,
  looksLikeIncidentalCwd,
  refreshCanvasAccess,
  shouldAttachToExistingDaemon,
} from '../../src/mcp/canvas-access.ts';

// Finding I (0.2.6): when the preferred port is held by a healthy daemon serving a
// DIFFERENT workspace, the MCP server should ATTACH to it (so writes are visible in
// the open panel) instead of silently splitting to a hidden fallback-port daemon
// bound to its own (often incidental) launch cwd.
describe('shouldAttachToExistingDaemon (Finding I — wrong-workspace split guard)', () => {
  test('attaches to a healthy different-workspace daemon by default', () => {
    expect(shouldAttachToExistingDaemon({ ok: true, workspace: '/Users/pepe/dev/personalclaude' }, false)).toBe(true);
  });

  test('does NOT attach when the workspace split is opted in (PMX_CANVAS_ALLOW_WORKSPACE_SPLIT=1)', () => {
    expect(shouldAttachToExistingDaemon({ ok: true, workspace: '/Users/pepe/dev/personalclaude' }, true)).toBe(false);
  });

  test('does NOT attach to a free port / non-canvas occupant (no health)', () => {
    expect(shouldAttachToExistingDaemon(null, false)).toBe(false);
    expect(shouldAttachToExistingDaemon({ ok: false }, false)).toBe(false);
  });

  test('does NOT attach when the daemon reports no usable workspace', () => {
    expect(shouldAttachToExistingDaemon({ ok: true }, false)).toBe(false);
    expect(shouldAttachToExistingDaemon({ ok: true, workspace: '' }, false)).toBe(false);
    expect(shouldAttachToExistingDaemon({ ok: true, workspace: 42 }, false)).toBe(false);
  });
});

// Finding I first-binder gap: a host launches `--mcp` from an incidental config dir
// (e.g. ~/.copilot) on a FREE preferred port → it would adopt that cwd as a workspace
// the project panel never renders. The guard flags exactly those incidental cwds.
describe('looksLikeIncidentalCwd (Finding I — first-binder guard)', () => {
  test('flags the home dir and dot-prefixed direct children of home', () => {
    expect(looksLikeIncidentalCwd(homedir())).toBe(true);
    expect(looksLikeIncidentalCwd(join(homedir(), '.copilot'))).toBe(true);
    expect(looksLikeIncidentalCwd(join(homedir(), '.codex'))).toBe(true);
    expect(looksLikeIncidentalCwd(join(homedir(), '.claude'))).toBe(true);
    expect(looksLikeIncidentalCwd(join(homedir(), '.config'))).toBe(true);
  });

  test('does NOT flag a real project root', () => {
    expect(looksLikeIncidentalCwd('/Users/pepe/dev/pmx-canvas')).toBe(false);
    expect(looksLikeIncidentalCwd(process.cwd())).toBe(false);
  });

  test('does NOT flag a mkdtemp temp dir (the MCP/SDK test harness shape) — the critical no-misflag guarantee', () => {
    // createTestWorkspace uses mkdtempSync under os.tmpdir() (e.g. /var/folders/.../pmx-canvas-mcp-XXXX),
    // never under home — so the whole test suite keeps the byte-identical first-binder path.
    expect(looksLikeIncidentalCwd(join(tmpdir(), 'pmx-canvas-mcp-abc123'))).toBe(false);
    expect(looksLikeIncidentalCwd(join(tmpdir(), 'pmx-canvas-sdk-fallback-xyz'))).toBe(false);
  });

  test('does NOT flag a non-dot direct child of home (a normal folder)', () => {
    expect(looksLikeIncidentalCwd(join(homedir(), 'Documents'))).toBe(false);
    expect(looksLikeIncidentalCwd(join(homedir(), 'dev', 'project'))).toBe(false);
  });
});

describe('refreshCanvasAccess (attached daemon lifecycle)', () => {
  test('re-acquires when the attached daemon exits instead of targeting its dead URL forever', async () => {
    const workspace = process.cwd();
    const health = () => Response.json({ ok: true, workspace });
    const first = Bun.serve({ port: 0, fetch: health });
    const second = Bun.serve({ port: 0, fetch: health });
    const saved = {
      url: process.env.PMX_CANVAS_URL,
      port: process.env.PMX_CANVAS_PORT,
      root: process.env.PMX_CANVAS_WORKSPACE_ROOT,
    };
    // A port nothing listens on, so only PMX_CANVAS_URL can match.
    const idle = Bun.serve({ port: 0, fetch: () => new Response('') });
    process.env.PMX_CANVAS_PORT = String(idle.port);
    idle.stop(true);
    delete process.env.PMX_CANVAS_WORKSPACE_ROOT;
    try {
      process.env.PMX_CANVAS_URL = `http://127.0.0.1:${first.port}`;
      const attached = await createCanvasAccess();
      expect(attached.remoteBaseUrl).toBe(`http://127.0.0.1:${first.port}`);
      expect(await refreshCanvasAccess(attached)).toBe(attached);

      first.stop(true);
      process.env.PMX_CANVAS_URL = `http://127.0.0.1:${second.port}`;
      expect((await refreshCanvasAccess(attached)).remoteBaseUrl).toBe(`http://127.0.0.1:${second.port}`);
    } finally {
      first.stop(true);
      second.stop(true);
      for (const [key, value] of [
        ['PMX_CANVAS_URL', saved.url],
        ['PMX_CANVAS_PORT', saved.port],
        ['PMX_CANVAS_WORKSPACE_ROOT', saved.root],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
