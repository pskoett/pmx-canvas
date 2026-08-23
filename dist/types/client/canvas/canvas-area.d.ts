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
export declare function registerCanvasArea(el: HTMLElement | null): void;
export declare function canvasArea(): CanvasAreaRect;
/** Screen-space centre of the canvas region — the anchor for centred zoom/focus. */
export declare function canvasAreaCenter(): {
    x: number;
    y: number;
};
