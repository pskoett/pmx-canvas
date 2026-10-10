import { render, type ComponentChildren, type VNode } from 'preact';
import { useLayoutEffect, useMemo, useState } from 'preact/hooks';

/** Escape a bar's filter/clip without installing React-compat event hooks. */
export function BarPortal({ children }: { children: VNode }) {
  const host = useMemo(() => document.createElement('div'), []);
  useLayoutEffect(() => {
    document.body.appendChild(host);
    return () => {
      render(null, host);
      host.remove();
    };
  }, [host]);
  useLayoutEffect(() => render(children, host), [children, host]);
  return null;
}

/**
 * Styled hover/focus tooltip for bar controls — the replacement for native
 * `title` hints, which are delay-gated and never render in embedded panes.
 */
export function BarHint({
  label,
  shortcut,
  body,
  align = 'center',
  side = 'down',
  tapToOpen = false,
  fitWithin,
  children,
}: {
  label: string;
  shortcut?: string;
  /** One or two plain sentences under the label — the explanation a native `title` used to hide. */
  body?: string;
  align?: 'start' | 'center' | 'end';
  /** Which way the tooltip opens. Bars at the bottom of the region open 'up'. */
  side?: 'down' | 'up';
  /**
   * Informational (non-button) content: a click/focus opens the tooltip, so
   * surfaces that do not forward hover (embedded panes, touch) still reach
   * the explanation. Never for action buttons — their tooltips must dismiss
   * after the click, not linger on focus.
   */
  tapToOpen?: boolean;
  /**
   * The clipping box to stay inside (a CSS selector for an ancestor). As the
   * tooltip opens it takes whichever of end/start alignment fits — a node
   * header chip sits anywhere along a card that clips its contents.
   */
  fitWithin?: string;
  children: ComponentChildren;
}) {
  const [fitted, setFitted] = useState<'start' | 'end' | null>(null);
  const fit = (event: Event) => {
    if (!fitWithin) return;
    const anchor = event.currentTarget as HTMLElement;
    const box = anchor.closest(fitWithin)?.getBoundingClientRect();
    const tip = anchor.querySelector('.toolbar-tooltip')?.getBoundingClientRect();
    if (!box || !tip) return;
    const self = anchor.getBoundingClientRect();
    // Opening from the anchor's right edge leftwards (end) or its left edge rightwards (start).
    const endFits = self.right - tip.width >= box.left;
    const startFits = self.left + tip.width <= box.right;
    setFitted(endFits || !startFits ? 'end' : 'start');
  };
  const placed = fitted ?? align;
  return (
    <span
      class={`toolbar-tooltip-anchor toolbar-tooltip-anchor-${placed}${side === 'up' ? ' toolbar-tooltip-anchor-up' : ''}${tapToOpen ? ' toolbar-tooltip-anchor-tap' : ''}`}
      tabIndex={tapToOpen ? -1 : undefined}
      onPointerEnter={fitWithin ? fit : undefined}
      onFocusIn={fitWithin ? fit : undefined}
    >
      {children}
      <span class="toolbar-tooltip" role="tooltip">
        <span class="toolbar-tooltip-label">{label}</span>
        {body && <span class="toolbar-tooltip-body">{body}</span>}
        {shortcut && (
          <span class="toolbar-tooltip-meta">
            <kbd class="toolbar-tooltip-shortcut">{shortcut}</kbd>
          </span>
        )}
      </span>
    </span>
  );
}
