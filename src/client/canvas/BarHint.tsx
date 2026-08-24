import type { ComponentChildren } from 'preact';

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
  children: ComponentChildren;
}) {
  return (
    <span
      class={`toolbar-tooltip-anchor toolbar-tooltip-anchor-${align}${side === 'up' ? ' toolbar-tooltip-anchor-up' : ''}${tapToOpen ? ' toolbar-tooltip-anchor-tap' : ''}`}
      tabIndex={tapToOpen ? -1 : undefined}
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
