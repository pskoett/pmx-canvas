/**
 * Focus trap for modal overlays (rail-chrome-v2 item 18): while `active`, Tab
 * cycles inside `ref`, the first focusable takes focus on open unless
 * `initial` names one, and the element focused before the overlay opened gets
 * focus back on close.
 */
export declare function useFocusTrap(ref: {
    current: HTMLElement | null;
}, active: boolean, options?: {
    initial?: {
        current: HTMLElement | null;
    };
    restoreTo?: () => HTMLElement | null;
}): void;
