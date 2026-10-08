import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { ToolRail } from '../../src/client/canvas/ToolRail.tsx';

function renderRail(annotationTool: 'pen' | 'text' | 'eraser' | null = null, onSetAnnotationTool = mock(() => {})) {
  return render(
    <ToolRail
      minimapVisible={true}
      onToggleMinimap={() => {}}
      snapshotOpen={false}
      onToggleSnapshot={() => {}}
      snapshotBtnRef={{ current: null }}
      onOpenPalette={() => {}}
      onOpenShortcuts={() => {}}
      annotationTool={annotationTool}
      onSetAnnotationTool={onSetAnnotationTool}
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

  test('annotation tools are directly discoverable, with Draw’s shortcut', () => {
    const { getByRole, queryByTestId } = renderRail();
    fireEvent.pointerEnter(getByRole('button', { name: 'Draw (A)' }));
    const tip = queryByTestId('rail-tooltip')!;
    expect(tip.querySelector('kbd')?.textContent).toBe('A');
    expect(getByRole('button', { name: 'Text note', exact: true })).toBeTruthy();
    expect(getByRole('button', { name: 'Eraser', exact: true })).toBeTruthy();
  });

  test('each annotation button selects its tool and toggles off when active', () => {
    for (const [name, tool] of [
      ['Draw (A)', 'pen'],
      ['Text note', 'text'],
      ['Eraser', 'eraser'],
    ] as const) {
      const change = mock(() => {});
      const inactive = renderRail(null, change);
      fireEvent.click(inactive.getByRole('button', { name, exact: true }));
      expect(change).toHaveBeenLastCalledWith(tool);
      cleanup();
      const active = renderRail(tool, change);
      const button = active.getByRole('button', { name, exact: true });
      expect(button.getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(button);
      expect(change).toHaveBeenLastCalledWith(null);
      cleanup();
    }
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
    const settings = getByRole('button', { name: 'Settings', exact: true });
    fireEvent.pointerEnter(settings);
    expect(queryByTestId('rail-tooltip')?.textContent).toContain('Settings');
    fireEvent.click(settings);
    expect(getByRole('menu', { name: 'Settings' })).toBeTruthy();
    fireEvent.pointerEnter(settings);
    expect(queryByTestId('rail-tooltip')).toBeNull();
  });

  // docs/design/Chrome.dc.html §7: twelve tools (plus the eraser), then one
  // Settings menu, so a 690 px window never cuts the rail off.
  test('rarely used tools live in one Settings menu', () => {
    const toggles = { minimap: mock(() => {}), snapshot: mock(() => {}), shortcuts: mock(() => {}) };
    const { getByRole, queryByRole, getByText } = render(
      <ToolRail
        minimapVisible={false}
        onToggleMinimap={toggles.minimap}
        snapshotOpen={false}
        onToggleSnapshot={toggles.snapshot}
        snapshotBtnRef={{ current: null }}
        onOpenPalette={() => {}}
        onOpenShortcuts={toggles.shortcuts}
        annotationTool={null}
        onSetAnnotationTool={() => {}}
      />,
    );
    for (const gone of ['Bug and feedback', 'Snapshots', 'Choose theme', 'Shortcuts (?)', 'Show minimap']) {
      expect(queryByRole('button', { name: gone, exact: true })).toBeNull();
    }
    const settings = getByRole('button', { name: 'Settings', exact: true });
    fireEvent.click(settings);
    const menu = getByRole('menu', { name: 'Settings' });
    expect([...menu.querySelectorAll('[role^=menuitem]')].map((item) => item.firstElementChild?.textContent)).toEqual([
      'Theme',
      'Snapshots',
      'Minimap',
      'Keyboard shortcuts',
      'Trace',
      'Send feedback',
    ]);
    expect(getByRole('menuitemcheckbox', { name: /Minimap/ }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(getByRole('menuitemcheckbox', { name: /Minimap/ }));
    expect(toggles.minimap).toHaveBeenCalledTimes(1);
    expect(queryByRole('menu')).toBeNull();

    fireEvent.click(settings);
    fireEvent.click(getByText('Theme'));
    expect(getByRole('menu', { name: 'Theme' }).querySelectorAll('[role=menuitemradio]').length).toBe(9);
    fireEvent.click(getByText('‹ Settings'));
    fireEvent.click(getByText('Snapshots'));
    expect(toggles.snapshot).toHaveBeenCalledTimes(1);
    fireEvent.click(settings);
    fireEvent.click(getByText('Keyboard shortcuts'));
    expect(toggles.shortcuts).toHaveBeenCalledTimes(1);
  });

  test('accessible names keep the "Label (Shortcut)" form', () => {
    const { getByRole } = renderRail();
    for (const name of ['Select (V)', 'Pan (Space)', 'Markdown note (M)', 'Webpage (W)', 'Arrange (grid)']) {
      expect(getByRole('button', { name })).toBeTruthy();
    }
  });

  test('one attachment control replaces file, image and HTML buttons and explains the supported formats', () => {
    const { getByRole, queryByRole, getByLabelText } = renderRail();
    for (const name of ['File (Shift+F)', 'Image (I)', 'HTML surface (H)']) {
      expect(queryByRole('button', { name })).toBeNull();
    }
    const attach = getByRole('button', { name: 'Attach files', exact: true });
    fireEvent.focus(attach);
    const tooltip = getByRole('tooltip');
    for (const format of [
      'PNG',
      'JPEG',
      'SVG',
      'Markdown',
      'text/code',
      'PDF',
      'Word',
      'Excel',
      'PowerPoint',
      'OpenDocument',
    ]) {
      expect(tooltip.textContent).toContain(format);
    }
    expect(tooltip.textContent).toContain('agent import with review');
    const picker = getByLabelText('Attach files', { selector: 'input' });
    expect(picker.hasAttribute('multiple')).toBe(true);
    expect(picker.hasAttribute('accept')).toBe(false);
  });
});
