import { describe, expect, test } from 'bun:test';
import {
  buildExtAppAxBridgeScript,
  buildExtAppSurfaceBaseStyles,
  injectExtAppAxBridgeScript,
  resolveExtAppContainerDimensions,
  resolveExtAppDisplayModeRequest,
  shouldApplyExtAppSizeChange,
} from '../../src/client/nodes/ExtAppFrame.tsx';

describe('ExtAppFrame display mode requests', () => {
  test('expands into focus mode instead of resizing the backing node', () => {
    expect(resolveExtAppDisplayModeRequest('fullscreen', false)).toEqual({
      nextMode: 'fullscreen',
      shouldExpand: true,
      shouldCollapse: false,
    });
    expect(resolveExtAppDisplayModeRequest('fullscreen', true)).toEqual({
      nextMode: 'fullscreen',
      shouldExpand: false,
      shouldCollapse: false,
    });
    expect(resolveExtAppDisplayModeRequest('inline', true)).toEqual({
      nextMode: 'inline',
      shouldExpand: false,
      shouldCollapse: true,
    });
    expect(resolveExtAppDisplayModeRequest('pip', false)).toEqual({
      nextMode: 'pip',
      shouldExpand: false,
      shouldCollapse: false,
    });
  });
});

describe('ExtAppFrame sandbox and AX bridge', () => {
  test('injects a Promise-returning emit bridge with ack correlation before authored content', () => {
    const script = buildExtAppAxBridgeScript('ax-token', 'node-1');
    expect(script).toContain('window.PMX_AX.emit = function');
    expect(script).toContain('return new Promise');
    expect(script).toContain('correlationId');
    expect(script).toContain("m.source !== 'pmx-canvas-ax-ack'");
    expect(script).toContain('pmx-ax-ack');
    expect(script).toContain('ax-ack-timeout');
    const html = '<!doctype html><html><head><title>App</title></head><body><button>emit</button></body></html>';
    const injected = injectExtAppAxBridgeScript(html, script);
    expect(injected.indexOf('data-pmx-canvas-ax-bridge')).toBeGreaterThan(injected.indexOf('<head>'));
    expect(injected.indexOf('data-pmx-canvas-ax-bridge')).toBeLessThan(injected.indexOf('<body>'));
  });
  test('leaves the host responsible for the app background', () => {
    const styles = buildExtAppSurfaceBaseStyles();
    expect(styles).toContain('background: var(--c-panel, transparent) !important');
    const injected = injectExtAppAxBridgeScript('<head><title>t</title></head><body>app</body>', styles);
    expect(injected.indexOf('data-pmx-canvas-ext-app-base')).toBeGreaterThan(injected.indexOf('<head>'));
    expect(injected.indexOf('data-pmx-canvas-ext-app-base')).toBeLessThan(injected.indexOf('<body>'));
  });
});

describe('ExtAppFrame iframe lifetime and sizing', () => {
  test('reports actual layout dimensions with a geometry fallback before layout', () => {
    expect(
      resolveExtAppContainerDimensions(
        { getBoundingClientRect: () => ({ width: 940, height: 700 }) },
        { width: 720, height: 500 },
      ),
    ).toEqual({ width: 940, height: 700 });
    expect(
      resolveExtAppContainerDimensions(
        { clientWidth: 940, clientHeight: 700, getBoundingClientRect: () => ({ width: 470, height: 350 }) },
        { width: 720, height: 500 },
      ),
    ).toEqual({ width: 940, height: 700 });
    expect(
      resolveExtAppContainerDimensions(
        { getBoundingClientRect: () => ({ width: 0, height: 0 }) },
        { width: 720, height: 500 },
      ),
    ).toEqual({ width: 720, height: 500 });
  });
  test('ignores app resize notifications while the host owns fullscreen sizing', () => {
    expect(shouldApplyExtAppSizeChange(480, false)).toBe(true);
    expect(shouldApplyExtAppSizeChange(480, true)).toBe(false);
    expect(shouldApplyExtAppSizeChange(0, false)).toBe(false);
  });
});
