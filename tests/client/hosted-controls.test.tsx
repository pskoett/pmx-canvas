import { afterEach, expect, mock, test } from 'bun:test';
import { cleanup, render } from '@testing-library/preact';
import { ShortcutOverlay } from '../../src/client/canvas/ShortcutOverlay.tsx';
import { ToolRail } from '../../src/client/canvas/ToolRail.tsx';
import { ImageNode } from '../../src/client/nodes/ImageNode.tsx';
import { installWorkbenchTransport } from '../../src/client/state/workbench-transport.ts';
import { undoFromKeyboard } from '../../src/client/state/session-store.ts';
import { attentionHistory } from '../../src/client/state/attention-store.ts';

afterEach(() => {
  cleanup();
  installWorkbenchTransport(undefined);
});

test('a hosted image whose asset read fails shows its error instead of loading forever', async () => {
  installWorkbenchTransport(mock(async () => new Response('', { status: 500 })));
  const view = render(
    <ImageNode
      node={{
        id: 'hosted-image',
        type: 'image',
        position: { x: 0, y: 0 },
        size: { width: 300, height: 200 },
        zIndex: 1,
        collapsed: false,
        pinned: false,
        data: { src: 'diagram.png' },
      }}
    />,
  );
  expect(await view.findByText('Failed to load image')).toBeTruthy();
  expect(view.queryByText('Loading…')).toBeNull();
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
