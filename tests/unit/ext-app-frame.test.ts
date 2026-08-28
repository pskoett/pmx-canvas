import { describe, expect, test } from 'bun:test';
import {
  buildExtAppAxBridgeScript,
  buildExtAppBootBeaconScript,
  buildExtAppSurfaceBaseStyles,
  enqueueWebkitRemount,
  getExtAppBridgeInitKey,
  injectExtAppAxBridgeScript,
  isWebKitOnlyHost,
  resolveExtAppContainerDimensions,
  resolveExtAppDisplayModeRequest,
  resolveExtAppInlineFrameHeight,
  resolveExtAppSandbox,
  shouldApplyExtAppSizeChange,
  WEBKIT_REMOUNT_SETTLE_MS,
} from '../../src/client/nodes/ExtAppFrame.tsx';
import type { CanvasNodeState } from '../../src/client/types.ts';
import { waitForCondition } from './helpers.ts';

describe('ExtAppFrame WebKit-host gate (Finding F)', () => {
  // Real WebKit-only hosts (Safari / WKWebView, e.g. the Copilot panel) → remount on.
  const webkitOnly = [
    // Safari 17 (macOS)
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    // WKWebView (no Safari/Chrome token — common for an embedded app panel)
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    // iOS Safari
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  ];
  // Blink + Gecko (Chrome / Edge / Codex browser / Chrome-on-iOS / Android WebView /
  // Firefox) → must be a strict no-op (these paint eagerly and are what we test).
  const notWebkitOnly = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.0.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0',
  ];

  test('matches Safari / WKWebView only', () => {
    for (const ua of webkitOnly) expect(isWebKitOnlyHost(ua)).toBe(true);
  });

  test('is a no-op for Blink (Chrome/Edge/Codex/Android) and Gecko', () => {
    for (const ua of notWebkitOnly) expect(isWebKitOnlyHost(ua)).toBe(false);
  });

  test('remount queue is boot-aware: the next remount waits for the previous boot', async () => {
    // Each recovery remount reboots the app (~1-2s for Excalidraw); a fixed stagger
    // re-bursts N reboots. The queue must not fire remount B until app A's awaitBoot
    // resolves — that is the whole fix for the multi-app reload blackout.
    const order: string[] = [];
    let releaseA: (() => void) | undefined;
    const bootA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    enqueueWebkitRemount({
      remount: () => {
        order.push('remount:A');
        return true;
      },
      awaitBoot: () => bootA.then(() => order.push('boot:A')).then(() => {}),
    });
    enqueueWebkitRemount({
      remount: () => {
        order.push('remount:B');
        return true;
      },
      awaitBoot: () => Promise.resolve(),
    });

    // Deliberate fixed 30ms window: proves B did NOT fire while A boots — absence can't be polled.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(order).toEqual(['remount:A']); // B queued, NOT started while A boots

    releaseA?.();
    // B runs only after A's boot resolves plus the WEBKIT_REMOUNT_SETTLE_MS pause.
    await waitForCondition(() => order.includes('remount:B'), {
      timeoutMs: WEBKIT_REMOUNT_SETTLE_MS + 3000,
      label: "remount B to run after A's boot + settle",
    });
    expect(order).toEqual(['remount:A', 'boot:A', 'remount:B']);
  });

  test('a skipped remount (node gone) does not stall the queue on its boot wait', async () => {
    const order: string[] = [];
    enqueueWebkitRemount({
      remount: () => false, // node unmounted/expanded — skip
      awaitBoot: () =>
        new Promise(() => {
          order.push('boot-wait:skipped'); // must never be awaited
        }),
    });
    enqueueWebkitRemount({
      remount: () => {
        order.push('remount:next');
        return true;
      },
      awaitBoot: () => Promise.resolve(),
    });
    // The shared queue may still be draining the previous test's settle delay,
    // so poll: if the queue wrongly awaited the skipped boot, 'boot-wait:skipped'
    // is pushed before 'remount:next' (equality below catches it) and the queue
    // stalls forever on the never-resolving promise (this wait times out).
    await waitForCondition(() => order.length > 0, {
      timeoutMs: WEBKIT_REMOUNT_SETTLE_MS + 3000,
      label: 'the remount queue to process past the skipped task',
    });
    expect(order).toEqual(['remount:next']);
  });
});

describe('ExtAppFrame display mode requests', () => {
  test('expands into focus mode instead of resizing the backing node', () => {
    expect(resolveExtAppDisplayModeRequest('fullscreen', false)).toEqual({
      nextMode: 'fullscreen',
      shouldExpand: true,
      shouldCollapse: false,
    });
  });

  test('treats fullscreen as a no-op when the node is already expanded', () => {
    expect(resolveExtAppDisplayModeRequest('fullscreen', true)).toEqual({
      nextMode: 'fullscreen',
      shouldExpand: false,
      shouldCollapse: false,
    });
  });

  test('collapses focus mode when the app requests inline mode', () => {
    expect(resolveExtAppDisplayModeRequest('inline', true)).toEqual({
      nextMode: 'inline',
      shouldExpand: false,
      shouldCollapse: true,
    });
  });

  test('leaves pip requests alone', () => {
    expect(resolveExtAppDisplayModeRequest('pip', false)).toEqual({
      nextMode: 'pip',
      shouldExpand: false,
      shouldCollapse: false,
    });
  });
});

describe('ExtAppFrame sandbox handling', () => {
  test('uses the ext-app default sandbox when no override is provided', () => {
    expect(resolveExtAppSandbox(null)).toBe('allow-scripts allow-popups allow-popups-to-escape-sandbox');
  });

  test('preserves a non-empty sandbox override for sandbox proxy resources', () => {
    expect(resolveExtAppSandbox(' allow-scripts allow-forms ')).toBe('allow-scripts allow-forms');
  });
});

describe('ExtAppFrame boot beacon (WebKit watchdog liveness)', () => {
  // The watchdog must not remount an app that is alive but boots via the 1200ms
  // fallback (never sends initialized). The beacon is its liveness proof: it
  // posts the moment the iframe's scripts execute — a dead window never beacons.
  test('beacon posts an authenticated liveness message to the parent', () => {
    const script = buildExtAppBootBeaconScript('frame-token', 'node-9');

    expect(script).toContain('data-pmx-canvas-boot-beacon');
    expect(script).toContain('window.parent.postMessage');
    expect(script).toContain("source: 'pmx-canvas-ext-app-alive'");
    expect(script).toContain('"frame-token"');
    expect(script).toContain('"node-9"');
  });

  test('beacon runs before the AX bridge and before authored body content', () => {
    const beacon = buildExtAppBootBeaconScript('frame-token', 'node-9');
    const ax = buildExtAppAxBridgeScript('frame-token', 'node-9');
    const html = '<!doctype html><html><head><title>App</title></head><body><main>app</main></body></html>';
    const injected = injectExtAppAxBridgeScript(html, beacon + ax);

    const beaconAt = injected.indexOf('data-pmx-canvas-boot-beacon');
    expect(beaconAt).toBeGreaterThan(injected.indexOf('<head>'));
    expect(beaconAt).toBeLessThan(injected.indexOf('data-pmx-canvas-ax-bridge'));
    expect(beaconAt).toBeLessThan(injected.indexOf('<main>'));
  });

  test('base styles make the app document background transparent (Finding Q, body-level)', () => {
    const styles = buildExtAppSurfaceBaseStyles();
    expect(styles).toContain('data-pmx-canvas-ext-app-base');
    expect(styles).toContain('background: transparent !important');
    const injected = injectExtAppAxBridgeScript('<head><title>t</title></head><body>app</body>', styles);
    expect(injected.indexOf('data-pmx-canvas-ext-app-base')).toBeGreaterThan(injected.indexOf('<head>'));
    expect(injected.indexOf('data-pmx-canvas-ext-app-base')).toBeLessThan(injected.indexOf('<body>'));
  });

  test('beacon-only injection works when AX is disabled', () => {
    const beacon = buildExtAppBootBeaconScript('frame-token', 'node-9');
    const injected = injectExtAppAxBridgeScript('<main>app</main>', beacon);
    expect(injected.indexOf('data-pmx-canvas-boot-beacon')).toBeLessThan(injected.indexOf('<main>'));
  });

  test('beacon answers paint probes with a double-rAF paint-tick (Finding N oracle)', () => {
    // The paint oracle: the parent posts a probe; the app document answers with
    // a paint-tick only after two animation frames — i.e. only when its
    // rendering pipeline actually runs. Silence drives the recovery ladder.
    const script = buildExtAppBootBeaconScript('frame-token', 'node-9');
    expect(script).toContain("source === 'pmx-canvas-ext-app-paint-probe'");
    expect(script).toContain("kind: 'paint-tick'");
    // Double rAF — a single rAF can fire without a subsequent composite.
    expect(script.split('requestAnimationFrame').length - 1).toBe(2);
    // One unsolicited tick at boot so a healthy frame confirms without a probe.
    expect(script).toContain('sendPaintTick();');
  });

  test('paint-tick carries a CONTENT verdict — a bare rAF tick was a false green (Finding N reopen)', () => {
    // 0.5.0 reports: WKWebKit answered the double-rAF probe on tiles that were
    // empty cream or black — the rAF pipeline runs while nothing composites.
    // The tick must say whether the document actually CONTAINS rendered
    // content (a laid-out canvas/svg or real text); the parent only accepts
    // paint-ok when it does.
    const script = buildExtAppBootBeaconScript('frame-token', 'node-9');
    expect(script).toContain('function contentReady()');
    expect(script).toContain("querySelectorAll('canvas, svg')");
    expect(script).toContain('getBoundingClientRect');
    expect(script).toContain('innerText');
    expect(script).toContain('content: contentReady()');
  });
});

describe('ExtAppFrame AX bridge', () => {
  test('injects a Promise-returning emit bridge with ack correlation', () => {
    const script = buildExtAppAxBridgeScript('ax-token', 'node-1');

    expect(script).toContain('window.PMX_AX.emit = function');
    expect(script).toContain('return new Promise');
    expect(script).toContain('correlationId');
    expect(script).toContain("m.source !== 'pmx-canvas-ax-ack'");
    expect(script).toContain('pmx-ax-ack');
    expect(script).toContain('ax-ack-timeout');
  });

  test('places the bridge before authored body content so early clicks can self-confirm', () => {
    const script = buildExtAppAxBridgeScript('ax-token', 'node-1');
    const html = '<!doctype html><html><head><title>App</title></head><body><button>emit</button></body></html>';
    const injected = injectExtAppAxBridgeScript(html, script);

    expect(injected.indexOf('data-pmx-canvas-ax-bridge')).toBeGreaterThan(injected.indexOf('<head>'));
    expect(injected.indexOf('data-pmx-canvas-ax-bridge')).toBeLessThan(injected.indexOf('<body>'));
  });
});

describe('ExtAppFrame iframe lifetime', () => {
  test('does not remount the iframe when only node size changes', () => {
    const node: CanvasNodeState = {
      id: 'ext-app-key',
      type: 'mcp-app',
      position: { x: 0, y: 0 },
      size: { width: 500, height: 260 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: {
        html: '<main>app</main>',
        serverName: 'Fixture',
        appSessionId: 'session-1',
        sessionStatus: 'ready',
      },
    };

    const resized = {
      ...node,
      size: { width: 640, height: 420 },
    };

    expect(getExtAppBridgeInitKey(node, 0)).toBe(getExtAppBridgeInitKey(resized, 0));
    expect(getExtAppBridgeInitKey(node, 1)).not.toBe(getExtAppBridgeInitKey(resized, 0));
  });
});

describe('ExtAppFrame host sizing', () => {
  test('reports fixed iframe dimensions to apps that require a real fullscreen height', () => {
    const target = {
      getBoundingClientRect: () => ({ width: 940, height: 700 }),
    };

    expect(resolveExtAppContainerDimensions(target, { width: 720, height: 500 })).toEqual({
      width: 940,
      height: 700,
    });
  });

  test('uses untransformed layout dimensions when the canvas viewport is zoomed', () => {
    const target = {
      clientWidth: 940,
      clientHeight: 700,
      getBoundingClientRect: () => ({ width: 470, height: 350 }),
    };

    expect(resolveExtAppContainerDimensions(target, { width: 720, height: 500 })).toEqual({
      width: 940,
      height: 700,
    });
  });

  test('falls back to node geometry when layout has not measured the iframe yet', () => {
    const target = {
      getBoundingClientRect: () => ({ width: 0, height: 0 }),
    };

    expect(resolveExtAppContainerDimensions(target, { width: 720, height: 500 })).toEqual({
      width: 720,
      height: 500,
    });
  });

  test('ignores app resize notifications while the host owns fullscreen sizing', () => {
    expect(shouldApplyExtAppSizeChange(480, false)).toBe(true);
    expect(shouldApplyExtAppSizeChange(480, true)).toBe(false);
    expect(shouldApplyExtAppSizeChange(0, false)).toBe(false);
  });

  test('does not let app resize notifications shrink below the host frame', () => {
    expect(resolveExtAppInlineFrameHeight(420, 760)).toBe(760);
    expect(resolveExtAppInlineFrameHeight(900, 760)).toBe(900);
  });
});
