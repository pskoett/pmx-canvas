import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { ToolRail } from '../../src/client/canvas/ToolRail.tsx';

function renderRail() {
  return render(
    <ToolRail
      minimapVisible={true}
      onToggleMinimap={() => {}}
      snapshotOpen={false}
      onToggleSnapshot={() => {}}
      snapshotBtnRef={{ current: null }}
      onOpenPalette={() => {}}
      onOpenShortcuts={() => {}}
      annotationTool={null}
      onSetAnnotationTool={() => {}}
    />,
  );
}

afterEach(cleanup);

// The rail is the shortcut discovery surface. A native `title` shows only
// after a hover delay and not at all in some embedded browser panes, and the
// rail's scroll clip would swallow a CSS-only tooltip — so the rail renders
// its own, fixed beside the hovered button.
describe('tool rail tooltips', () => {
  test('hover shows the label with the shortcut as a key cap; leaving hides it', () => {
    const { getByRole, queryByTestId } = renderRail();
    expect(queryByTestId('rail-tooltip')).toBeNull();
    const group = getByRole('button', { name: 'Group (G)' });
    expect(group.getAttribute('title')).toBeNull();

    fireEvent.pointerEnter(group);
    const tip = queryByTestId('rail-tooltip')!;
    expect(tip.querySelector('.toolbar-tooltip-label')?.textContent).toBe('Group');
    expect(tip.querySelector('kbd')?.textContent).toBe('G');

    fireEvent.pointerLeave(group);
    expect(queryByTestId('rail-tooltip')).toBeNull();
  });

  test('a menu button says what is inside it — shortcut key cap AND the item list', () => {
    const { getByRole, queryByTestId } = renderRail();
    fireEvent.pointerEnter(getByRole('button', { name: 'Annotate (A)' }));
    const tip = queryByTestId('rail-tooltip')!;
    expect(tip.querySelector('kbd')?.textContent).toBe('A');
    expect(tip.querySelector('.toolbar-tooltip-meta')?.textContent).toContain('Draw · Text note · Eraser');
  });

  test('keyboard focus shows it too; a detail (not a shortcut) renders as plain text', () => {
    const { getByRole, queryByTestId } = renderRail();
    fireEvent.focus(getByRole('button', { name: 'Arrange (grid)' }));
    const tip = queryByTestId('rail-tooltip')!;
    expect(tip.querySelector('.toolbar-tooltip-label')?.textContent).toBe('Arrange');
    expect(tip.querySelector('kbd')).toBeNull();
    expect(tip.querySelector('.toolbar-tooltip-meta')?.textContent).toBe('grid');
    fireEvent.blur(getByRole('button', { name: 'Arrange (grid)' }));
    expect(queryByTestId('rail-tooltip')).toBeNull();
  });

  test('opening a button’s own menu hides its tooltip instead of stacking on the menu', () => {
    const { getByRole, queryByTestId } = renderRail();
    const theme = getByRole('button', { name: 'Choose theme' });
    fireEvent.pointerEnter(theme);
    expect(queryByTestId('rail-tooltip')?.textContent).toContain('Theme');
    fireEvent.click(theme);
    expect(getByRole('menu', { name: 'Theme' })).toBeTruthy();
    fireEvent.pointerEnter(theme);
    expect(queryByTestId('rail-tooltip')).toBeNull();
  });

  test('accessible names keep the "Label (Shortcut)" form', () => {
    const { getByRole } = renderRail();
    for (const name of ['Select (V)', 'Pan (Space)', 'Markdown note (M)', 'File (Shift+F)', 'Shortcuts (?)']) {
      expect(getByRole('button', { name })).toBeTruthy();
    }
  });
});
