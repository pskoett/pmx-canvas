import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { runAgentCli } from '../../src/cli/agent.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import {
  createFakeWebArtifactScripts,
  createTestWorkspace,
  removeTestWorkspace,
  resetCanvasForTests,
} from './helpers.ts';

const fixtureMcpAppServerPath = fileURLToPath(new URL('../fixtures/mcp-app-fixture.ts', import.meta.url));

describe('agent CLI node commands', () => {
  let workspaceRoot = '';
  let baseUrl = '';
  let previousPort = '';
  let previousUrl = '';

  async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, init);
    expect(response.ok).toBe(true);
    return await response.json() as T;
  }

  beforeAll(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-cli-node-');
    resetCanvasForTests(workspaceRoot);
    createFakeWebArtifactScripts(workspaceRoot);
    const base = startCanvasServer({ workspaceRoot, port: 4542, autoOpenBrowser: false });
    if (!base) {
      throw new Error('Failed to start canvas server for CLI node tests.');
    }
    baseUrl = base;

    previousPort = process.env.PMX_CANVAS_PORT ?? '';
    previousUrl = process.env.PMX_CANVAS_URL ?? '';
    process.env.PMX_CANVAS_URL = baseUrl;
    delete process.env.PMX_CANVAS_PORT;
  });

  afterAll(() => {
    if (previousUrl) {
      process.env.PMX_CANVAS_URL = previousUrl;
    } else {
      delete process.env.PMX_CANVAS_URL;
    }
    if (previousPort) {
      process.env.PMX_CANVAS_PORT = previousPort;
    } else {
      delete process.env.PMX_CANVAS_PORT;
    }
    stopCanvasServer();
    removeTestWorkspace(workspaceRoot);
  });

  beforeEach(() => {
    canvasState.withSuppressedRecording(() => {
      canvasState.clear();
    });
    canvasState.clearAllSnapshots();
    mutationHistory.reset();
  });

  test('node update merges partial geometry flags with existing node state', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      id: string;
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Resize me',
        x: 80,
        y: 120,
        width: 360,
        height: 200,
      }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'update', created.id, '--width', '640', '--y', '240']);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
    };
    expect(output.ok).toBe(true);
    expect(output.id).toBe(created.id);

    const updated = await jsonRequest<{
      position: { x: number; y: number };
      size: { width: number; height: number };
    }>(`/api/canvas/node/${created.id}`);
    expect(updated.position).toEqual({ x: 80, y: 240 });
    expect(updated.size).toEqual({ width: 640, height: 200 });
  });

  test('node add returns rendered geometry for immediate layout scripting', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'markdown',
        '--title',
        'Immediate geometry',
        '--x',
        '420',
        '--y',
        '260',
        '--width',
        '500',
        '--height',
        '280',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      position: { x: number; y: number };
      size: { width: number; height: number };
    };
    expect(output.ok).toBe(true);
    expect(output.position).toEqual({ x: 420, y: 260 });
    expect(output.size).toEqual({ width: 500, height: 280 });
  });

  test('node add accepts single-dash coordinate aliases', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'markdown',
        '--title',
        'Single Dash Position',
        '-x',
        '420',
        '-y',
        '260',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as { ok: boolean; id: string };
    expect(output.ok).toBe(true);

    const node = await jsonRequest<{ position: { x: number; y: number } }>(`/api/canvas/node/${output.id}`);
    expect(node.position).toEqual({ x: 420, y: 260 });
  });

  test('node add maps html content to the renderer html field', async () => {
    const html = '<main><h1>CLI HTML widget</h1></main>';
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'html',
        '--title',
        'CLI HTML',
        '--content',
        html,
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      data: Record<string, unknown>;
    };
    expect(output.ok).toBe(true);
    expect(output.data.html).toBe(html);
    expect(output.data.content).toBeUndefined();

    const stored = await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${output.id}`);
    expect(stored.data.html).toBe(html);
    expect(stored.data.content).toBeUndefined();
  });

  test('node add forwards html semantic sidecar flags', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'html',
        '--title',
        'CLI HTML Sidecars',
        '--content',
        '<main><h1>Sidecar body</h1></main>',
        '--summary',
        'Explicit CLI summary.',
        '--agent-summary',
        'Explicit CLI agent summary.',
        '--description',
        'Explicit CLI description.',
        '--presentation',
        'true',
        '--slide-title',
        'Slide One',
        '--embedded-node-id',
        'node-source',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      data: Record<string, unknown>;
    };
    expect(output.ok).toBe(true);
    expect(output.data.summary).toBe('Explicit CLI summary.');
    expect(output.data.agentSummary).toBe('Explicit CLI agent summary.');
    expect(output.data.description).toBe('Explicit CLI description.');
    expect(output.data.presentation).toBe(true);
    expect(output.data.slideTitles).toEqual(['Slide One']);
    expect(output.data.embeddedNodeIds).toEqual(['node-source']);

    const stored = await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${output.id}`);
    expect(stored.data.summary).toBe('Explicit CLI summary.');
  });

  test('html primitive CLI creates generated html node with primitive metadata', async () => {
    const dataPath = join(workspaceRoot, 'options-primitive.json');
    writeFileSync(dataPath, JSON.stringify({
      items: [
        { title: 'HTML artifact', summary: 'Readable and interactive.', pros: ['Visual'], cons: ['More verbose'] },
      ],
    }), 'utf-8');
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'html',
        'primitive',
        'add',
        '--kind',
        'choice-grid',
        '--title',
        'CLI Primitive',
        '--data-file',
        dataPath,
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      type: string;
      data: Record<string, unknown>;
      primitive: { kind: string };
    };
    expect(output.ok).toBe(true);
    expect(output.type).toBe('html');
    expect(output.primitive.kind).toBe('choice-grid');
    expect(output.data.htmlPrimitive).toBe('choice-grid');
    expect(output.data.html).toContain('HTML artifact');
  });

  test('html presentation primitive CLI exposes slide metadata', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'html',
        'primitive',
        'add',
        '--kind',
        'presentation',
        '--title',
        'CLI Presentation',
        '--data-json',
        JSON.stringify({ theme: 'aurora', slides: [{ title: 'Frame' }, { title: 'Decision', note: 'Ask for approval.' }] }),
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      type: string;
      data: Record<string, unknown>;
      primitive: { kind: string };
    };
    expect(output.ok).toBe(true);
    expect(output.type).toBe('html');
    expect(output.primitive.kind).toBe('presentation');
    expect(output.data.presentation).toBe(true);
    expect(output.data.slideCount).toBe(2);
    expect(output.data.slideTitles).toEqual(['Frame', 'Decision']);
    expect(output.data.speakerNotes).toEqual(['Ask for approval.']);
    expect(output.data.presentationTheme).toBe('aurora');
  });

  test('node add forwards trace fields advertised by schema help', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'trace',
        '--title',
        'CLI trace',
        '--content',
        'Trace body',
        '--toolName',
        'canvas_add_node',
        '--status',
        'success',
        '--duration',
        '42ms',
        '--resultSummary',
        'Created node',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    expect(output.ok).toBe(true);
    expect(output.data).toMatchObject({
      title: 'CLI trace',
      content: 'Trace body',
      toolName: 'canvas_add_node',
      status: 'success',
      duration: '42ms',
      resultSummary: 'Created node',
    });
  });

  test('node update forwards trace fields with camel and kebab aliases', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'trace',
        title: 'CLI trace update',
        toolName: 'before',
        status: 'running',
      }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'update',
        created.id,
        '--tool-name',
        'after',
        '--status',
        'failed',
        '--resultSummary',
        'Updated trace',
        '--error',
        'boom',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      data: Record<string, unknown>;
    };
    expect(output.ok).toBe(true);
    expect(output.data).toMatchObject({
      toolName: 'after',
      status: 'failed',
      resultSummary: 'Updated trace',
      error: 'boom',
    });
  });

  test('node update help advertises trace flags', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'update', '--help']);
    } finally {
      console.log = originalLog;
    }

    const help = log.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
    expect(help).toContain('--tool-name');
    expect(help).toContain('--toolName');
    expect(help).toContain('--status');
    expect(help).toContain('--result-summary');
    expect(help).toContain('--resultSummary');
  });

  test('node add help advertises html sidecar flags', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'add', '--help']);
    } finally {
      console.log = originalLog;
    }

    const help = log.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
    expect(help).toContain('--summary');
    expect(help).toContain('--agent-summary');
    expect(help).toContain('--description');
    expect(help).toContain('--presentation');
    expect(help).toContain('--slide-title');
    expect(help).toContain('--embedded-node-id');
    expect(help).toContain('node add --help --type html');
  });

  test('focus --no-pan selects without changing the server viewport', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      id: string;
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'No pan',
        x: 800,
        y: 640,
      }),
    });

    const before = canvasState.viewport;
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['focus', created.id, '--no-pan']);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as { ok: boolean; focused: string; panned: boolean };
    expect(output).toMatchObject({ ok: true, focused: created.id, panned: false });
    expect(canvasState.viewport).toEqual(before);
    expect(canvasState.getNode(created.id)?.zIndex).toBeGreaterThan(1);
    expect(canvasState.getAxFocus().nodeIds).toEqual([created.id]);
  });

  test('ax commands expose context and focus state', async () => {
    const first = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'CLI AX first', content: 'Pinned by CLI AX test' }),
    });
    const second = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'CLI AX second', content: 'Focused by CLI AX test' }),
    });
    await jsonRequest('/api/canvas/context-pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeIds: [first.id] }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['ax', 'focus', second.id]);
      await runAgentCli(['ax', 'status']);
      await runAgentCli(['ax', 'context']);
    } finally {
      console.log = originalLog;
    }

    const focusOutput = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      focus: { nodeIds: string[]; source: string | null };
    };
    const statusOutput = JSON.parse(log.mock.calls[1]?.[0] as string) as {
      state: { focus: { nodeIds: string[] } };
    };
    const contextOutput = JSON.parse(log.mock.calls[2]?.[0] as string) as {
      pinned: { nodeIds: string[] };
      focus: { nodeIds: string[] };
    };

    expect(focusOutput.focus).toMatchObject({ nodeIds: [second.id], source: 'cli' });
    expect(statusOutput.state.focus.nodeIds).toEqual([second.id]);
    expect(contextOutput.pinned.nodeIds).toEqual([first.id]);
    expect(contextOutput.focus.nodeIds).toEqual([second.id]);
  });

  test('ax timeline commands record events, steering, and evidence with the cli source', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['ax', 'event', 'add', '--kind', 'tool-start', '--summary', 'ran tests']);
      await runAgentCli(['ax', 'steer', 'focus on the failing test']);
      await runAgentCli(['ax', 'evidence', 'add', '--kind', 'test-output', '--title', 'unit pass']);
      await runAgentCli(['ax', 'timeline']);
    } finally {
      console.log = originalLog;
    }

    const eventOut = JSON.parse(log.mock.calls[0]?.[0] as string) as { ok: boolean; event: { kind: string; source: string } };
    const steerOut = JSON.parse(log.mock.calls[1]?.[0] as string) as { ok: boolean; steering: { message: string; source: string } };
    const evidenceOut = JSON.parse(log.mock.calls[2]?.[0] as string) as { ok: boolean; evidence: { kind: string } };
    const timelineOut = JSON.parse(log.mock.calls[3]?.[0] as string) as {
      events: Array<{ id: string }>;
      steering: Array<{ id: string }>;
      evidence: Array<{ id: string }>;
    };

    expect(eventOut.event).toMatchObject({ kind: 'tool-start', source: 'cli' });
    expect(steerOut.steering).toMatchObject({ message: 'focus on the failing test', source: 'cli' });
    expect(evidenceOut.evidence.kind).toBe('test-output');
    expect(timelineOut.events.length).toBeGreaterThan(0);
    expect(timelineOut.steering.length).toBeGreaterThan(0);
    expect(timelineOut.evidence.length).toBeGreaterThan(0);
  });

  test('ax canvas-bound commands manage work items, approvals, reviews, and host capability', async () => {
    const node = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'CLI work node' }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    let workItemId = '';
    let approvalId = '';
    try {
      await runAgentCli(['ax', 'work', 'add', '--title', 'Wire auth', '--status', 'in-progress', node.id]);
      workItemId = (JSON.parse(log.mock.calls[0]?.[0] as string) as { workItem: { id: string } }).workItem.id;
      await runAgentCli(['ax', 'work', 'update', workItemId, '--status', 'done']);
      await runAgentCli(['ax', 'approval', 'request', '--title', 'Deploy']);
      approvalId = (JSON.parse(log.mock.calls[2]?.[0] as string) as { approvalGate: { id: string } }).approvalGate.id;
      await runAgentCli(['ax', 'approval', 'resolve', approvalId, '--decision', 'approved']);
      await runAgentCli(['ax', 'review', 'add', '--body', 'needs a test', '--node', node.id]);
      await runAgentCli(['ax', 'host', 'report', '--host', 'copilot', '--canvas', '--session-messaging']);
      await runAgentCli(['ax', 'host', 'status']);
    } finally {
      console.log = originalLog;
    }

    const updatedWork = JSON.parse(log.mock.calls[1]?.[0] as string) as { workItem: { status: string } };
    const resolvedApproval = JSON.parse(log.mock.calls[3]?.[0] as string) as { approvalGate: { status: string } };
    const review = JSON.parse(log.mock.calls[4]?.[0] as string) as { reviewAnnotation: { nodeId: string; source: string } };
    const hostReport = JSON.parse(log.mock.calls[5]?.[0] as string) as { host: { host: string; sessionMessaging: boolean } };
    const hostStatus = JSON.parse(log.mock.calls[6]?.[0] as string) as { host: { host: string } };

    expect(updatedWork.workItem.status).toBe('done');
    expect(resolvedApproval.approvalGate.status).toBe('approved');
    expect(review.reviewAnnotation).toMatchObject({ nodeId: node.id, source: 'cli' });
    expect(hostReport.host).toMatchObject({ host: 'copilot', sessionMessaging: true });
    expect(hostStatus.host.host).toBe('copilot');
  });

  test('ax event add fails loud when the required kind flag is missing', async () => {
    const errorLog = mock(() => {});
    const originalError = console.error;
    const originalExit = process.exit;
    console.error = errorLog;
    let exitCode: number | undefined;
    // @ts-expect-error test stub for process.exit
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error('process.exit');
    }) as typeof process.exit;

    try {
      await runAgentCli(['ax', 'event', 'add', '--summary', 'no kind here']);
    } catch (error) {
      expect((error as Error).message).toBe('process.exit');
    } finally {
      console.error = originalError;
      process.exit = originalExit;
    }

    expect(exitCode).toBe(1);
    const payload = JSON.parse(errorLog.mock.calls[0]?.[0] as string) as { error: string };
    expect(payload.error).toContain('kind');
  });

  test('a bare ax subcommand points at the full command', async () => {
    const errorLog = mock(() => {});
    const originalError = console.error;
    const originalExit = process.exit;
    console.error = errorLog;
    // @ts-expect-error test stub for process.exit
    process.exit = (() => {
      throw new Error('process.exit');
    }) as typeof process.exit;

    try {
      await runAgentCli(['ax', 'event']);
    } catch (error) {
      expect((error as Error).message).toBe('process.exit');
    } finally {
      console.error = originalError;
      process.exit = originalExit;
    }

    const payload = JSON.parse(errorLog.mock.calls[0]?.[0] as string) as { error: string; hint?: string };
    expect(payload.error).toContain('event');
    // alias map turns the bare verb into a "did you mean" suggestion
    expect(`${payload.hint ?? ''}`).toContain('ax event add');
  });

  test('copilot install-extension --dry-run writes nothing', async () => {
    const target = join(workspaceRoot, '.github', 'extensions', 'pmx-canvas', 'extension.mjs');
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['copilot', 'install-extension', '--dry-run', '--target', target]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      dryRun: boolean;
      wrote: boolean;
      targetPath: string;
    };
    expect(output).toMatchObject({ ok: true, dryRun: true, wrote: false, targetPath: target });
    expect(existsSync(target)).toBe(false);
  });

  test('fit command updates server viewport for canvas bounds', async () => {
    await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Fit A', x: 100, y: 100, width: 200, height: 100 }),
    });
    await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Fit B', x: 700, y: 500, width: 300, height: 200 }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['fit', '--width', '1200', '--height', '800', '--padding', '100']);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      viewport: { x: number; y: number; scale: number };
      nodeCount: number;
    };
    expect(output.ok).toBe(true);
    expect(output.nodeCount).toBe(2);
    expect(output.viewport).toEqual({ x: 50, y: 0, scale: 1 });
    expect(canvasState.viewport).toEqual(output.viewport);
  });

  test('node update can replace json-render specs in place', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/json-render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spec: {
          root: 'card',
          elements: {
            card: { type: 'Card', props: { title: 'Before' }, children: ['copy'] },
            copy: { type: 'Text', props: { text: 'Before body' }, children: [] },
          },
        },
      }),
    });

    const specPath = join(workspaceRoot, 'updated-json-render.json');
    writeFileSync(specPath, JSON.stringify({
      root: 'card',
      elements: {
        card: { type: 'Card', props: { title: 'After' }, children: ['copy'] },
        copy: { type: 'Text', props: { text: 'After body' }, children: [] },
      },
    }), 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'update', created.id, '--spec-file', specPath]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      node: { data: { title: string; spec: { elements: Record<string, { props?: { text?: string } }> } } };
    };
    expect(output.ok).toBe(true);
    expect(output.id).toBe(created.id);
    expect(output.node.data.title).toBe('After');
    expect(output.node.data.spec.elements.copy?.props?.text).toBe('After body');
  });

  test('node update can rebuild graph chart config without treating chart height as frame height', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      id: string;
      node: { size: { height: number } };
    }>('/api/canvas/graph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Before graph',
        graphType: 'line',
        data: [{ label: 'A', value: 1 }],
        xKey: 'label',
        yKey: 'value',
        nodeHeight: 700,
      }),
    });

    const dataPath = join(workspaceRoot, 'updated-graph-data.json');
    writeFileSync(dataPath, JSON.stringify([{ label: 'B', value: 9 }]), 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'update',
        created.id,
        '--title',
        'After graph',
        '--graph-type',
        'bar',
        '--data-file',
        dataPath,
        '--x-key',
        'label',
        '--y-key',
        'value',
        '--chart-height',
        '420',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      node: {
        size: { height: number };
        data: {
          graphConfig: Record<string, unknown>;
          spec: { elements: Record<string, { type?: string; props?: Record<string, unknown> }> };
        };
      };
    };
    expect(output.ok).toBe(true);
    expect(output.id).toBe(created.id);
    expect(output.node.size.height).toBe(700);
    expect(output.node.data.graphConfig.title).toBe('After graph');
    expect(output.node.data.graphConfig.graphType).toBe('bar');
    expect(output.node.data.graphConfig.height).toBe(420);
    expect(output.node.data.spec.elements.chart?.type).toBe('BarChart');
    expect(output.node.data.spec.elements.chart?.props?.height).toBe(420);
  });

  test('node update can combine graph data and arrange locking', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      id: string;
    }>('/api/canvas/graph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Lockable graph',
        graphType: 'line',
        data: [{ label: 'A', value: 1 }],
        xKey: 'label',
        yKey: 'value',
      }),
    });

    const dataPath = join(workspaceRoot, 'locked-graph-data.json');
    writeFileSync(dataPath, JSON.stringify([{ label: 'B', value: 12 }]), 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'update',
        created.id,
        '--data-file',
        dataPath,
        '--lock-arrange',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      node: { data: { arrangeLocked?: boolean; graphConfig: { data: Array<Record<string, unknown>> } } };
    };
    expect(output.ok).toBe(true);
    expect(output.node.data.arrangeLocked).toBe(true);
    expect(output.node.data.graphConfig.data).toEqual([{ label: 'B', value: 12 }]);
  });

  test('node update --stdin still updates markdown content when graph flags are absent', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Stdin update',
        content: 'Before',
      }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    const originalStdin = process.stdin;
    console.log = log;
    Object.defineProperty(process, 'stdin', {
      value: Readable.from([Buffer.from('Updated from stdin')]),
      configurable: true,
    });

    try {
      await runAgentCli(['node', 'update', created.id, '--stdin']);
    } finally {
      console.log = originalLog;
      Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      node: { data: { content: string } };
    };
    expect(output.ok).toBe(true);
    expect(output.id).toBe(created.id);
    expect(output.node.data.content).toBe('Updated from stdin');
  });

  test('status buckets hosted artifact nodes under web-artifact', async () => {
    canvasState.addNode({
      id: 'artifact-test',
      type: 'mcp-app',
      position: { x: 0, y: 0 },
      size: { width: 960, height: 720 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data: {
        title: 'Artifact',
        hostMode: 'hosted',
        path: join(workspaceRoot, '.pmx-canvas', 'artifacts', 'artifact.html'),
      },
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['status']);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as { types: Record<string, number> };
    expect(output.types['web-artifact']).toBe(1);
    expect(output.types['mcp-app']).toBeUndefined();
  });

  test('node list can filter by serialized web-artifact kind', async () => {
    canvasState.addNode({
      id: 'artifact-kind-test',
      type: 'mcp-app',
      position: { x: 0, y: 0 },
      size: { width: 960, height: 720 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data: {
        title: 'Artifact Kind',
        viewerType: 'web-artifact',
        path: join(workspaceRoot, '.pmx-canvas', 'artifacts', 'artifact-kind.html'),
      },
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'list', '--type', 'web-artifact', '--summary']);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as Array<{ id: string; type: string; kind?: string }>;
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({ id: 'artifact-kind-test', type: 'mcp-app', kind: 'web-artifact' });
  });

  test('node update supports explicit arrange locking', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      id: string;
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Lock me',
      }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'update', created.id, '--lock-arrange']);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const node = await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${created.id}`);
    expect(node.data.arrangeLocked).toBe(true);
  });

  test('node update supports explicit pinned state changes', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      id: string;
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Pin me',
      }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'update', created.id, '--pinned', 'true']);
      await runAgentCli(['node', 'update', created.id, '--pinned', 'false']);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(2);
    const first = JSON.parse(log.mock.calls[0]?.[0] as string) as { node: { pinned: boolean } };
    const second = JSON.parse(log.mock.calls[1]?.[0] as string) as { node: { pinned: boolean } };
    expect(first.node.pinned).toBe(true);
    expect(second.node.pinned).toBe(false);

    const node = await jsonRequest<{ pinned: boolean }>(`/api/canvas/node/${created.id}`);
    expect(node.pinned).toBe(false);
  });

  test('node update --dock-position docks and undocks a node via the CLI (#40)', async () => {
    const created = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'status', title: 'Dock me' }),
    });

    await runAgentCli(['node', 'update', created.id, '--dock-position', 'left']);
    expect((await jsonRequest<{ dockPosition: string | null }>(`/api/canvas/node/${created.id}`)).dockPosition).toBe('left');

    // The crux of #40: `none` must reach the server as a real null (undock).
    await runAgentCli(['node', 'update', created.id, '--dock-position', 'none']);
    expect((await jsonRequest<{ dockPosition: string | null }>(`/api/canvas/node/${created.id}`)).dockPosition).toBeNull();
  });

  test('node add supports graph nodes from a JSON data file', async () => {
    const dataPath = join(workspaceRoot, 'graph-data.json');
    writeFileSync(dataPath, JSON.stringify([
      { label: 'Docs', value: 5 },
      { label: 'Tests', value: 8 },
      { label: 'Release', value: 3 },
    ]), 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'graph',
        '--title',
        'CLI Graph',
        '--graph-type',
        'bar',
        '--data-file',
        dataPath,
        '--x-key',
        'label',
        '--y-key',
        'value',
        '--width',
        '880',
        '--height',
        '640',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      url: string;
    };
    expect(output.ok).toBe(true);
    expect(output.url).toContain('/api/canvas/json-render/view?nodeId=');

    const node = await jsonRequest<{
      type: string;
      size: { width: number; height: number };
      data: Record<string, unknown>;
    }>(`/api/canvas/node/${output.id}`);
    expect(node.type).toBe('graph');
    expect(node.size).toEqual({ width: 880, height: 640 });
    expect((node.data.graphConfig as Record<string, unknown>).graphType).toBe('bar');
  });

  test('node add accepts --data as a graph JSON alias', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'graph',
        '--graph-type',
        'bar',
        '--title',
        'Alias Graph',
        '--data',
        JSON.stringify([{ x: 'a', y: 1 }, { x: 'b', y: 2 }]),
        '--x-key',
        'x',
        '--y-key',
        'y',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as { ok: boolean; id: string };
    expect(output.ok).toBe(true);
    const node = await jsonRequest<{ data: { graphConfig: Record<string, unknown> } }>(`/api/canvas/node/${output.id}`);
    expect(node.data.graphConfig.data).toEqual([{ x: 'a', y: 1 }, { x: 'b', y: 2 }]);
  });

  test('node add accepts camelCase graph flags shown by schema help', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'graph',
        '--graphType',
        'bar',
        '--title',
        'Camel Graph',
        '--data',
        JSON.stringify([{ x: 'a', y: 1 }]),
        '--xKey',
        'x',
        '--yKey',
        'y',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as { ok: boolean; id: string };
    expect(output.ok).toBe(true);
    const node = await jsonRequest<{ data: { graphConfig: Record<string, unknown> } }>(`/api/canvas/node/${output.id}`);
    expect(node.data.graphConfig).toMatchObject({
      graphType: 'bar',
      xKey: 'x',
      yKey: 'y',
    });
  });

  test('graph add creates graph nodes without requiring node add alias syntax', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'graph',
        'add',
        '--graph-type',
        'bar',
        '--title',
        'Top-level Graph',
        '--data',
        JSON.stringify([{ label: 'a', value: 1 }]),
        '--x-key',
        'label',
        '--y-key',
        'value',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as { ok: boolean; id: string };
    expect(output.ok).toBe(true);
    const node = await jsonRequest<{ type: string; data: { title: string; graphConfig: Record<string, unknown> } }>(`/api/canvas/node/${output.id}`);
    expect(node.type).toBe('graph');
    expect(node.data.title).toBe('Top-level Graph');
    expect(node.data.graphConfig).toMatchObject({
      graphType: 'bar',
      xKey: 'label',
      yKey: 'value',
    });
  });

  test('graph add distinguishes node frame height from chart content height', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'graph',
        'add',
        '--graph-type',
        'bar',
        '--title',
        'Kebab Node Height',
        '--data',
        JSON.stringify([{ label: 'a', value: 1 }]),
        '--x-key',
        'label',
        '--y-key',
        'value',
        '--chart-height',
        '190',
        '--node-height',
        '420',
      ]);
      await runAgentCli([
        'graph',
        'add',
        '--graphType',
        'bar',
        '--title',
        'Camel Node Height',
        '--data',
        JSON.stringify([{ label: 'a', value: 1 }]),
        '--xKey',
        'label',
        '--yKey',
        'value',
        '--chart-height',
        '210',
        '--nodeHeight',
        '430',
      ]);
      await runAgentCli([
        'graph',
        'add',
        '--graph-type',
        'bar',
        '--title',
        'Legacy Height',
        '--data',
        JSON.stringify([{ label: 'a', value: 1 }]),
        '--x-key',
        'label',
        '--y-key',
        'value',
        '--height',
        '440',
      ]);
    } finally {
      console.log = originalLog;
    }

    const outputs = log.mock.calls.map((call) => JSON.parse(call[0] as string) as { id: string });
    expect(outputs).toHaveLength(3);

    const kebabNode = await jsonRequest<{
      size: { height: number };
      data: { graphConfig: { height?: number } };
    }>(`/api/canvas/node/${outputs[0]?.id}`);
    expect(kebabNode.size.height).toBe(420);
    expect(kebabNode.data.graphConfig.height).toBe(190);

    const camelNode = await jsonRequest<{
      size: { height: number };
      data: { graphConfig: { height?: number } };
    }>(`/api/canvas/node/${outputs[1]?.id}`);
    expect(camelNode.size.height).toBe(430);
    expect(camelNode.data.graphConfig.height).toBe(210);

    const legacyNode = await jsonRequest<{
      size: { height: number };
      data: { graphConfig: { height?: number } };
    }>(`/api/canvas/node/${outputs[2]?.id}`);
    expect(legacyNode.size.height).toBe(440);
    expect(legacyNode.data.graphConfig.height).toBeUndefined();
  });

  test('node add rejects generic mcp-app nodes with guidance', async () => {
    const error = mock(() => {});
    const originalError = console.error;
    const originalExit = process.exit;
    console.error = error;
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as typeof process.exit;

    try {
      await expect(runAgentCli(['node', 'add', '--type', 'mcp-app', '--title', 'Bad', '--content', 'x'])).rejects.toThrow('exit:1');
    } finally {
      console.error = originalError;
      process.exit = originalExit;
    }

    const output = JSON.parse(error.mock.calls[0]?.[0] as string) as { error: string; hint: string };
    expect(output.error).toContain('cannot be created with generic node add');
    expect(output.hint).toContain('web-artifact build');
  });

  test('node delete fails loudly with remove suggestion', async () => {
    const error = mock(() => {});
    const originalError = console.error;
    const originalExit = process.exit;
    console.error = error;
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as typeof process.exit;

    try {
      await expect(runAgentCli(['node', 'delete', 'node-missing'])).rejects.toThrow('exit:1');
    } finally {
      console.error = originalError;
      process.exit = originalExit;
    }

    const output = JSON.parse(error.mock.calls[0]?.[0] as string) as { error: string; hint: string };
    expect(output.error).toContain('Unknown node subcommand: "delete"');
    expect(output.hint).toContain('pmx-canvas node remove');
  });

  test('node pin fails loudly and points to top-level pin command', async () => {
    const error = mock(() => {});
    const originalError = console.error;
    const originalExit = process.exit;
    console.error = error;
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as typeof process.exit;

    try {
      await expect(runAgentCli(['node', 'pin', 'node-missing'])).rejects.toThrow('exit:1');
    } finally {
      console.error = originalError;
      process.exit = originalExit;
    }

    const output = JSON.parse(error.mock.calls[0]?.[0] as string) as { error: string; hint: string };
    expect(output.error).toContain('Unknown node subcommand: "pin"');
    expect(output.hint).toContain('Available subcommands:');
    expect(output.hint).toContain('pin');
  });

  test('pin --list returns kind for mcp-app subtypes through the API parity path', async () => {
    const markdown = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'CLI Pinned Note', content: 'CLI native context' }),
    });
    const artifactId = 'cli-pinned-kind-artifact';
    canvasState.addNode({
      id: artifactId,
      type: 'mcp-app',
      position: { x: 20, y: 30 },
      size: { width: 640, height: 420 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data: {
        title: 'CLI Pinned Artifact Kind',
        viewerType: 'web-artifact',
        hostMode: 'hosted',
        content: 'Web artifact: CLI Pinned Artifact Kind',
        path: join(workspaceRoot, '.pmx-canvas', 'artifacts', 'cli-pinned-kind-artifact.html'),
      },
    });
    const externalAppId = 'cli-pinned-kind-external-app';
    canvasState.addNode({
      id: externalAppId,
      type: 'mcp-app',
      position: { x: 720, y: 30 },
      size: { width: 640, height: 420 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data: {
        title: 'CLI Pinned External App Kind',
        mode: 'ext-app',
        serverName: 'Fixture',
        toolName: 'show_counter',
      },
    });
    await jsonRequest<{ ok: boolean; count: number }>('/api/canvas/context-pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeIds: [markdown.id, artifactId, externalAppId] }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['pin', '--list']);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      nodes: Array<{ id: string; type: string; kind: string }>;
    };
    const kinds = Object.fromEntries(output.nodes.map((node) => [node.id, { type: node.type, kind: node.kind }]));

    expect(kinds[markdown.id]).toEqual({ type: 'markdown', kind: 'markdown' });
    expect(kinds[artifactId]).toEqual({ type: 'mcp-app', kind: 'web-artifact' });
    expect(kinds[externalAppId]).toEqual({ type: 'mcp-app', kind: 'external-app' });
  });

  test('edge delete fails loudly with remove suggestion', async () => {
    const error = mock(() => {});
    const originalError = console.error;
    const originalExit = process.exit;
    console.error = error;
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as typeof process.exit;

    try {
      await expect(runAgentCli(['edge', 'delete', 'edge-missing'])).rejects.toThrow('exit:1');
    } finally {
      console.error = originalError;
      process.exit = originalExit;
    }

    const output = JSON.parse(error.mock.calls[0]?.[0] as string) as { error: string; hint: string };
    expect(output.error).toContain('Unknown edge subcommand: "delete"');
    expect(output.hint).toContain('pmx-canvas edge remove');
  });

  test('edge rm fails loudly with remove suggestion', async () => {
    const error = mock(() => {});
    const originalError = console.error;
    const originalExit = process.exit;
    console.error = error;
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as typeof process.exit;

    try {
      await expect(runAgentCli(['edge', 'rm', 'edge-missing'])).rejects.toThrow('exit:1');
    } finally {
      console.error = originalError;
      process.exit = originalExit;
    }

    const output = JSON.parse(error.mock.calls[0]?.[0] as string) as { error: string; hint: string };
    expect(output.error).toContain('Unknown edge subcommand: "rm"');
    expect(output.hint).toContain('pmx-canvas edge remove');
  });

  test('node add exposes the full graph flag surface for newer chart types', async () => {
    const radarPath = join(workspaceRoot, 'graph-radar.json');
    const stackedPath = join(workspaceRoot, 'graph-stacked.json');
    writeFileSync(radarPath, JSON.stringify([
      { axis: 'Q1', north: 5, south: 7 },
      { axis: 'Q2', north: 6, south: 4 },
    ]), 'utf-8');
    writeFileSync(stackedPath, JSON.stringify([
      { month: 'Jan', north: 5, south: 2 },
      { month: 'Feb', north: 7, south: 3 },
    ]), 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'graph',
        '--title',
        'Radar Graph',
        '--graph-type',
        'radar',
        '--data-file',
        radarPath,
        '--axis-key',
        'axis',
        '--metrics',
        'north,south',
      ]);
      await runAgentCli([
        'node',
        'add',
        '--type',
        'graph',
        '--title',
        'Scatter Graph',
        '--graph-type',
        'scatter',
        '--data-json',
        JSON.stringify([
          { x: 1, y: 2, size: 9 },
          { x: 3, y: 4, size: 12 },
        ]),
        '--x-key',
        'x',
        '--y-key',
        'y',
        '--z-key',
        'size',
        '--color',
        '#3366ff',
      ]);
      await runAgentCli([
        'node',
        'add',
        '--type',
        'graph',
        '--title',
        'Stacked Graph',
        '--graph-type',
        'stacked-bar',
        '--data-file',
        stackedPath,
        '--x-key',
        'month',
        '--series',
        'north,south',
      ]);
      await runAgentCli([
        'node',
        'add',
        '--type',
        'graph',
        '--title',
        'Composed Graph',
        '--graph-type',
        'composed',
        '--data-json',
        JSON.stringify([
          { month: 'Jan', visits: 120, conversion: 0.24 },
          { month: 'Feb', visits: 160, conversion: 0.31 },
        ]),
        '--x-key',
        'month',
        '--bar-key',
        'visits',
        '--line-key',
        'conversion',
        '--bar-color',
        '#f97316',
        '--line-color',
        '#0ea5e9',
      ]);
    } finally {
      console.log = originalLog;
    }

    const outputs = log.mock.calls.map((call) => JSON.parse(call[0] as string) as { id: string });
    expect(outputs).toHaveLength(4);

    const radarNode = await jsonRequest<{ data: { graphConfig: Record<string, unknown> } }>(`/api/canvas/node/${outputs[0]?.id}`);
    expect(radarNode.data.graphConfig).toMatchObject({
      graphType: 'radar',
      axisKey: 'axis',
      metrics: ['north', 'south'],
    });

    const scatterNode = await jsonRequest<{ data: { graphConfig: Record<string, unknown> } }>(`/api/canvas/node/${outputs[1]?.id}`);
    expect(scatterNode.data.graphConfig).toMatchObject({
      graphType: 'scatter',
      xKey: 'x',
      yKey: 'y',
      zKey: 'size',
      color: '#3366ff',
    });

    const stackedNode = await jsonRequest<{ data: { graphConfig: Record<string, unknown> } }>(`/api/canvas/node/${outputs[2]?.id}`);
    expect(stackedNode.data.graphConfig).toMatchObject({
      graphType: 'stacked-bar',
      xKey: 'month',
      series: ['north', 'south'],
    });

    const composedNode = await jsonRequest<{ data: { graphConfig: Record<string, unknown> } }>(`/api/canvas/node/${outputs[3]?.id}`);
    expect(composedNode.data.graphConfig).toMatchObject({
      graphType: 'composed',
      xKey: 'month',
      barKey: 'visits',
      lineKey: 'conversion',
      barColor: '#f97316',
      lineColor: '#0ea5e9',
    });
  });

  test('node add supports json-render nodes from a spec file', async () => {
    const specPath = join(workspaceRoot, 'dashboard.json');
    writeFileSync(specPath, JSON.stringify({
      root: 'card',
      elements: {
        card: {
          type: 'Card',
          props: {
            title: 'CLI Dashboard',
          },
          children: ['copy'],
        },
        copy: {
          type: 'Text',
          props: {
            text: 'Rendered from the CLI',
          },
          children: [],
        },
      },
    }), 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'json-render',
        '--title',
        'CLI Dashboard',
        '--spec-file',
        specPath,
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      url: string;
    };
    expect(output.ok).toBe(true);
    expect(output.url).toContain('/api/canvas/json-render/view?nodeId=');

    const node = await jsonRequest<{
      type: string;
      data: Record<string, unknown>;
    }>(`/api/canvas/node/${output.id}`);
    expect(node.type).toBe('json-render');
    expect((node.data.spec as Record<string, unknown>).root).toBe('card');
  });

  test('node add supports image --path and json-render without title', async () => {
    const imagePath = join(workspaceRoot, 'cli-image-path.png');
    writeFileSync(imagePath, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    ));

    const specPath = join(workspaceRoot, 'titleless-badge.json');
    writeFileSync(specPath, JSON.stringify({
      type: 'Badge',
      props: { label: 'CLI Legacy', variant: 'success' },
    }), 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'add', '--type', 'image', '--path', imagePath]);
      await runAgentCli(['node', 'add', '--type', 'json-render', '--spec-file', specPath]);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(2);
    const imageOutput = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      data: { src: string; mimeType: string };
    };
    expect(imageOutput.ok).toBe(true);
    expect(imageOutput.data.src).toBe(imagePath);
    expect(imageOutput.data.mimeType).toBe('image/png');

    const jsonOutput = JSON.parse(log.mock.calls[1]?.[0] as string) as {
      ok: boolean;
      id: string;
      spec: { root: string; elements: Record<string, { props?: { text?: string; variant?: string; label?: string } }> };
    };
    expect(jsonOutput.ok).toBe(true);
    expect(jsonOutput.spec.root).toBe('root');
    expect(jsonOutput.spec.elements.root?.props?.text).toBe('CLI Legacy');
    expect(jsonOutput.spec.elements.root?.props?.variant).toBe('success');
    expect(jsonOutput.spec.elements.root?.props).not.toHaveProperty('label');
  });

  test('node add supports webpage nodes with the canonical --url flag', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'webpage',
        '--title',
        'CLI Webpage',
        '--url',
        'https://example.com/docs',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      data: { url?: string };
    };
    expect(output.ok).toBe(true);
    expect(output.data.url).toBe('https://example.com/docs');
  }, 15000);

  test('node add supports web-artifact as a symmetric create flow', async () => {
    const appPath = join(workspaceRoot, 'NodeAddArtifact.tsx');
    writeFileSync(appPath, 'export default function App() { return <main>Node add artifact</main>; }', 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'web-artifact',
        '--title',
        'Node Add Artifact',
        '--app-file',
        appPath,
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      openedInCanvas: boolean;
      nodeId?: string;
      url?: string;
      startedAt?: string;
      completedAt?: string;
      durationMs?: number;
      timeoutMs?: number;
    };
    expect(output.ok).toBe(true);
    expect(output.openedInCanvas).toBe(true);
    expect(output.nodeId).toBeDefined();
    expect(output.url).toContain('/artifact?path=');
    expect(typeof output.startedAt).toBe('string');
    expect(typeof output.completedAt).toBe('string');
    expect(typeof output.durationMs).toBe('number');
    expect(output.timeoutMs).toBe(600000);
  });

  test('node schema and validate spec expose running-server schema/validation info', async () => {
    const specPath = join(workspaceRoot, 'validation-dashboard.json');
    writeFileSync(specPath, JSON.stringify({
      root: 'table',
      elements: {
        table: {
          type: 'Table',
          props: {
            columns: ['Metric', 'Value'],
            rows: [
              ['Builds', 12],
              ['Deploys', 4],
            ],
          },
          children: [],
        },
      },
    }), 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'schema', '--type', 'webpage', '--field', 'url']);
      await runAgentCli(['node', 'schema', '--type', 'json-render', '--component', 'Table', '--summary']);
      await runAgentCli(['json-render', '--schema', '--component', 'Badge', '--field', 'variant']);
      await runAgentCli(['json-render', '--example', '--component', 'Table']);
      await runAgentCli(['node', 'add', '--help', '--type', 'webpage', '--json']);
      await runAgentCli(['node', 'schema', '--summary']);
      await runAgentCli(['node', 'add', '--help', '--type', 'html', '--json']);
      await runAgentCli(['html', 'primitive', 'schema', '--kind', 'choice-grid', '--summary']);
      await runAgentCli(['validate', 'spec', '--type', 'json-render', '--spec-file', specPath, '--summary']);
      await runAgentCli(['validate', 'spec', '--type', 'html-primitive', '--kind', 'choice-grid', '--data-json', '{"items":[{"title":"A"}]}', '--summary']);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(10);

    const webpageSchema = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      type: string;
      field: { name: string; aliases?: string[] };
    };
    expect(webpageSchema.type).toBe('webpage');
    expect(webpageSchema.field.name).toBe('url');
    expect(webpageSchema.field.aliases).toContain('content');

    const tableSummary = JSON.parse(log.mock.calls[1]?.[0] as string) as {
      type: string;
      requiredProps: string[];
      optionalProps: string[];
    };
    expect(tableSummary.type).toBe('Table');
    expect(tableSummary.requiredProps).toContain('columns');
    expect(tableSummary.requiredProps).toContain('rows');
    expect(tableSummary.requiredProps).not.toContain('caption');
    expect(tableSummary.optionalProps).toContain('caption');

    const badgeVariant = JSON.parse(log.mock.calls[2]?.[0] as string) as {
      component: string;
      prop: { name: string; type: string };
    };
    expect(badgeVariant.component).toBe('Badge');
    expect(badgeVariant.prop.name).toBe('variant');
    expect(badgeVariant.prop.type).toBe('enum');

    const tableExample = JSON.parse(log.mock.calls[3]?.[0] as string) as {
      component: string;
      example: { columns: string[]; rows: string[][] };
    };
    expect(tableExample.component).toBe('Table');
    expect(tableExample.example.columns).toContain('Name');

    const webpageHelp = JSON.parse(log.mock.calls[4]?.[0] as string) as {
      type: string;
      endpoint: string;
      fields: Array<{ name: string }>;
    };
    expect(webpageHelp.type).toBe('webpage');
    expect(webpageHelp.endpoint).toBe('/api/canvas/node');
    expect(webpageHelp.fields.some((field) => field.name === 'url')).toBe(true);

    const schemaSummary = JSON.parse(log.mock.calls[5]?.[0] as string) as {
      nodeTypes: Array<{ type: string; optionalFields: string[] }>;
    };
    const htmlSummary = schemaSummary.nodeTypes.find((entry) => entry.type === 'html');
    expect(htmlSummary).toBeDefined();
    expect(htmlSummary?.optionalFields).toContain('html');

    const htmlHelp = JSON.parse(log.mock.calls[6]?.[0] as string) as {
      type: string;
      endpoint: string;
      fields: Array<{ name: string; aliases?: string[] }>;
    };
    expect(htmlHelp.type).toBe('html');
    expect(htmlHelp.endpoint).toBe('/api/canvas/node');
    expect(htmlHelp.fields.find((field) => field.name === 'html')?.aliases).toContain('content');
    expect(htmlHelp.fields.some((field) => field.name === 'primitive')).toBe(true);

    const htmlPrimitive = JSON.parse(log.mock.calls[7]?.[0] as string) as {
      kind: string;
      dataShape: string;
    };
    expect(htmlPrimitive.kind).toBe('choice-grid');
    expect(htmlPrimitive.dataShape).toContain('items');

    const validation = JSON.parse(log.mock.calls[8]?.[0] as string) as {
      ok: boolean;
      type: string;
      summary: { elementCount: number };
    };
    expect(validation.ok).toBe(true);
    expect(validation.type).toBe('json-render');
    expect(validation.summary.elementCount).toBe(1);

    const primitiveValidation = JSON.parse(log.mock.calls[9]?.[0] as string) as {
      ok: boolean;
      type: string;
      summary: { kind: string; dataKeys: string[] };
    };
    expect(primitiveValidation.ok).toBe(true);
    expect(primitiveValidation.type).toBe('html-primitive');
    expect(primitiveValidation.summary.kind).toBe('choice-grid');
    expect(primitiveValidation.summary.dataKeys).toContain('items');
  });

  test('node add can request strict sizing for scroll-contained content', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'markdown',
        '--title',
        'Strict frame',
        '--content',
        '# Tall\n\ncontent',
        '--width',
        '320',
        '--height',
        '140',
        '--strict-size',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      data: { strictSize?: boolean };
      size: { width: number; height: number };
    };
    expect(output.ok).toBe(true);
    expect(output.size).toEqual({ width: 320, height: 140 });
    expect(output.data.strictSize).toBe(true);
  });

  test('edge add supports search-based node resolution', async () => {
    const from = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'DVT O2', content: 'source' }),
    });
    const to = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'deep work', content: 'target' }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'edge',
        'add',
        '--from-search',
        'DVT O2',
        '--to-search',
        'deep work',
        '--type',
        'relation',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      from: string;
      to: string;
    };
    expect(output.ok).toBe(true);
    expect(output.from).toBe(from.id);
    expect(output.to).toBe(to.id);
  });

  test('group create accepts explicit frames and batch/validate commands work from the CLI', async () => {
    const first = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Frame A', x: 900, y: 180, width: 240, height: 160 }),
    });
    const second = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Frame B', x: 1240, y: 420, width: 240, height: 160 }),
    });

    const groupLog = mock(() => {});
    const originalLog = console.log;
    console.log = groupLog;

    try {
      await runAgentCli([
        'group',
        'create',
        '--title',
        'CLI Frame',
        '--x',
        '40',
        '--y',
        '60',
        '--width',
        '960',
        '--height',
        '720',
        '--child-layout',
        'column',
        first.id,
        second.id,
      ]);
    } finally {
      console.log = originalLog;
    }

    const grouped = JSON.parse(groupLog.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      position: { x: number; y: number };
      size: { width: number; height: number };
    };
    expect(grouped.ok).toBe(true);
    expect(grouped.position).toEqual({ x: 40, y: 60 });
    expect(grouped.size).toEqual({ width: 960, height: 720 });
    const groupedNode = canvasState.getNode(grouped.id);
    expect(groupedNode?.data.children).toEqual([first.id, second.id]);

    canvasState.withSuppressedRecording(() => {
      canvasState.clear();
    });
    mutationHistory.reset();

    const batchPath = join(workspaceRoot, 'cli-batch.json');
    writeFileSync(batchPath, JSON.stringify([
      {
        op: 'node.add',
        assign: 'child',
        args: { type: 'markdown', title: 'CLI batch child', x: 200, y: 200, width: 220, height: 140 },
      },
      {
        op: 'group.create',
        assign: 'frame',
        args: { title: 'CLI batch frame', childIds: ['$child.id'] },
      },
    ]), 'utf-8');

    const batchLog = mock(() => {});
    console.log = batchLog;
    try {
      await runAgentCli(['batch', '--file', batchPath]);
    } finally {
      console.log = originalLog;
    }
    const batchOutput = JSON.parse(batchLog.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      refs: Record<string, { id: string }>;
    };
    expect(batchOutput.ok).toBe(true);
    expect(typeof batchOutput.refs.child?.id).toBe('string');
    expect(typeof batchOutput.refs.frame?.id).toBe('string');

    const validateLog = mock(() => {});
    console.log = validateLog;
    try {
      await runAgentCli(['validate']);
    } finally {
      console.log = originalLog;
    }
    const validation = JSON.parse(validateLog.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      containments: Array<{ groupId: string; childId: string }>;
      collisions: unknown[];
    };
    expect(validation.ok).toBe(true);
    expect(validation.collisions).toEqual([]);
    expect(validation.containments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        groupId: batchOutput.refs.frame.id,
        childId: batchOutput.refs.child.id,
      }),
    ]));
  });

  test('batch supports graph.add from the CLI surface', async () => {
    const batchPath = join(workspaceRoot, 'cli-graph-batch.json');
    writeFileSync(batchPath, JSON.stringify([
      {
        op: 'graph.add',
        assign: 'graph',
        args: {
          title: 'CLI batch graph',
          graphType: 'bar',
          data: [
            { label: 'Docs', value: 5 },
            { label: 'Tests', value: 8 },
          ],
          xKey: 'label',
          yKey: 'value',
          width: 840,
          nodeHeight: 600,
        },
      },
    ]), 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['batch', '--file', batchPath]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      refs: Record<string, { id: string }>;
      results: Array<{
        type: string;
        size: { width: number; height: number };
        data: Record<string, unknown>;
      }>;
    };
    expect(output.ok).toBe(true);
    expect(typeof output.refs.graph?.id).toBe('string');
    expect(output.results[0]?.type).toBe('graph');
    expect(output.results[0]?.size).toEqual({ width: 840, height: 600 });
    expect((output.results[0]?.data.graphConfig as Record<string, unknown>)?.graphType).toBe('bar');
  });

  test('web-artifact build creates a bundled artifact and opens it on the canvas', async () => {
    const appPath = join(workspaceRoot, 'App.tsx');
    const cssPath = join(workspaceRoot, 'index.css');
    writeFileSync(appPath, 'export default function App() { return <main>CLI Artifact</main>; }', 'utf-8');
    writeFileSync(cssPath, 'body { background: #123456; }', 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'web-artifact',
        'build',
        '--title',
        'CLI Artifact',
        '--app-file',
        appPath,
        '--index-css-file',
        cssPath,
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      path: string;
      openedInCanvas: boolean;
      nodeId?: string;
      url?: string;
    };
    expect(output.ok).toBe(true);
    expect(output.openedInCanvas).toBe(true);
    expect(output.nodeId).toBeDefined();
    expect(output.url).toContain('/artifact?path=');

    const node = output.nodeId
      ? await jsonRequest<{ type: string; data: Record<string, unknown> }>(`/api/canvas/node/${output.nodeId}`)
      : null;
    expect(node?.type).toBe('mcp-app');
    expect(node?.data.title).toBe('CLI Artifact');
    expect(node?.data.viewerType).toBe('web-artifact');
  });

  test('external-app add uses a non-empty Excalidraw default scene', async () => {
    const fetchMock = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
      return new Response(JSON.stringify({ ok: true, result: body }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['external-app', 'add', '--kind', 'excalidraw', '--title', 'CLI Diagram', '--timeout-ms', '120000']);
    } finally {
      console.log = originalLog;
      globalThis.fetch = originalFetch;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      id?: string;
      nodeId?: string;
      result?: {
        title: string;
        elements: Array<Record<string, unknown>>;
        timeoutMs: number;
      };
    };
    expect(output.id).toBe(output.nodeId);
    expect(output.result?.title).toBe('CLI Diagram');
    expect(output.result?.elements).toEqual([
      expect.objectContaining({ type: 'rectangle', id: 'pmx-start' }),
    ]);
    expect(output.result?.timeoutMs).toBe(120000);
  });

  test('external-app add accepts elements alias and existing node targets', async () => {
    const fetchMock = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
      return new Response(JSON.stringify({ ok: true, result: body }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'external-app',
        'add',
        '--kind',
        'excalidraw',
        '--node-id',
        'ext-app-existing',
        '--elements',
        '[{"type":"rectangle","id":"changed","x":0,"y":0,"width":80,"height":40}]',
      ]);
    } finally {
      console.log = originalLog;
      globalThis.fetch = originalFetch;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      result?: {
        nodeId?: string;
        elements?: Array<Record<string, unknown>>;
      };
    };
    expect(output.result?.nodeId).toBe('ext-app-existing');
    expect(output.result?.elements).toEqual([
      expect.objectContaining({ type: 'rectangle', id: 'changed' }),
    ]);
  });

  test('diagram add always uses the Excalidraw external app alias', async () => {
    const fetchMock = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
      return new Response(JSON.stringify({ ok: true, result: body }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['diagram', 'add', '--kind', 'other', '--title', 'Alias Diagram']);
    } finally {
      console.log = originalLog;
      globalThis.fetch = originalFetch;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      result?: { title?: string; elements?: Array<Record<string, unknown>> };
    };
    expect(output.result?.title).toBe('Alias Diagram');
    expect(output.result?.elements).toEqual([
      expect.objectContaining({ type: 'rectangle', id: 'pmx-start' }),
    ]);
  });

  test('web-artifact build suppresses raw logs by default and includes them on demand', async () => {
    const initScriptPath = join(workspaceRoot, 'emit-init.sh');
    const bundleScriptPath = join(workspaceRoot, 'emit-bundle.sh');
    writeFileSync(initScriptPath, `#!/bin/bash
set -e
PROJECT_NAME="$1"
mkdir -p "$PROJECT_NAME/src"
echo "init stdout"
echo "init stderr" 1>&2
cat > "$PROJECT_NAME/package.json" <<'EOF'
{"name":"noisy-web-artifact"}
EOF
cat > "$PROJECT_NAME/index.html" <<'EOF'
<!DOCTYPE html><html><body><div id="root"></div></body></html>
EOF
cat > "$PROJECT_NAME/src/main.tsx" <<'EOF'
console.log("main");
EOF
cat > "$PROJECT_NAME/src/App.tsx" <<'EOF'
export default function App() { return null; }
EOF
`, 'utf-8');
    writeFileSync(bundleScriptPath, `#!/bin/bash
set -e
echo "bundle stdout"
echo "bundle stderr" 1>&2
echo '<!DOCTYPE html><html><body>artifact</body></html>' > bundle.html
`, 'utf-8');
    await Bun.$`chmod +x ${initScriptPath} ${bundleScriptPath}`;

    const appPath = join(workspaceRoot, 'NoisyApp.tsx');
    writeFileSync(appPath, 'export default function App() { return <main>Noisy Artifact</main>; }', 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'web-artifact',
        'build',
        '--title',
        'Quiet Artifact',
        '--app-file',
        appPath,
        '--init-script-path',
        initScriptPath,
        '--bundle-script-path',
        bundleScriptPath,
      ]);
      await runAgentCli([
        'web-artifact',
        'build',
        '--title',
        'Verbose Artifact',
        '--app-file',
        appPath,
        '--init-script-path',
        initScriptPath,
        '--bundle-script-path',
        bundleScriptPath,
        '--include-logs',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(2);
    const quietOutput = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      logs?: {
        stdout?: { lineCount: number; excerpt: string[] };
        stderr?: { lineCount: number; excerpt: string[] };
      };
      stdout?: string;
      stderr?: string;
    };
    expect(quietOutput.ok).toBe(true);
    expect(quietOutput.stdout).toBeUndefined();
    expect(quietOutput.stderr).toBeUndefined();
    expect(quietOutput.logs?.stdout?.lineCount).toBeGreaterThan(0);
    expect(quietOutput.logs?.stderr?.excerpt).toContain('bundle stderr');

    const verboseOutput = JSON.parse(log.mock.calls[1]?.[0] as string) as {
      ok: boolean;
      stdout?: string;
      stderr?: string;
    };
    expect(verboseOutput.ok).toBe(true);
    expect(verboseOutput.stdout).toContain('bundle stdout');
    expect(verboseOutput.stderr).toContain('bundle stderr');
  });

  test('web-artifact build prints failure JSON and exits non-zero', async () => {
    const bundleScriptPath = join(workspaceRoot, 'fail-bundle.sh');
    writeFileSync(bundleScriptPath, `#!/bin/bash
set -e
exit 2
`, 'utf-8');
    await Bun.$`chmod +x ${bundleScriptPath}`;

    const appPath = join(workspaceRoot, 'FailApp.tsx');
    writeFileSync(appPath, 'export default function App() { return <main>Fail</main>; }', 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    const originalExit = process.exit;
    console.log = log;
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as typeof process.exit;

    try {
      await expect(runAgentCli([
        'web-artifact',
        'build',
        '--title',
        'Fail Artifact',
        '--app-file',
        appPath,
        '--bundle-script-path',
        bundleScriptPath,
      ])).rejects.toThrow('exit:1');
    } finally {
      console.log = originalLog;
      process.exit = originalExit;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as { ok: boolean; error: string };
    expect(output.ok).toBe(false);
    expect(output.error).toContain('Command failed');
    expect(canvasState.getLayout().nodes.find((node) => node.data.title === 'Fail Artifact')).toBeUndefined();
  });

  test('node list and node get expose the same normalized title/content fields', async () => {
    const filePath = join(workspaceRoot, 'normalized-node.ts');
    writeFileSync(filePath, 'export const normalized = true;\n', 'utf-8');

    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'file', content: filePath }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'list', '--type', 'file']);
      await runAgentCli(['node', 'get', created.id]);
    } finally {
      console.log = originalLog;
    }

    const listed = JSON.parse(log.mock.calls[0]?.[0] as string) as Array<{
      id: string;
      title: string | null;
      content: string | null;
      path: string | null;
    }>;
    const fetched = JSON.parse(log.mock.calls[1]?.[0] as string) as {
      id: string;
      title: string | null;
      content: string | null;
      path: string | null;
    };

    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(expect.objectContaining({
      id: created.id,
      title: 'normalized-node.ts',
      content: 'export const normalized = true;\n',
      path: filePath,
    }));
    expect(fetched).toEqual(expect.objectContaining({
      id: created.id,
      title: listed[0]?.title,
      content: listed[0]?.content,
      path: listed[0]?.path,
    }));
  });

  test('node list --type mcp-app defaults to compact summaries', async () => {
    const opened = await jsonRequest<{
      ok: boolean;
      nodeId: string | null;
      sessionId: string;
    }>('/api/canvas/mcp-app/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName: 'show_counter',
        toolArguments: { initial: 3 },
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
          cwd: workspaceRoot,
        },
      }),
    });
    expect(opened.ok).toBe(true);
    expect(typeof opened.nodeId).toBe('string');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'list', '--type', 'mcp-app']);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const listed = JSON.parse(log.mock.calls[0]?.[0] as string) as Array<{
      id: string;
      type: string;
      kind?: string;
      title: string | null;
      mode?: string;
      serverName?: string;
      toolName?: string;
      sessionStatus?: string;
      dataKeys?: string[];
      data?: Record<string, unknown>;
      content?: string;
    }>;

    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(expect.objectContaining({
      id: opened.nodeId,
      type: 'mcp-app',
      kind: 'external-app',
      title: 'Counter App',
      mode: 'ext-app',
      appSessionId: opened.sessionId,
      hostMode: 'hosted',
      toolName: 'show_counter',
      sessionStatus: 'ready',
    }));
    expect(Array.isArray(listed[0]?.dataKeys)).toBe(true);
    expect(listed[0]?.data).toBeUndefined();
    expect(listed[0]?.content).toBeUndefined();
  });

  test('node get, layout, and history expose compact inspection modes', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/graph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Compact Graph',
        graphType: 'composed',
        data: [
          { month: 'Jan', visits: 120, conversion: 0.24 },
          { month: 'Feb', visits: 160, conversion: 0.31 },
        ],
        xKey: 'month',
        barKey: 'visits',
        lineKey: 'conversion',
      }),
    });
    await jsonRequest<{ ok: boolean; count: number }>('/api/canvas/context-pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeIds: [created.id] }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'get', created.id, '--summary']);
      await runAgentCli(['node', 'get', created.id, '--field', 'title', '--field', 'graphConfig']);
      await runAgentCli(['layout', '--summary']);
      await runAgentCli(['history', '--summary']);
      await runAgentCli(['history', '--compact']);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(5);

    const nodeSummary = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      id: string;
      pinned: boolean;
      graph?: { graphType: string; dataPoints: number; lineKey: string };
      data?: unknown;
      dataKeys?: string[];
    };
    expect(nodeSummary.id).toBe(created.id);
    expect(nodeSummary.pinned).toBe(true);
    expect(nodeSummary.graph).toEqual(expect.objectContaining({
      graphType: 'composed',
      dataPoints: 2,
      lineKey: 'conversion',
    }));
    expect(nodeSummary.data).toBeUndefined();
    expect(nodeSummary.dataKeys).toContain('graphConfig');

    const nodeFields = JSON.parse(log.mock.calls[1]?.[0] as string) as {
      id: string;
      fields: {
        title: string;
        graphConfig: { graphType: string; barKey: string };
      };
    };
    expect(nodeFields.id).toBe(created.id);
    expect(nodeFields.fields.title).toBe('Compact Graph');
    expect(nodeFields.fields.graphConfig).toEqual(expect.objectContaining({
      graphType: 'composed',
      barKey: 'visits',
    }));

    const layoutSummary = JSON.parse(log.mock.calls[2]?.[0] as string) as {
      totalNodes: number;
      totalEdges: number;
      nodesByType: Record<string, number>;
    };
    expect(layoutSummary.totalNodes).toBe(1);
    expect(layoutSummary.totalEdges).toBe(0);
    expect(layoutSummary.nodesByType.graph).toBe(1);

    const historySummary = JSON.parse(log.mock.calls[3]?.[0] as string) as {
      totalMutations: number;
      countsByOperation: Record<string, number>;
      recent: Array<{ description: string }>;
    };
    expect(historySummary.totalMutations).toBeGreaterThan(0);
    expect(historySummary.countsByOperation.addNode).toBeGreaterThan(0);
    expect(historySummary.recent.length).toBeGreaterThan(0);

    const historyCompact = JSON.parse(log.mock.calls[4]?.[0] as string) as {
      totalMutations: number;
      entries: Array<{ description: string; status: string }>;
    };
    expect(historyCompact.totalMutations).toBe(historySummary.totalMutations);
    expect(historyCompact.entries.length).toBeGreaterThan(0);
    expect(['applied', 'current', 'undone']).toContain(historyCompact.entries[0]?.status);
  });

  test('snapshot diff works from the CLI', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Snapshot target', content: 'before' }),
    });
    const snapshot = await jsonRequest<{ ok: boolean; id: string; snapshot: { id: string } }>('/api/canvas/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'cli-snapshot' }),
    });
    expect(snapshot.id).toBe(snapshot.snapshot.id);
    await jsonRequest<{ ok: boolean; id: string }>(`/api/canvas/node/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'after' }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['snapshot', 'diff', snapshot.snapshot.id]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      text: string;
    };
    expect(output.ok).toBe(true);
    expect(output.text).toContain('Modified nodes (1):');
    expect(output.text).toContain('content changed');
  });

  test('snapshot list and gc support bounded cleanup from the CLI', async () => {
    for (const name of ['cli-alpha', 'cli-beta', 'cli-alpha-old']) {
      const saved = await jsonRequest<{ ok: boolean; snapshot: { name: string } }>('/api/canvas/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      expect(saved.snapshot.name).toBe(name);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['snapshot', 'list', '--limit', '2']);
      await runAgentCli(['snapshot', 'list', '--query', 'alpha', '--all']);
      await runAgentCli(['snapshot', 'gc', '--keep', '1', '--dry-run']);
      await runAgentCli(['snapshot', 'gc', '--keep', '1', '--yes']);
    } finally {
      console.log = originalLog;
    }

    const limited = JSON.parse(log.mock.calls[0]?.[0] as string) as Array<{ name: string }>;
    expect(limited.map((item) => item.name)).toEqual(['cli-alpha-old', 'cli-beta']);

    const filtered = JSON.parse(log.mock.calls[1]?.[0] as string) as Array<{ name: string }>;
    expect(filtered.map((item) => item.name)).toEqual(['cli-alpha-old', 'cli-alpha']);

    const preview = JSON.parse(log.mock.calls[2]?.[0] as string) as { dryRun: boolean; deleted: Array<{ name: string }> };
    expect(preview.dryRun).toBe(true);
    expect(preview.deleted.map((item) => item.name)).toEqual(['cli-beta', 'cli-alpha']);

    const result = JSON.parse(log.mock.calls[3]?.[0] as string) as { dryRun: boolean; deleted: Array<{ name: string }> };
    expect(result.dryRun).toBe(false);
    expect(result.deleted.map((item) => item.name)).toEqual(['cli-beta', 'cli-alpha']);

    const remaining = await jsonRequest<Array<{ name: string }>>('/api/canvas/snapshots?all=true');
    expect(remaining.map((item) => item.name)).toEqual(['cli-alpha-old']);
  });

  test('snapshot list supports before and after filters from the CLI', async () => {
    const first = await jsonRequest<{ ok: boolean; snapshot: { name: string; createdAt: string } }>('/api/canvas/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'first-filtered-snapshot' }),
    });
    await Bun.sleep(5);
    const second = await jsonRequest<{ ok: boolean; snapshot: { name: string; createdAt: string } }>('/api/canvas/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'second-filtered-snapshot' }),
    });
    await Bun.sleep(5);
    const third = await jsonRequest<{ ok: boolean; snapshot: { name: string; createdAt: string } }>('/api/canvas/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'third-filtered-snapshot' }),
    });
    expect(first.ok && second.ok && third.ok).toBe(true);

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'snapshot',
        'list',
        '--all',
        '--after',
        second.snapshot.createdAt,
        '--before',
        second.snapshot.createdAt,
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as Array<{ name: string }>;
    expect(output.map((snapshot) => snapshot.name)).toEqual(['second-filtered-snapshot']);
  });

  test('snapshot list help advertises before and after filters', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['snapshot', 'list', '--help']);
    } finally {
      console.log = originalLog;
    }

    const help = log.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
    expect(help).toContain('--before');
    expect(help).toContain('--after');
  });

  test('package file allowlist includes docs for npm consumers', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as { files?: string[] };
    expect(pkg.files).toContain('docs/');
    expect(pkg.files).toContain('.github/extensions/pmx-canvas/');
  });

  test('GitHub Copilot project extension exposes PMX Canvas AX adapter surfaces', () => {
    const extension = readFileSync(join(process.cwd(), '.github/extensions/pmx-canvas/extension.mjs'), 'utf-8');
    expect(extension).toContain('id: "pmx-canvas"');
    expect(extension).toContain('onUserPromptSubmitted');
    expect(extension).toContain('url: `${pmx.baseUrl}/workbench`');
    expect(extension).toContain('"/api/canvas/ax/context"');
    expect(extension).toContain('name: "focus_nodes"');
    expect(extension).toContain('name: "send_instruction"');
    expect(extension).not.toContain('console.log');
  });

  test('Codex app adapter reference documents native Browser and MCP surfaces', () => {
    const reference = readFileSync(
      join(process.cwd(), 'skills/pmx-canvas/references/codex-app-adapter.md'),
      'utf-8',
    );
    const skill = readFileSync(join(process.cwd(), 'skills/pmx-canvas/SKILL.md'), 'utf-8');

    expect(skill).toContain('references/codex-app-adapter.md');
    expect(reference).toContain('Codex in-app Browser');
    expect(reference).toContain('pmx-canvas --mcp');
    expect(reference).toContain('canvas://ax-context');
    expect(reference).toContain('canvas_ax_state { action: "set-focus"');
    expect(reference).toContain('source: "codex"');
  });

  test('edge add supports style and animated flags', async () => {
    const first = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Edge start' }),
    });
    const second = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Edge end' }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'edge',
        'add',
        '--from',
        first.id,
        '--to',
        second.id,
        '--type',
        'references',
        '--style',
        'dashed',
        '--animated',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as { ok: boolean; id: string };
    expect(output.ok).toBe(true);

    const state = await jsonRequest<{
      edges: Array<{ id: string; style?: string; animated?: boolean }>;
    }>('/api/canvas/state');
    expect(state.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: output.id,
        style: 'dashed',
        animated: true,
      }),
    ]));
  });
});
