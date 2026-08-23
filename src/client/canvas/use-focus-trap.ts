import { useEffect } from 'preact/hooks';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus trap for modal overlays (rail-chrome-v2 item 18): while `active`, Tab
 * cycles inside `ref`, the first focusable takes focus on open unless
 * `initial` names one, and the element focused before the overlay opened gets
 * focus back on close.
 */
export function useFocusTrap(
  ref: { current: HTMLElement | null },
  active: boolean,
  options: { initial?: { current: HTMLElement | null }; restoreTo?: () => HTMLElement | null } = {},
): void {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const restoreTo = options.restoreTo;
    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    const initial = options.initial?.current ?? focusables()[0];
    if (initial && !root.contains(document.activeElement)) initial.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (current === first || !root.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      // `restoreTo` wins: an overlay that replaced the element it was opened
      // from (focus mode unmounts the node while expanded) names the element
      // to return to, which may only exist after the next frame.
      if (restoreTo) {
        requestAnimationFrame(() => restoreTo()?.focus());
      } else if (previous && document.contains(previous) && previous !== document.body) {
        previous.focus();
      }
    };
  }, [ref, active, options.initial, options.restoreTo]);
}
