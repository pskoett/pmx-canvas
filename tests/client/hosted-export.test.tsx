import { openNodeAsSite } from '../../src/client/nodes/surface-url';
import { attentionToast } from '../../src/client/state/attention-store';
import { resetAttentionBridge } from '../../src/client/state/attention-bridge';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { ExportDialog, exportDialogOpen } from '../../src/client/canvas/ExportDialog';
import { activeBoardId } from '../../src/client/state/boards-store';
import { installWorkbenchDownload, installWorkbenchTransport } from '../../src/client/state/workbench-transport';

const manifest = {
  boardId: 'test',
  boardName: 'Test',
  cards: 1,
  connections: 0,
  frames: 0,
  placeholders: [],
  files: [],
  attachments: [],
  sourceDerivedCards: [],
  embeddedImages: 0,
  remoteImages: [],
  links: [],
  frameNetworkDestinations: [],
  embeddedCodeCanAccessNetwork: false,
};
const url = '/api/canvas/exports/test.html';
const html = '<!doctype html><title>Exported board</title><p>Sentinel</p>';
beforeEach(() => resetAttentionBridge());
afterEach(() => {
  resetAttentionBridge();
  cleanup();
  exportDialogOpen.value = false;
  activeBoardId.value = null;
  installWorkbenchTransport(undefined);
  installWorkbenchDownload(undefined);
});

async function exportedDialog() {
  installWorkbenchTransport(async (input, init) => {
    if (String(input) === url) return new Response(html);
    if (init?.method === 'POST')
      return Response.json({ path: '/workspace/exports/test.html', url, bytes: html.length });
    return Response.json({ manifest });
  });
  activeBoardId.value = 'test';
  exportDialogOpen.value = true;
  const view = render(<ExportDialog />);
  await waitFor(() => expect(view.getByText('Export').hasAttribute('disabled')).toBe(false));
  await act(async () => {
    fireEvent.click(view.getByText('Export'));
  });
  await waitFor(() => expect(view.getByText('Download')).toBeTruthy());
  return view;
}

test('hosted export downloads actual HTML via host and never links to sandbox origin', async () => {
  const downloads: Array<{ name: string; mimeType: string; text: string }> = [];
  installWorkbenchDownload(async (file) => {
    downloads.push(file);
    return {};
  });
  const view = await exportedDialog();
  expect(view.container.querySelector('a')).toBeNull();
  await act(async () => {
    fireEvent.click(view.getByText('Download'));
  });
  expect(downloads).toEqual([{ name: 'test.html', mimeType: 'text/html', text: html }]);
});

test('hosted export explains unsupported host download capability', async () => {
  const view = await exportedDialog();
  await act(async () => {
    fireEvent.click(view.getByText('Download'));
  });
  expect(view.getByRole('alert').textContent).toContain('host does not support downloads');
});

test('hosted export reports host cancellation', async () => {
  installWorkbenchDownload(async () => ({ isError: true }));
  const view = await exportedDialog();
  await act(async () => {
    fireEvent.click(view.getByText('Download'));
  });
  await waitFor(() => expect(view.getByRole('alert').textContent).toContain('cancelled or declined'));
});

test('hosted Open as site explains local-only surfaces without opening a broken URL', async () => {
  let requested = false;
  installWorkbenchTransport(async () => {
    requested = true;
    return Response.json({ ok: false });
  });
  await openNodeAsSite({
    id: 'html-node',
    type: 'html',
    data: { content: '<p>Sentinel</p>' },
    position: { x: 0, y: 0 },
    size: { width: 300, height: 200 },
    zIndex: 0,
    pinned: false,
    collapsed: false,
  });
  expect(requested).toBe(false);
  expect(attentionToast.value?.detail).toContain('no public URL');
  resetAttentionBridge();
});
