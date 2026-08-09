import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { runAgentCli } from '../../src/cli/agent.ts';
import { extractGlobalTargetFlags, parseFlags } from '../../src/cli/shared.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

// A unified diff legitimately begins with `--- a/file`. The old parser treated
// any next token starting with `-` as the next flag, so `--content` was left
// valueless and the diff body was swallowed — agents had to fall back to raw
// HTTP PATCH to set conventional diff content.
const UNIFIED_DIFF = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b';

describe('agent CLI flag parsing', () => {
  test('a value flag consumes a value that begins with --- (unified diff)', () => {
    const { positional, flags } = parseFlags(['--type', 'diff', '--content', UNIFIED_DIFF]);
    expect(flags.type).toBe('diff');
    expect(flags.content).toBe(UNIFIED_DIFF);
    expect(positional).toEqual([]);
  });

  test('a value flag consumes a value that begins with a single dash', () => {
    const { positional, flags } = parseFlags(['--content', '-1 removed line', '--title', 'Patch']);
    expect(flags.content).toBe('-1 removed line');
    expect(flags.title).toBe('Patch');
    expect(positional).toEqual([]);
  });

  test('single-dash aliases also consume dash-leading values', () => {
    const { flags } = parseFlags(['-x', '-40', '-y', '260']);
    expect(flags.x).toBe('-40');
    expect(flags.y).toBe('260');
  });

  test('a bare -- ends flag parsing and makes the rest positional', () => {
    const { positional, flags } = parseFlags(['node', 'update', 'node-1', '--title', 'T', '--', '--foo', 'bar']);
    expect(flags.title).toBe('T');
    expect(flags.foo).toBeUndefined();
    expect(positional).toEqual(['node', 'update', 'node-1', '--foo', 'bar']);
  });

  test('--flag=value keeps working, including dash-leading values', () => {
    const { flags } = parseFlags(['--title=Patch', `--content=${UNIFIED_DIFF}`, '--width=640']);
    expect(flags.title).toBe('Patch');
    expect(flags.content).toBe(UNIFIED_DIFF);
    expect(flags.width).toBe('640');
  });

  test('boolean flags never consume the next token', () => {
    const { positional, flags } = parseFlags(['--full', '--stdin', '--title', 'Kept', '--yes']);
    expect(flags.full).toBe(true);
    expect(flags.stdin).toBe(true);
    expect(flags.yes).toBe(true);
    expect(flags.title).toBe('Kept');
    expect(positional).toEqual([]);
  });

  test('a trailing value flag with no token left stays boolean', () => {
    const { flags } = parseFlags(['--summary']);
    expect(flags.summary).toBe(true);
  });

  test('per-command boolFlags keep a dual-purpose flag from swallowing the next flag', () => {
    // `--summary` is a boolean filter in history/layout/node get/validate spec
    // but carries text in `node add`. Without the per-command override, the
    // value-flag rule (which exists so a `--- a/file` diff survives) would make
    // `history --summary --limit 5` read summary="--limit".
    const swallowed = parseFlags(['--summary', '--limit', '5']);
    expect(swallowed.flags.summary).toBe('--limit');

    const asBoolean = parseFlags(['--summary', '--limit', '5'], { boolFlags: ['summary'] });
    expect(asBoolean.flags.summary).toBe(true);
    expect(asBoolean.flags.limit).toBe('5');

    // The override never breaks the value form for commands that need text.
    expect(parseFlags(['--summary', 'a sidecar note']).flags.summary).toBe('a sidecar note');
  });

  test('global target extraction leaves everything after -- untouched', () => {
    // The separator itself survives extraction so parseFlags stops there too.
    expect(extractGlobalTargetFlags(['node', 'add', '--port', '4313', '--', '--port', '9'])).toEqual([
      'node',
      'add',
      '--',
      '--port',
      '9',
    ]);
    // Unchanged contract: global flags before the separator are still stripped.
    expect(extractGlobalTargetFlags(['node', 'list', '--port', '4313'])).toEqual(['node', 'list']);
  });
});

describe('agent CLI diff content round-trip', () => {
  let workspaceRoot = '';
  let baseUrl = '';
  let previousPort = '';
  let previousUrl = '';

  beforeAll(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-cli-flags-');
    resetCanvasForTests(workspaceRoot);
    const base = startCanvasServer({ workspaceRoot, port: 4549, autoOpenBrowser: false });
    if (!base) throw new Error('Failed to start canvas server for CLI flag-parsing tests.');
    baseUrl = base;

    previousPort = process.env.PMX_CANVAS_PORT ?? '';
    previousUrl = process.env.PMX_CANVAS_URL ?? '';
    process.env.PMX_CANVAS_URL = baseUrl;
    delete process.env.PMX_CANVAS_PORT;
  });

  afterAll(() => {
    if (previousUrl) process.env.PMX_CANVAS_URL = previousUrl;
    else delete process.env.PMX_CANVAS_URL;
    if (previousPort) process.env.PMX_CANVAS_PORT = previousPort;
    else delete process.env.PMX_CANVAS_PORT;
    stopCanvasServer();
    removeTestWorkspace(workspaceRoot);
  });

  beforeEach(() => {
    canvasState.withSuppressedRecording(() => {
      canvasState.clear();
    });
  });

  test('node add --type diff --content "--- a/x..." stores the diff verbatim', async () => {
    const log = mock((..._args: unknown[]) => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'add', '--type', 'diff', '--content', UNIFIED_DIFF]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as { ok: boolean; id: string };
    expect(output.ok).toBe(true);

    const response = await fetch(`${baseUrl}/api/canvas/node/${output.id}`);
    expect(response.ok).toBe(true);
    const stored = (await response.json()) as { type: string; data: { content?: string } };
    expect(stored.type).toBe('diff');
    expect(stored.data.content).toBe(UNIFIED_DIFF);
  });
});
