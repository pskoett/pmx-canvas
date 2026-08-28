/**
 * The canvas region's box in screen coordinates. With the rail + top-bar shell
 * the canvas no longer spans the window, so every "centre of the view" and
 * "how big is the view" computation must use this region — anchoring zoom at
 * `window.innerWidth / 2` would drift the board toward the rail on every step,
 * and reporting the window to the server makes an agent `fit` compute a scale
 * that hides nodes under the chrome.
 *
 * The shell registers its canvas-region element on mount; everything else asks
 * for the rect. The window fallback keeps unit tests and any chromeless embed
 * working unchanged.
 */

export interface CanvasAreaRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

let canvasAreaEl: HTMLElement | null = null;

export function registerCanvasArea(el: HTMLElement | null): void {
  canvasAreaEl = el;
}

export function canvasArea(): CanvasAreaRect {
  if (canvasAreaEl?.isConnected) {
    const rect = canvasAreaEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }
  }
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

/** Screen-space centre of the canvas region — the anchor for centred zoom/focus. */
export function canvasAreaCenter(): { x: number; y: number } {
  const rect = canvasArea();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export interface CanvasFitInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Screen-space insets Fit must reserve for the floating chrome that overlays
 * the canvas region: the bottom command bar (whose pinned-chip row grows it)
 * and the bottom-right minimap. Measured from the live elements — fit's old
 * world-space padding shrank with the fit zoom and parked nodes underneath
 * both (0.5.0 Amp report, finding A; architecture rule 9's trap).
 */
export function canvasFitInsets(): CanvasFitInsets {
  let bottom = 16;
  try {
    const area = canvasArea();
    const areaBottom = area.top + area.height;
    for (const selector of ['.command-bar', '.minimap']) {
      const el = document.querySelector(selector);
      if (!(el instanceof HTMLElement) || !el.isConnected) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) continue;
      const overlap = areaBottom - rect.top;
      if (overlap > 0) bottom = Math.max(bottom, overlap + 12);
    }
  } catch {
    // Chromeless embeds and unit DOMs: the defaults below are the contract.
  }
  return { top: 16, right: 16, bottom, left: 16 };
}
