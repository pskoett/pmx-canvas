import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { canvasState } from '../../src/server/canvas-state.ts';
import { startBoardRuntime } from '../../src/server/canvas-operations.ts';
import {
  emitPrimaryWorkbenchEvent,
  setPrimaryWorkbenchCanvasPromptHandler,
  wrapCanvasAutomationScript,
} from '../../src/server/server.ts';
import {
  resetServerApiState,
  startServerApiSuite,
  stopServerApiSuite,
  type CanvasStateResponse,
  type ServerApiSuite,
  type WorkbenchWebViewStatusResponse,
} from './server-api-harness.ts';

describe('canvas server HTTP API', () => {
  let suite: ServerApiSuite | null = null;
  let baseUrl = '';

  async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, init);
    expect(response.ok).toBe(true);
    return (await response.json()) as T;
  }

  beforeAll(() => {
    suite = startServerApiSuite('pmx-canvas-api-');
    ({ baseUrl } = suite);
  });

  afterAll(() => {
    if (suite) stopServerApiSuite(suite);
  });

  beforeEach(resetServerApiState);

  test('wraps WebView script bodies in an async IIFE', async () => {
    const run = new Function(
      `return ${wrapCanvasAutomationScript('const value = await Promise.resolve("async-ok"); return value;')}`,
    ) as () => Promise<string>;

    expect(await run()).toBe('async-ok');
  });

  test('theme endpoint rejects unknown names instead of soft-accepting (0.4.2 report)', async () => {
    const bad = await fetch(`${baseUrl}/api/canvas/theme`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'not-a-theme' }),
    });
    expect(bad.status).toBe(400);
    const badBody = (await bad.json()) as { ok: boolean; error?: string };
    expect(badBody.ok).toBe(false);
    expect(String(badBody.error)).toContain('Unknown theme');

    const good = await fetch(`${baseUrl}/api/canvas/theme`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'arctic' }),
    });
    expect(good.status).toBe(200);
    expect(((await good.json()) as { theme?: string }).theme).toBe('arctic');

    // Restore the suite default so later tests see the expected theme.
    await fetch(`${baseUrl}/api/canvas/theme`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'harbor' }),
    });
  });

  test('workbench page advertises Amp orb mode only when AMP_ORB is set', async () => {
    // Own BOTH states explicitly: an Amp orb runs the suite with ambient
    // AMP_ORB=1, and the un-set expectation failed there (0.5.0 Amp report).
    const ambient = process.env.AMP_ORB;
    try {
      delete process.env.AMP_ORB;
      const before = await fetch(`${baseUrl}/workbench`).then((r) => r.text());
      expect(before).not.toContain('__PMX_AMP_ORB');
      process.env.AMP_ORB = '1';
      const after = await fetch(`${baseUrl}/workbench`).then((r) => r.text());
      expect(after).toContain('window.__PMX_AMP_ORB = true');
    } finally {
      if (ambient === undefined) delete process.env.AMP_ORB;
      else process.env.AMP_ORB = ambient;
    }
  });

  test('focus margins are screen-space so the target clears the HUD toolbar at any zoom', async () => {
    // Finding Z (0.4.5): a fixed 100 world-px margin shrank below the floating
    // toolbar's height at low scales, hiding the focused node's title bar.
    const created = (await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'status', title: 'Focus margin probe', content: 'x', x: 5000, y: 5000 }),
    }).then((r) => r.json())) as { id: string };

    await fetch(`${baseUrl}/api/canvas/viewport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scale: 0.42 }),
    });
    const focus = (await fetch(`${baseUrl}/api/canvas/focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: created.id }),
    }).then((r) => r.json())) as { panned: boolean };
    expect(focus.panned).toBe(true);

    const state = (await fetch(`${baseUrl}/api/canvas/state`).then((r) => r.json())) as {
      viewport: { x: number; y: number; scale: number };
    };
    // The real contract (Finding Z): the node must land at a fixed SCREEN
    // margin at any zoom. screen = world * scale + viewport (the canvas
    // transform), so assert the node's on-screen position, not raw numbers —
    // a viewport assertion alone passed while the node sat thousands of px
    // off-screen.
    expect(5000 * state.viewport.scale + state.viewport.x).toBeCloseTo(64, 0);
    expect(5000 * state.viewport.scale + state.viewport.y).toBeCloseTo(96, 0);

    await fetch(`${baseUrl}/api/canvas/viewport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scale: 1 }),
    });
    await fetch(`${baseUrl}/api/canvas/node/${created.id}`, { method: 'DELETE' });
  });

  test('the connect snapshot and boot HTML both carry the server version (stale-SPA guard)', async () => {
    // Finding W (0.4.5): long-lived panels keep an old in-memory bundle across
    // upgrades. The client compares the boot-stamped version against the
    // connected frame's version and reloads once on drift.
    const poll = (await fetch(`${baseUrl}/api/workbench/poll`).then((r) => r.json())) as {
      events: Array<{ event: string; payload: Record<string, unknown> }>;
    };
    const connected = poll.events.find((entry) => entry.event === 'connected');
    expect(typeof connected?.payload.version).toBe('string');
    expect(connected?.payload.version as string).toMatch(/^\d+\.\d+\.\d+/);

    const html = await fetch(`${baseUrl}/workbench`).then((r) => r.text());
    expect(html).toContain(`window.__PMX_BOOT_SERVER_VERSION = ${JSON.stringify(connected?.payload.version)}`);
  });

  test('fit sizes to the reporting client window instead of a hardcoded 1440x900', async () => {
    // 0.4.6 orb feedback #2: fit computed a scale for a 1440x900 window the
    // human did not have, so the board overflowed and clipped on both sides.
    const wide = (await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Fit span',
        content: 'x',
        x: 0,
        y: 3000,
        width: 1440,
        height: 900,
      }),
    }).then((r) => r.json())) as { id: string };

    // The browser reports a SMALLER window; the size-only body must not disturb
    // the stored viewport.
    const before = (await fetch(`${baseUrl}/api/canvas/state`).then((r) => r.json())) as {
      viewport: { x: number; y: number; scale: number };
    };
    await fetch(`${baseUrl}/api/canvas/viewport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientWidth: 720, clientHeight: 450, recordHistory: false }),
    });
    const afterReport = (await fetch(`${baseUrl}/api/canvas/state`).then((r) => r.json())) as typeof before;
    expect(afterReport.viewport).toEqual(before.viewport);

    const fitted = (await fetch(`${baseUrl}/api/canvas/fit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeIds: [wide.id] }),
    }).then((r) => r.json())) as { viewport: { scale: number } };

    // Screen-space fit over a 1440x900 node in the reported 720x450 window:
    // usable = (720 - 2*24) x (450 - 48 - 96), reserving the lifecycle
    // filters and the quiet-board minimap. The height binds. The old
    // hardcoded 1440x900 assumption produced ~2x this, the "clipped on both
    // sides" symptom.
    expect(fitted.viewport.scale).toBeCloseTo(Math.min((720 - 48) / 1440, (450 - 48 - 96) / 900), 3);

    // An explicit width still wins over the reported client size.
    const explicit = (await fetch(`${baseUrl}/api/canvas/fit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeIds: [wide.id], width: 1560, height: 1020 }),
    }).then((r) => r.json())) as { viewport: { scale: number } };
    expect(explicit.viewport.scale).toBeCloseTo((1020 - 48 - 96) / 900, 3);

    await fetch(`${baseUrl}/api/canvas/node/${wide.id}`, { method: 'DELETE' });
  });

  test('workbench poll transport: snapshot bootstrap, incremental events, stale-since recovery', async () => {
    // Proxy-safe transport (Amp orb portals): each poll is a short-lived JSON
    // response. A fresh poller (no `since`) gets the SAME connect snapshot the
    // SSE stream sends, so client bootstrap is transport-independent.
    const first = await jsonRequest<{
      ok: boolean;
      snapshot: boolean;
      seq: number;
      events: Array<{ event: string; seq?: number }>;
    }>('/api/workbench/poll');
    expect(first.ok).toBe(true);
    expect(first.snapshot).toBe(true);
    const snapshotEvents = first.events.map((entry) => entry.event);
    expect(snapshotEvents).toContain('connected');
    // The ordered snapshot establishes board ownership before any layout or
    // later tour event, without depending on the separate catalog HTTP read.
    expect(snapshotEvents[1]).toBe('boards-changed');
    expect(snapshotEvents).toContain('canvas-layout-update');
    expect(snapshotEvents).toContain('context-pins-changed');

    // A live mutation lands in the ring; polling with `since` returns it
    // incrementally with strictly increasing seqs.
    await jsonRequest('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Poll probe', x: 40, y: 40 }),
    });
    const incremental = await jsonRequest<{
      snapshot: boolean;
      seq: number;
      events: Array<{ event: string; seq: number }>;
    }>(`/api/workbench/poll?since=${first.seq}`);
    expect(incremental.snapshot).toBe(false);
    expect(incremental.seq).toBeGreaterThan(first.seq);
    expect(incremental.events.length).toBeGreaterThan(0);
    expect(incremental.events.some((entry) => entry.event === 'canvas-layout-update')).toBe(true);
    expect(incremental.events.every((entry) => entry.seq > first.seq)).toBe(true);

    // A caught-up poller gets an empty incremental response, not a snapshot.
    // The create above also touched agent presence, whose emit coalescer lands
    // an `agent-presence` frame ~50ms later — drain until the ring is quiet
    // (Windows CI and loaded machines lost that race; fast ones won it).
    let cursor = incremental.seq;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const drain = await jsonRequest<{ seq: number; events: unknown[] }>(`/api/workbench/poll?since=${cursor}`);
      if (drain.events.length === 0) break;
      cursor = drain.seq;
    }
    const caughtUp = await jsonRequest<{ snapshot: boolean; events: unknown[] }>(`/api/workbench/poll?since=${cursor}`);
    expect(caughtUp.snapshot).toBe(false);
    expect(caughtUp.events.length).toBe(0);

    // A `since` from a previous server run (beyond the live seq) and a garbage
    // `since` both recover via a fresh snapshot instead of erroring.
    const fromFuture = await jsonRequest<{ snapshot: boolean }>(`/api/workbench/poll?since=${cursor + 100000}`);
    expect(fromFuture.snapshot).toBe(true);
    const garbage = await jsonRequest<{ snapshot: boolean }>('/api/workbench/poll?since=banana');
    expect(garbage.snapshot).toBe(true);
  });

  test('workbench long polls wake for human movement and bound idle waits', async () => {
    // Let reset-time coalescers settle before observing a caught-up cursor.
    await Bun.sleep(100);
    const first = await jsonRequest<{ seq: number }>('/api/workbench/poll');
    const waiting = jsonRequest<{
      seq: number;
      events: Array<{
        event: string;
        payload: { humans?: Array<{ clientId: string; cursor: { x: number; y: number } }> };
      }>;
    }>(`/api/workbench/poll?since=${first.seq}&waitMs=1000`);
    await Bun.sleep(40);
    await jsonRequest('/api/canvas/human-presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' },
      body: JSON.stringify({ clientId: 'poll-wakeup', cursor: { x: 237, y: 519 } }),
    });
    const update = await waiting;
    expect(update.seq).toBeGreaterThan(first.seq);
    expect(update.events.find((entry) => entry.event === 'human-presence')?.payload.humans).toContainEqual(
      expect.objectContaining({ clientId: 'poll-wakeup', cursor: { x: 237, y: 519 } }),
    );

    const started = performance.now();
    const idle = await jsonRequest<{ seq: number; events: unknown[] }>(
      `/api/workbench/poll?since=${update.seq}&waitMs=60000`,
    );
    expect(idle.seq).toBe(update.seq);
    expect(idle.events).toEqual([]);
    expect(performance.now() - started).toBeGreaterThanOrEqual(900);
    expect(performance.now() - started).toBeLessThan(3000);

    const controller = new AbortController();
    const aborted = fetch(`${baseUrl}/api/workbench/poll?since=${idle.seq}&waitMs=1000`, { signal: controller.signal });
    await Bun.sleep(40);
    controller.abort();
    await expect(aborted).rejects.toThrow();
    expect((await jsonRequest<{ ok: boolean }>('/api/workbench/poll')).ok).toBe(true);
    await jsonRequest('/api/canvas/human-presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' },
      body: JSON.stringify({ clientId: 'poll-wakeup', left: true }),
    });
  });

  test('updates viewport directly over HTTP', async () => {
    const updated = await jsonRequest<{ ok: boolean }>('/api/canvas/viewport', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 120, y: -80, scale: 1.5 }),
    });
    expect(updated.ok).toBe(true);

    const state = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(state.viewport).toEqual({ x: 120, y: -80, scale: 1.5 });
  });

  test('centres a world point in the reported canvas area', async () => {
    // The browser reports its canvas-region size (not the window) with every viewport write.
    await fetch(`${baseUrl}/api/canvas/viewport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientWidth: 1000, clientHeight: 600 }),
    });
    const centred = await jsonRequest<{ ok: boolean; viewport: { x: number; y: number; scale: number } }>(
      '/api/canvas/viewport',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ center: { x: 200, y: 100 }, scale: 2 }),
      },
    );
    expect(centred.viewport).toEqual({ x: 100, y: 100, scale: 2 });
    // screen = world * scale + viewport lands the point at the area's middle.
    expect(200 * centred.viewport.scale + centred.viewport.x).toBe(500);
    expect(100 * centred.viewport.scale + centred.viewport.y).toBe(300);

    // Without scale it keeps the current zoom.
    const keptZoom = await jsonRequest<{ viewport: { x: number; y: number; scale: number } }>('/api/canvas/viewport', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ center: { x: 0, y: 0 } }),
    });
    expect(keptZoom.viewport).toEqual({ x: 500, y: 300, scale: 2 });
    const state = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(state.viewport).toEqual({ x: 500, y: 300, scale: 2 });
  });

  test('rejects a malformed center or one mixed with x/y', async () => {
    for (const body of [{ center: { x: 1 } }, { center: 'middle' }, { center: { x: 1, y: 2 }, x: 5 }]) {
      const response = await fetch(`${baseUrl}/api/canvas/viewport`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
  });

  test('fits the viewport to current canvas bounds over HTTP', async () => {
    await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // strictSize: this test asserts fit MATH on exact geometry; without it the
      // creation floor clamp (360x180) would shift the bounds.
      body: JSON.stringify({
        type: 'markdown',
        title: 'Fit A',
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        strictSize: true,
      }),
    });
    await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Fit B',
        x: 700,
        y: 500,
        width: 300,
        height: 200,
        strictSize: true,
      }),
    });

    const bodylessFit = await jsonRequest<{
      ok: boolean;
      nodeCount: number;
    }>('/api/canvas/fit', {
      method: 'POST',
    });
    expect(bodylessFit.ok).toBe(true);
    expect(bodylessFit.nodeCount).toBe(2);

    const fitted = await jsonRequest<{
      ok: boolean;
      viewport: { x: number; y: number; scale: number };
      bounds: { x: number; y: number; width: number; height: number };
      nodeCount: number;
    }>('/api/canvas/fit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 1200, height: 800, padding: 100 }),
    });

    expect(fitted.ok).toBe(true);
    expect(fitted.nodeCount).toBe(2);
    expect(fitted.bounds).toEqual({ x: 100, y: 100, width: 900, height: 600 });
    // Screen-space fit contract (0.5.0 Amp finding A): both nodes land inside
    // the padded region and clear of the 96px quiet-board bottom reserve —
    // asserted as node screen-rects, not a viewport tuple (testing rule 4).
    {
      const v = fitted.viewport;
      expect(v.scale).toBeCloseTo(1, 5);
      for (const r of [
        { x: 100, y: 100, w: 200, h: 100 },
        { x: 700, y: 500, w: 300, h: 200 },
      ]) {
        expect(r.x * v.scale + v.x).toBeGreaterThanOrEqual(100 - 1e-6);
        expect(r.y * v.scale + v.y).toBeGreaterThanOrEqual(100 - 1e-6);
        expect((r.x + r.w) * v.scale + v.x).toBeLessThanOrEqual(1200 - 100 + 1e-6);
        // The reserve replaces bottom padding: the usable band ends 96px above the container edge.
        expect((r.y + r.h) * v.scale + v.y).toBeLessThanOrEqual(800 - 96 + 1e-6);
      }
    }

    const state = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(state.viewport).toEqual(fitted.viewport);

    await jsonRequest('/api/canvas/viewport', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientWidth: 1200, clientHeight: 800, clientInsets: { top: 300, bottom: 128 } }),
    });
    // An explicit smaller output is not the browser that reported those reserves.
    const smaller = await jsonRequest<typeof fitted>('/api/canvas/fit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 600, height: 240, padding: 24 }),
    });
    expect(smaller.bounds!.y * smaller.viewport.scale + smaller.viewport.y).toBeGreaterThanOrEqual(24);
    expect((smaller.bounds!.y + smaller.bounds!.height) * smaller.viewport.scale + smaller.viewport.y).toBeLessThan(
      240,
    );
  });

  test('supports edges, snapshots, clear, and pinned context over HTTP', async () => {
    const firstNode = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'First', content: 'One', x: 120, y: 120 }),
    });
    const secondNode = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Second', content: 'Two', x: 620, y: 120 }),
    });

    const edge = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/edge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: firstNode.id, to: secondNode.id, type: 'relation' }),
    });
    expect(edge.id).toContain('edge-');

    const pins = await jsonRequest<{ ok: boolean; count: number }>('/api/canvas/context-pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeIds: [firstNode.id, 'missing-node'] }),
    });
    expect(pins.count).toBe(1);

    const pinnedContext = await jsonRequest<{ count: number; nodeIds: string[] }>('/api/canvas/pinned-context');
    expect(pinnedContext.count).toBe(1);
    expect(pinnedContext.nodeIds).toEqual([firstNode.id]);

    const pinnedNode = await jsonRequest<{ pinned: boolean }>(`/api/canvas/node/${firstNode.id}`);
    expect(pinnedNode.pinned).toBe(true);
    const stateWithPins = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(stateWithPins.nodes.find((node) => node.id === firstNode.id)?.pinned).toBe(true);
    expect(stateWithPins.nodes.find((node) => node.id === secondNode.id)?.pinned).toBe(false);

    const snapshotSave = await jsonRequest<{ ok: boolean; id: string; snapshot: { id: string; name: string } }>(
      '/api/canvas/snapshots',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'before-clear' }),
      },
    );
    expect(snapshotSave.id).toBe(snapshotSave.snapshot.id);
    expect(snapshotSave.snapshot.name).toBe('before-clear');

    await jsonRequest<{ ok: boolean; id: string }>(`/api/canvas/node/${firstNode.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Changed title' }),
    });

    await jsonRequest<{ ok: boolean; id: string }>(`/api/canvas/node/${secondNode.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: { x: 900, y: 640 } }),
    });

    const diff = await jsonRequest<{
      ok: boolean;
      text: string;
      diff: {
        modifiedNodes: Array<{ id: string; changes: string[] }>;
      };
    }>(`/api/canvas/snapshots/${snapshotSave.snapshot.id}/diff`);
    expect(diff.ok).toBe(true);
    expect(diff.text).toContain('Modified nodes (2):');
    expect(diff.diff.modifiedNodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([firstNode.id, secondNode.id]),
    );

    const queryDiff = await jsonRequest<{ ok: boolean; diff: { snapshotName: string } }>(
      `/api/canvas/snapshots/diff?name=${encodeURIComponent(snapshotSave.snapshot.name)}`,
    );
    expect(queryDiff.ok).toBe(true);
    expect(queryDiff.diff.snapshotName).toBe(snapshotSave.snapshot.name);

    await jsonRequest<{ ok: boolean }>('/api/canvas/clear', {
      method: 'POST',
    });

    const clearedState = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(clearedState.nodes).toEqual([]);
    expect(clearedState.edges).toEqual([]);
    expect(clearedState.viewport).toEqual({ x: 0, y: 0, scale: 1 });

    const clearedPins = await jsonRequest<{ count: number; nodeIds: string[] }>('/api/canvas/pinned-context');
    expect(clearedPins.count).toBe(0);
    expect(clearedPins.nodeIds).toEqual([]);

    await jsonRequest<{ ok: boolean }>(`/api/canvas/snapshots/${snapshotSave.snapshot.id}`, {
      method: 'POST',
    });

    const restoredState = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(restoredState.nodes).toHaveLength(2);
    expect(restoredState.edges).toHaveLength(1);
    expect(restoredState.nodes.find((node) => node.id === firstNode.id)?.data.title).toBe('First');
    expect(restoredState.nodes.find((node) => node.id === secondNode.id)?.position).toEqual({ x: 620, y: 120 });

    await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/undo', {
      method: 'POST',
    });
    const undoneState = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(undoneState.nodes).toEqual([]);
    expect(undoneState.edges).toEqual([]);
    expect(undoneState.viewport).toEqual({ x: 0, y: 0, scale: 1 });

    await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/redo', {
      method: 'POST',
    });
    const redoneState = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(redoneState.nodes.find((node) => node.id === firstNode.id)?.data.title).toBe('First');
    expect(redoneState.nodes.find((node) => node.id === secondNode.id)?.position).toEqual({ x: 620, y: 120 });
  });

  test('canvas theme endpoint persists and returns the selected theme', async () => {
    const updated = await jsonRequest<{ ok: boolean; theme: string }>('/api/canvas/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'daylight' }),
    });
    expect(updated).toEqual({ ok: true, theme: 'daylight' });

    const current = await jsonRequest<{ ok: boolean; theme: string }>('/api/canvas/theme');
    expect(current).toEqual({ ok: true, theme: 'daylight' });

    const state = await jsonRequest<{ theme?: string }>('/api/canvas/state');
    expect(state.theme).toBe('daylight');
  });

  // win32: WebView automation is unsupported on Windows; the failure path
  // there doesn't record lastError yet (tracked as follow-up work).
  // Allow the 15s server navigation timeout plus startup/cleanup and response time.
  test.skipIf(process.platform === 'win32')(
    'reports Bun.WebView automation status and fails cleanly when unsupported',
    async () => {
      const initialStatus = await jsonRequest<WorkbenchWebViewStatusResponse>('/api/workbench/webview');
      expect(initialStatus.active).toBe(false);
      expect(initialStatus.headlessOnly).toBe(true);

      const requestedBackend = process.platform === 'darwin' ? 'webkit' : 'chrome';

      const startResponse = await fetch(`${baseUrl}/api/workbench/webview/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backend: requestedBackend, width: 1440, height: 900 }),
      });

      if (!startResponse.ok) {
        expect([500, 501]).toContain(startResponse.status);
        const unsupported = (await startResponse.json()) as {
          ok: boolean;
          error: string;
          webview: WorkbenchWebViewStatusResponse;
        };
        expect(unsupported.ok).toBe(false);
        expect(unsupported.error.length).toBeGreaterThan(0);
        expect(unsupported.webview.active).toBe(false);
        expect(unsupported.webview.lastError).toContain(unsupported.error);
        if (!initialStatus.supported) {
          expect(startResponse.status).toBe(501);
          expect(unsupported.error).toContain('Bun.WebView');
        }
        return;
      }

      expect(startResponse.ok).toBe(true);
      const started = (await startResponse.json()) as {
        ok: boolean;
        webview: WorkbenchWebViewStatusResponse;
      };
      expect(started.ok).toBe(true);
      expect(started.webview.active).toBe(true);
      expect(started.webview.width).toBe(1440);
      expect(started.webview.height).toBe(900);
      expect(started.webview.url).toContain('/workbench');

      const stopResponse = await fetch(`${baseUrl}/api/workbench/webview`, {
        method: 'DELETE',
      });
      expect(stopResponse.ok).toBe(true);
      const stopped = (await stopResponse.json()) as {
        ok: boolean;
        stopped: boolean;
        webview: WorkbenchWebViewStatusResponse;
      };
      expect(stopped.ok).toBe(true);
      expect(stopped.stopped).toBe(true);
      expect(stopped.webview.active).toBe(false);
    },
    30000,
  );

  test('webview evaluate/resize with no active session fail as 400 JSON, not a 500 HTML overlay', async () => {
    // Regression for the v0.2.0 registry refactor: the resize/evaluate op handlers
    // call the injected runner, which throws a PLAIN Error when no automation
    // session is active. That throw must be converted to the legacy
    // 400 { ok:false, error, webview } contract — NOT escape to Bun's default 500
    // text/html dev overlay (which discloses the absolute server source path).
    await fetch(`${baseUrl}/api/workbench/webview`, { method: 'DELETE' }); // ensure stopped

    for (const [path, body] of [
      ['/api/workbench/webview/evaluate', { expression: 'document.title' }],
      ['/api/workbench/webview/resize', { width: 1024, height: 768 }],
    ] as const) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type') ?? '').toContain('application/json');
      const failed = (await res.json()) as { ok: boolean; error: string; webview?: { active?: boolean } };
      expect(failed.ok).toBe(false);
      expect(failed.error.length).toBeGreaterThan(0);
      // Never leak a server filesystem path / stack frame in the error body.
      expect(failed.error).not.toContain('src/server');
      expect(failed.error).not.toContain(process.cwd());
      expect(failed.webview?.active).toBe(false);
    }
  });

  test('supports WebView evaluate, resize, and screenshot endpoints', async () => {
    const requestedBackend = process.platform === 'darwin' ? 'webkit' : 'chrome';

    const startResponse = await fetch(`${baseUrl}/api/workbench/webview/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: requestedBackend, width: 900, height: 700 }),
    });

    if (!startResponse.ok) {
      expect([500, 501]).toContain(startResponse.status);
      const failed = (await startResponse.json()) as {
        ok: boolean;
        error: string;
        webview: WorkbenchWebViewStatusResponse;
      };
      expect(failed.ok).toBe(false);
      expect(failed.error.length).toBeGreaterThan(0);
      expect(failed.webview.active).toBe(false);
      return;
    }

    const evaluateResponse = await fetch(`${baseUrl}/api/workbench/webview/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expression: 'document.title' }),
    });
    expect(evaluateResponse.ok).toBe(true);
    const evaluated = (await evaluateResponse.json()) as { ok: boolean; value: unknown };
    expect(evaluated.ok).toBe(true);
    expect(evaluated.value).toBe('PMX Canvas');

    const scriptResponse = await fetch(`${baseUrl}/api/workbench/webview/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        script: 'const title = await Promise.resolve(document.title); return `${title} async`;',
      }),
    });
    expect(scriptResponse.ok).toBe(true);
    const scriptEvaluated = (await scriptResponse.json()) as { ok: boolean; value: unknown };
    expect(scriptEvaluated.ok).toBe(true);
    expect(scriptEvaluated.value).toBe('PMX Canvas async');

    const resizeResponse = await fetch(`${baseUrl}/api/workbench/webview/resize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 1024, height: 768 }),
    });
    expect(resizeResponse.ok).toBe(true);
    const resized = (await resizeResponse.json()) as {
      ok: boolean;
      webview: WorkbenchWebViewStatusResponse;
    };
    expect(resized.ok).toBe(true);
    expect(resized.webview.width).toBe(1024);
    expect(resized.webview.height).toBe(768);

    const screenshotResponse = await fetch(`${baseUrl}/api/workbench/webview/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'png' }),
    });
    expect(screenshotResponse.ok).toBe(true);
    expect(screenshotResponse.headers.get('Content-Type')).toBe('image/png');
    const screenshot = new Uint8Array(await screenshotResponse.arrayBuffer());
    expect(screenshot.byteLength).toBeGreaterThan(0);

    const stopResponse = await fetch(`${baseUrl}/api/workbench/webview`, {
      method: 'DELETE',
    });
    expect(stopResponse.ok).toBe(true);
  }, 30000);

  test('HTTP node creation broadcasts a live canvas-layout-update event', async () => {
    const abortController = new AbortController();
    // Await the SSE handshake before mutating: the server registers the
    // subscriber in the stream's start() before the response is returned, so a
    // resolved fetch means the layout-update below cannot be missed.
    const response = await fetch(`${baseUrl}/api/workbench/events`, { signal: abortController.signal });
    expect(response.ok).toBe(true);
    const eventsPromise = (async () => {
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      const decoder = new TextDecoder();
      let buffer = '';
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          if (!frame.includes('event: canvas-layout-update')) continue;
          const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice('data: '.length)) as { layout?: { nodes?: Array<{ id: string }> } };
          const nodeIds = payload.layout?.nodes?.map((node) => node.id) ?? [];
          if (nodeIds.some((id) => id.startsWith('node-'))) return nodeIds;
        }
      }
      return [];
    })();

    const created = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'HTTP SSE node',
        content: 'broadcast me',
      }),
    });

    const nodeIds = await Promise.race([eventsPromise, Bun.sleep(2_000).then(() => [] as string[])]);
    abortController.abort();

    expect(nodeIds).toContain(created.id);
  });

  test('exposes running-server schema metadata and structured validation over HTTP', async () => {
    const schema = await jsonRequest<{
      ok: boolean;
      source: string;
      nodeTypes: Array<{ type: string; fields: Array<{ name: string; aliases?: string[]; required?: boolean }> }>;
      jsonRender: { components: Array<{ type: string }> };
      graph: { graphTypes: string[] };
      htmlPrimitives: Array<{ kind: string; dataShape: string }>;
      mcp: { tools: string[]; resources: string[]; nodeTypeRouting: Record<string, string> };
    }>('/api/canvas/schema');

    expect(schema.ok).toBe(true);
    expect(schema.source).toBe('running-server');
    expect(
      schema.nodeTypes.find((entry) => entry.type === 'webpage')?.fields.find((field) => field.name === 'url')?.aliases,
    ).toContain('content');
    expect(
      schema.nodeTypes.find((entry) => entry.type === 'image')?.fields.find((field) => field.name === 'content')
        ?.aliases,
    ).toContain('path');
    const htmlFields = schema.nodeTypes.find((entry) => entry.type === 'html')?.fields ?? [];
    expect(htmlFields.find((field) => field.name === 'agentSummary')?.aliases).toContain('agent-summary');
    expect(htmlFields.find((field) => field.name === 'embeddedNodeIds')?.aliases).toEqual(
      expect.arrayContaining(['embedded-node-id', 'embedded-node-ids']),
    );
    expect(htmlFields.find((field) => field.name === 'embeddedUrls')?.aliases).toEqual(
      expect.arrayContaining(['embedded-url', 'embedded-urls']),
    );
    expect(htmlFields.find((field) => field.name === 'slideTitles')?.aliases).toEqual(
      expect.arrayContaining(['slide-title', 'slide-titles']),
    );
    expect(
      schema.nodeTypes.find((entry) => entry.type === 'json-render')?.fields.find((field) => field.name === 'title'),
    ).toMatchObject({ required: false });
    expect(
      schema.nodeTypes.find((entry) => entry.type === 'graph')?.fields.some((field) => field.name === 'zKey'),
    ).toBe(true);
    expect(
      schema.nodeTypes.find((entry) => entry.type === 'graph')?.fields.some((field) => field.name === 'metrics'),
    ).toBe(true);
    expect(
      schema.nodeTypes.find((entry) => entry.type === 'trace')?.fields.some((field) => field.name === 'toolName'),
    ).toBe(true);
    expect(
      schema.nodeTypes.find((entry) => entry.type === 'trace')?.fields.some((field) => field.name === 'resultSummary'),
    ).toBe(true);
    expect(
      schema.nodeTypes
        .find((entry) => entry.type === 'web-artifact')
        ?.fields.some((field) => field.name === 'timeoutMs'),
    ).toBe(true);
    expect(schema.jsonRender.components.some((component) => component.type === 'Table')).toBe(true);
    expect(schema.graph.graphTypes).toContain('area');
    expect(schema.graph.graphTypes).toContain('stacked-bar');
    expect(schema.graph.graphTypes).toContain('composed');
    expect(schema.htmlPrimitives.some((primitive) => primitive.kind === 'choice-grid')).toBe(true);
    expect(schema.htmlPrimitives.some((primitive) => primitive.kind === 'pr-writeup')).toBe(true);
    expect(schema.htmlPrimitives.some((primitive) => primitive.kind === 'code-walkthrough')).toBe(true);
    expect(schema.htmlPrimitives.some((primitive) => primitive.kind === 'interaction-prototype')).toBe(true);
    expect(schema.htmlPrimitives.some((primitive) => primitive.kind === 'illustration-set')).toBe(true);
    expect(schema.htmlPrimitives.some((primitive) => primitive.kind === 'presentation')).toBe(true);
    expect(schema.htmlPrimitives.some((primitive) => primitive.kind === 'incident-report')).toBe(true);
    expect(schema.htmlPrimitives.some((primitive) => primitive.kind === 'triage-board')).toBe(true);
    expect(schema.mcp.tools).toContain('canvas_render');
    expect(schema.mcp.tools).toContain('canvas_node');
    expect(schema.mcp.resources).toContain('canvas://schema');
    expect(schema.mcp.nodeTypeRouting).toMatchObject({
      markdown: 'canvas_node (action:"add")',
      'json-render': 'canvas_render (action:"add-json-render")',
      graph: 'canvas_render (action:"add-graph")',
      'web-artifact': 'canvas_app (action:"build-artifact")',
      // v0.3.0: html/html-primitive routing points at canvas_node.
      html: 'canvas_node (action:"add", type:"html")',
      'html-primitive': 'canvas_node (action:"add", type:"html", primitive:"<kind>")',
      'external-app': 'canvas_app (action:"open-mcp-app")',
      group: 'canvas_group (action:"create")',
    });

    const jsonValidation = await jsonRequest<{
      ok: boolean;
      type: string;
      normalizedSpec: {
        elements: Record<string, { props?: { rows?: string[][] } }>;
      };
    }>('/api/canvas/schema/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'json-render',
        spec: {
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
        },
      }),
    });

    expect(jsonValidation.ok).toBe(true);
    expect(jsonValidation.type).toBe('json-render');
    expect(jsonValidation.normalizedSpec.elements.table?.props?.rows).toEqual([
      ['Builds', '12'],
      ['Deploys', '4'],
    ]);

    const graphValidation = await jsonRequest<{
      ok: boolean;
      type: string;
      summary: { graphType: string; dataPoints: number };
      normalizedSpec: { elements: { chart?: { type?: string; props?: Record<string, unknown> } } };
    }>('/api/canvas/schema/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'graph',
        title: 'Trend',
        graphType: 'composed',
        data: [
          { label: 'Docs', value: 5, rate: 0.2 },
          { label: 'Tests', value: 8, rate: 0.4 },
        ],
        xKey: 'label',
        barKey: 'value',
        lineKey: 'rate',
        barColor: '#60b5ff',
        lineColor: '#d7a83f',
      }),
    });

    expect(graphValidation.ok).toBe(true);
    expect(graphValidation.type).toBe('graph');
    expect(graphValidation.summary).toEqual(expect.objectContaining({ graphType: 'ComposedChart', dataPoints: 2 }));
    expect(graphValidation.normalizedSpec.elements.chart?.props).toEqual(
      expect.objectContaining({
        xKey: 'label',
        barKey: 'value',
        lineKey: 'rate',
        barColor: '#60b5ff',
        lineColor: '#d7a83f',
      }),
    );

    const invalidGraphValidation = await fetch(`${baseUrl}/api/canvas/schema/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'graph',
        graphType: 'bar',
        data: [{ label: 'Docs', value: 5 }],
        xKey: 'missingLabel',
        yKey: 'value',
      }),
    });
    expect(invalidGraphValidation.ok).toBe(false);
    const invalidGraphBody = (await invalidGraphValidation.json()) as { ok: boolean; error: string };
    expect(invalidGraphBody.ok).toBe(false);
    expect(invalidGraphBody.error).toContain('missingLabel');
    expect(invalidGraphBody.error).toContain('Available keys: label, value');

    const invalidGraphCreate = await fetch(`${baseUrl}/api/canvas/graph`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphType: 'bar',
        data: [{ label: 'Docs', value: 5 }],
        xKey: 'label',
        yKey: 'missingValue',
      }),
    });
    expect(invalidGraphCreate.ok).toBe(false);
    const invalidGraphCreateBody = (await invalidGraphCreate.json()) as { ok: boolean; error: string };
    expect(invalidGraphCreateBody.ok).toBe(false);
    expect(invalidGraphCreateBody.error).toContain('missingValue');

    const htmlPrimitiveValidation = await jsonRequest<{
      ok: boolean;
      type: string;
      normalizedPrimitive: { kind: string; title: string; htmlBytes: number };
      summary: { dataKeys: string[] };
    }>('/api/canvas/schema/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'html-primitive',
        kind: 'incident-report',
        title: 'HTTP Incident',
        data: {
          summary: 'Latency incident summary.',
          timeline: [{ time: '10:04', event: 'Alert fired', detail: 'p95 crossed threshold.' }],
        },
      }),
    });

    expect(htmlPrimitiveValidation.ok).toBe(true);
    expect(htmlPrimitiveValidation.type).toBe('html-primitive');
    expect(htmlPrimitiveValidation.normalizedPrimitive.kind).toBe('incident-report');
    expect(htmlPrimitiveValidation.normalizedPrimitive.title).toBe('HTTP Incident');
    expect(htmlPrimitiveValidation.normalizedPrimitive.htmlBytes).toBeGreaterThan(1000);
    expect(htmlPrimitiveValidation.summary.dataKeys).toContain('timeline');

    const invalidHtmlPrimitiveValidation = await fetch(`${baseUrl}/api/canvas/schema/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'html-primitive',
        kind: 'presentation',
        data: {
          theme: 'nonexistent',
          slides: [{ title: 'Bad theme' }],
        },
      }),
    });
    expect(invalidHtmlPrimitiveValidation.status).toBe(400);
    expect(((await invalidHtmlPrimitiveValidation.json()) as { error: string }).error).toContain(
      'Invalid presentation theme',
    );
  });

  test('a failed prompt handler rolls the thread back instead of leaving it pending', async () => {
    const post = (body: Record<string, unknown>) =>
      fetch(`${baseUrl}/api/canvas/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' },
        body: JSON.stringify(body),
      });
    const promptCount = () => canvasState.getLayout().nodes.filter((node) => node.type === 'prompt').length;
    setPrimaryWorkbenchCanvasPromptHandler(async () => {
      throw new Error('agent offline');
    });
    try {
      const answeredTurns = [
        { role: 'user', text: 'Question', status: 'complete' },
        { role: 'assistant', text: 'Answer', status: 'complete' },
      ];
      canvasState.addNode({
        id: 'thread-handler-fails',
        type: 'prompt',
        position: { x: 0, y: 0 },
        size: { width: 520, height: 400 },
        zIndex: 1,
        collapsed: false,
        pinned: false,
        data: { text: 'Question', turns: answeredTurns, threadStatus: 'answered' },
      });
      expect((await post({ text: 'Follow-up', threadNodeId: 'thread-handler-fails' })).status).toBe(409);
      // The reply is withdrawn, so the card is answered (and movable) again.
      expect(canvasState.getNode('thread-handler-fails')?.data).toMatchObject({
        threadStatus: 'answered',
        turns: answeredTurns,
      });

      const before = promptCount();
      expect((await post({ text: 'Fresh question' })).status).toBe(409);
      expect(promptCount()).toBe(before);

      // An answer that was streaming when the reply was sent finishes while the
      // failing handler runs: the rollback withdraws only the reply.
      emitPrimaryWorkbenchEvent('canvas-response-start', {
        responseNodeId: 'resp-during-reply',
        promptNodeId: 'thread-handler-fails',
      });
      setPrimaryWorkbenchCanvasPromptHandler(async () => {
        emitPrimaryWorkbenchEvent('canvas-response-complete', {
          responseNodeId: 'resp-during-reply',
          content: 'Finished meanwhile',
        });
        throw new Error('agent offline');
      });
      expect((await post({ text: 'Second follow-up', threadNodeId: 'thread-handler-fails' })).status).toBe(409);
      const data = canvasState.getNode('thread-handler-fails')?.data;
      expect(data?.threadStatus).toBe('answered');
      expect(
        (data?.turns as Array<{ text: string; status: string }>).map(({ text, status }) => [text, status]),
      ).toEqual([
        ['Question', 'complete'],
        ['Answer', 'complete'],
        ['Finished meanwhile', 'complete'],
      ]);

      // A whole answer that starts and ends during the handler moves the thread off
      // `pending`; the failed reply is still withdrawn.
      setPrimaryWorkbenchCanvasPromptHandler(async () => {
        emitPrimaryWorkbenchEvent('canvas-response-start', {
          responseNodeId: 'resp-inside-handler',
          promptNodeId: 'thread-handler-fails',
        });
        emitPrimaryWorkbenchEvent('canvas-response-complete', {
          responseNodeId: 'resp-inside-handler',
          content: 'Another agent answered',
        });
        throw new Error('agent offline');
      });
      expect((await post({ text: 'Third follow-up', threadNodeId: 'thread-handler-fails' })).status).toBe(409);
      const after = canvasState.getNode('thread-handler-fails')?.data;
      expect(after?.threadStatus).toBe('answered');
      expect((after?.turns as Array<{ text: string }>).map(({ text }) => text)).toEqual([
        'Question',
        'Answer',
        'Finished meanwhile',
        'Another agent answered',
      ]);
    } finally {
      setPrimaryWorkbenchCanvasPromptHandler(null);
    }
  });

  test('prompt threads stay busy only while their producer is live in this process', async () => {
    const post = async (body: Record<string, unknown>) =>
      (await (
        await fetch(`${baseUrl}/api/canvas/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' },
          body: JSON.stringify(body),
        })
      ).json()) as { ok: boolean; nodeId: string };
    const thread = (id: string) => canvasState.getNode(id)?.data as Record<string, unknown>;
    const turns = (id: string) => thread(id).turns as Array<Record<string, unknown>>;
    setPrimaryWorkbenchCanvasPromptHandler(async () => {});
    try {
      // A thread left streaming by a previous process settles when its board starts.
      canvasState.addNode({
        id: 'thread-from-last-run',
        type: 'prompt',
        position: { x: 0, y: 0 },
        size: { width: 520, height: 400 },
        zIndex: 1,
        collapsed: false,
        pinned: false,
        data: {
          text: 'Q',
          turns: [
            { role: 'user', text: 'Q', status: 'pending' },
            { role: 'assistant', text: 'Partial answer', status: 'streaming' },
          ],
          threadStatus: 'streaming',
          _activeResponseId: 'response-gone',
        },
      });
      const live = (await post({ text: 'Live question' })).nodeId;
      startBoardRuntime();
      expect(thread('thread-from-last-run')).toMatchObject({ threadStatus: 'answered' });
      expect(thread('thread-from-last-run')._activeResponseId).toBeUndefined();
      expect(turns('thread-from-last-run')[1]).toMatchObject({ text: 'Partial answer', status: 'complete' });
      // ...but a prompt this process is still answering is left alone.
      expect(thread(live).threadStatus).toBe('pending');

      // A reply sent mid-stream is not overwritten by the first response, and keeps the thread pending.
      emitPrimaryWorkbenchEvent('canvas-response-start', { responseNodeId: 'r1', promptNodeId: live });
      await post({ text: 'Follow-up', threadNodeId: live });
      emitPrimaryWorkbenchEvent('canvas-response-delta', { responseNodeId: 'r1', content: 'First answer' });
      emitPrimaryWorkbenchEvent('canvas-response-complete', { responseNodeId: 'r1', content: 'First answer' });
      expect(turns(live).map((turn) => [turn.role, turn.text])).toEqual([
        ['user', 'Live question'],
        ['assistant', 'First answer'],
        ['user', 'Follow-up'],
      ]);
      expect(thread(live).threadStatus).toBe('pending');
      startBoardRuntime();
      expect(thread(live).threadStatus).toBe('pending');

      // A newer response supersedes the active one: late deltas of the old one go nowhere.
      emitPrimaryWorkbenchEvent('canvas-response-start', { responseNodeId: 'r2', promptNodeId: live });
      emitPrimaryWorkbenchEvent('canvas-response-start', { responseNodeId: 'r3', promptNodeId: live });
      emitPrimaryWorkbenchEvent('canvas-response-delta', { responseNodeId: 'r2', content: 'Stale' });
      emitPrimaryWorkbenchEvent('canvas-response-complete', { responseNodeId: 'r3', content: 'Second answer' });
      expect(
        turns(live)
          .slice(3)
          .map((turn) => [turn.text, turn.status]),
      ).toEqual([
        ['', 'complete'],
        ['Second answer', 'complete'],
      ]);
      expect(thread(live).threadStatus).toBe('answered');
    } finally {
      setPrimaryWorkbenchCanvasPromptHandler(null);
    }
  });

  test('a queued prompt dropped from the full intent queue does not stay pending', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 121; i += 1) {
      const response = await fetch(`${baseUrl}/api/canvas/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' },
        body: JSON.stringify({ text: `Queued ${i}` }),
      });
      ids.push(((await response.json()) as { nodeId: string }).nodeId);
    }
    expect(canvasState.getNode(ids[0]!)?.data).toMatchObject({ threadStatus: 'draft', status: 'draft', turns: [] });
    expect(canvasState.getNode(ids.at(-1)!)?.data.threadStatus).toBe('pending');
  });
});
