import { afterEach, expect, mock, test } from 'bun:test';
import { cleanup, render } from '@testing-library/preact';
import { ShortcutOverlay } from '../../src/client/canvas/ShortcutOverlay.tsx';
import { ToolRail } from '../../src/client/canvas/ToolRail.tsx';
import { installWorkbenchTransport } from '../../src/client/state/workbench-transport.ts';
import { undoFromKeyboard } from '../../src/client/state/session-store.ts';
import { attentionHistory } from '../../src/client/state/attention-store.ts';

afterEach(() => {
  cleanup();
  installWorkbenchTransport(undefined);
});

test('hosted controls explain unavailable history and omit local trace capture', async () => {
  const transport = mock(async () => new Response('{}'));
  installWorkbenchTransport(transport);
  const rail = render(
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
  expect(rail.queryByRole('button', { name: 'Enable trace' }) === null).toBe(true);
  expect(rail.queryByRole('button', { name: 'Clear trace' }) === null).toBe(true);
  const shortcuts = render(<ShortcutOverlay onClose={() => {}} />);
  expect(shortcuts.getByText('Undo / redo — available in the local workbench only')).toBeTruthy();
  expect(await undoFromKeyboard()).toBe(false);
  expect(transport).not.toHaveBeenCalled();
  expect(attentionHistory.value.some((entry) => entry.title === 'Undo / redo unavailable')).toBe(true);
});
