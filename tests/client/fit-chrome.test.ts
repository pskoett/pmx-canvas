/**
 * Fit reserves the floating chrome's screen space (0.5.0 Amp report, finding
 * A): the old world-space padding shrank with the fit zoom and parked fitted
 * nodes under the command bar and minimap. These pin the screen-space
 * contract: measured insets, and fitted nodes clear of the reserved band.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { canvasFitInsets, registerCanvasArea } from '../../src/client/canvas/canvas-area.ts';
import { fitAll, focusNode, nodes, setViewport, viewport } from '../../src/client/state/canvas-store.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

function stubChrome(selector: string, rect: { top: number; height: number }): HTMLElement {
  const el = document.createElement('div');
  el.className = selector.replace(/^\./, '');
  el.getBoundingClientRect = () =>
    ({
      top: rect.top,
      bottom: rect.top + rect.height,
      left: 0,
      right: 100,
      width: 100,
      height: rect.height,
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

function node(id: string, x: number, y: number, width = 400, height = 300): CanvasNodeState {
  return {
    id,
    type: 'markdown',
    position: { x, y },
    size: { width, height },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data: {},
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  registerCanvasArea(null);
  nodes.value = new Map();
});

describe('canvasFitInsets', () => {
  test('chromeless: symmetric 16px defaults', () => {
    expect(canvasFitInsets()).toEqual({ top: 16, right: 16, bottom: 16, left: 16 });
  });

  test('reserves the tallest bottom overlay (command bar vs minimap), plus a gap', () => {
    const area = document.createElement('div');
    area.getBoundingClientRect = () =>
      ({ top: 0, left: 0, width: 1280, height: 577, right: 1280, bottom: 577 }) as DOMRect;
    document.body.appendChild(area);
    registerCanvasArea(area);
    // Amp's failing geometry: command bar bottom band ~90px tall, minimap ~110px.
    stubChrome('.command-bar', { top: 487, height: 90 });
    stubChrome('.minimap', { top: 467, height: 110 });
    const insets = canvasFitInsets();
    expect(insets.bottom).toBe(577 - 467 + 12); // tallest overlap + 12 gap
    expect(insets.top).toBe(16);
  });
});

describe('focusNode respects the reserved band', () => {
  // 0.5.1 Amp finding C: the mcp-app open flow focuses the new 960×600 node,
  // and the old focusNode centred it on the WINDOW-coordinate area centre at
  // the current scale — parking its resize corner under the command bar. The
  // contract is the observable: the whole node rect lands inside the usable
  // band (container-relative), shrinking the scale when it must.
  test('a node taller than the usable rect is shrunk clear of the bottom chrome', () => {
    const area = document.createElement('div');
    area.getBoundingClientRect = () =>
      ({ top: 44, left: 52, width: 1228, height: 676, right: 1280, bottom: 720 }) as DOMRect;
    document.body.appendChild(area);
    registerCanvasArea(area);
    // Command bar overlapping the area bottom by 56px → bottom inset 68.
    stubChrome('.command-bar', { top: 664, height: 90 });

    const app = node('app', 300, 900, 960, 600);
    nodes.value = new Map([[app.id, app]]);
    setViewport({ x: 0, y: 0, scale: 1 });
    focusNode('app');

    return new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 2_000;
      const check = () => {
        const v = viewport.value;
        const insets = canvasFitInsets();
        const left = app.position.x * v.scale + v.x;
        const top = app.position.y * v.scale + v.y;
        const right = (app.position.x + app.size.width) * v.scale + v.x;
        const bottom = (app.position.y + app.size.height) * v.scale + v.y;
        const inside =
          left >= insets.left - 0.5 &&
          top >= insets.top - 0.5 &&
          right <= 1228 - insets.right + 0.5 &&
          bottom <= 676 - insets.bottom + 0.5;
        // Shrink only as much as needed — never a gratuitous zoom-out.
        if (inside && v.scale > 0.8 && v.scale <= 1) return resolve();
        if (Date.now() > deadline)
          return reject(new Error(`focus left the node under the chrome: viewport=${JSON.stringify(v)}`));
        setTimeout(check, 25);
      };
      check();
    });
  });

  test('a node that already fits keeps the current scale', () => {
    const area = document.createElement('div');
    area.getBoundingClientRect = () =>
      ({ top: 44, left: 52, width: 1228, height: 676, right: 1280, bottom: 720 }) as DOMRect;
    document.body.appendChild(area);
    registerCanvasArea(area);

    const small = node('small', 2000, -500, 300, 200);
    nodes.value = new Map([[small.id, small]]);
    setViewport({ x: 0, y: 0, scale: 0.75 });
    focusNode('small');

    return new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 2_000;
      const check = () => {
        const v = viewport.value;
        const centreX = (small.position.x + small.size.width / 2) * v.scale + v.x;
        // Centre of the usable rect, container-relative: 16 + (1228-32)/2.
        const expectedX = 16 + (1228 - 32) / 2;
        if (v.scale === 0.75 && Math.abs(centreX - expectedX) < 0.5) return resolve();
        if (Date.now() > deadline)
          return reject(new Error(`focus mis-centred the node: viewport=${JSON.stringify(v)}`));
        setTimeout(check, 25);
      };
      check();
    });
  });
});

describe('fitAll respects the reserved band', () => {
  test('no fitted node intersects the bottom chrome reserve (Amp finding A)', () => {
    const area = document.createElement('div');
    area.getBoundingClientRect = () =>
      ({ top: 0, left: 0, width: 1280, height: 577, right: 1280, bottom: 577 }) as DOMRect;
    document.body.appendChild(area);
    registerCanvasArea(area);
    stubChrome('.command-bar', { top: 487, height: 90 });
    stubChrome('.minimap', { top: 467, height: 110 });

    // Four spread-out surface nodes, like the report's scenario.
    nodes.value = new Map(
      [node('a', 0, 0), node('b', 900, 0), node('c', 0, 700), node('d', 900, 700)].map((n) => [n.id, n]),
    );
    fitAll(1280, 577);
    // Fit animates toward a deterministic target over ~300ms of rAF ticks —
    // poll the viewport signal until the settled frame satisfies the contract.
    return new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 2_000;
      const check = () => {
        const v = viewport.value;
        const chromeTop = 467; // top edge of the tallest bottom overlay
        const allAbove = [...nodes.value.values()].every(
          (n) => (n.position.y + n.size.height) * v.scale + v.y <= chromeTop + 0.5,
        );
        const allVisible = [...nodes.value.values()].every(
          (n) =>
            n.position.x * v.scale + v.x >= 0 &&
            (n.position.x + n.size.width) * v.scale + v.x <= 1280 &&
            n.position.y * v.scale + v.y >= 0,
        );
        if (allAbove && allVisible) return resolve();
        if (Date.now() > deadline)
          return reject(new Error(`fit left nodes under the chrome: viewport=${JSON.stringify(v)}`));
        setTimeout(check, 25);
      };
      check();
    });
  });
});
