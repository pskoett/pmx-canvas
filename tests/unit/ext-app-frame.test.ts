import { describe, expect, test } from 'bun:test';
import {
  getExtAppBridgeInitKey,
  resolveExtAppContainerDimensions,
  resolveExtAppDisplayModeRequest,
  resolveExtAppInlineFrameHeight,
  resolveExtAppSandbox,
  shouldApplyExtAppSizeChange,
} from '../../src/client/nodes/ExtAppFrame.tsx';
import type { CanvasNodeState } from '../../src/client/types.ts';

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
      dockPosition: null,
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
