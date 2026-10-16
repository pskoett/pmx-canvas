/** Overlays and text editors get Escape before the underlying view selection. */
export function isSelectionEscape(event: KeyboardEvent): boolean {
  const target = event.target instanceof HTMLElement ? event.target : null;
  return (
    event.key === 'Escape' &&
    !event.defaultPrevented &&
    !target?.closest('input, textarea, [contenteditable="true"]') &&
    !document.querySelector('[role="dialog"], [role="menu"], .context-menu, .shortcut-overlay-backdrop')
  );
}
