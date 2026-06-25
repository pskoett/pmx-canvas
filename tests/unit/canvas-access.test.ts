import { describe, expect, test } from 'bun:test';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { looksLikeIncidentalCwd, shouldAttachToExistingDaemon } from '../../src/mcp/canvas-access.ts';

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
