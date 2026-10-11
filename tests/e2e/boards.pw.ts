/**
 * Many boards in the workbench (plan 012): the top-bar switcher, Home, and the
 * in-place delete confirm — asserted on what the human sees.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let HUMAN: Record<string, string>;

test.beforeEach(async ({ request }) => {
  const html = await (await request.get('/workbench')).text();
  const encoded = html.match(/window\.__PMX_WORKBENCH_TOKEN = ("[^"]+")/)?.[1];
  if (!encoded) throw new Error('Workbench token was not present in served HTML.');
  HUMAN = {
    'x-pmx-workbench': '1',
    'x-pmx-workbench-token': JSON.parse(encoded) as string,
  };
  // Each test (and retry) owns its library; names must not match stale boards.
  for (const board of (await boards(request)).boards) {
    expect((await request.delete(`/api/canvas/boards/${board.id}`, { headers: HUMAN })).ok()).toBe(true);
  }
});

async function boards(request: APIRequestContext) {
  return (await (await request.get('/api/canvas/boards')).json()) as {
    activeBoardId: string | null;
    boards: Array<{ id: string; name: string }>;
  };
}

async function note(request: APIRequestContext, title: string, x = 120, y = 120): Promise<string> {
  const response = await request.post('/api/canvas/node', {
    data: { type: 'markdown', title, content: `${title} body`, x, y, width: 320, height: 180 },
  });
  return ((await response.json()) as { id: string }).id;
}

test('an agent opens its new board and the connected workbench follows without a reload', async ({ page, request }) => {
  const originalNode = await note(request, 'Keep this on the original board');
  const original = (await boards(request)).activeBoardId;
  await page.goto('/workbench');
  await expect(page.locator(`[data-node-id="${originalNode}"]`)).toBeVisible();
  const { board } = await (await request.post('/api/canvas/boards', { data: { name: 'Agent planning' } })).json();
  expect((await boards(request)).activeBoardId).toBe(original);
  const opened = await request.post('/api/canvas/boards/open', { data: { id: board.id } });
  expect(opened.ok()).toBe(true);
  await expect(page.getByRole('button', { name: /^Board: Agent planning/ })).toBeVisible();
  await expect(page.locator('.canvas-node')).toHaveCount(0);
  const added = await note(request, 'Agent-authored plan');
  await expect(page.locator(`[data-node-id="${added}"]`)).toBeVisible();
  expect((await request.delete(`/api/canvas/boards/${board.id}`)).status()).toBe(403);
  expect((await request.post('/api/canvas/boards/open', { data: { id: original } })).ok()).toBe(true);
  await expect(page.locator(`[data-node-id="${originalNode}"]`)).toBeVisible();
  await expect(page.locator(`[data-node-id="${added}"]`)).toHaveCount(0);
});

test('Home clears board attention and session receipts without reporting deletions', async ({ page, request }) => {
  const baseline = await note(request, 'Navigation baseline');
  const peer = await note(request, 'Keep this relationship', 500);
  const original = (await boards(request)).activeBoardId;
  await request.post('/api/canvas/edge', { data: { from: baseline, to: peer, type: 'relation' } });
  await page.goto('/workbench');
  await expect(page.locator('.canvas-node')).toHaveCount(2);
  await request.post('/api/canvas/ax/presence', {
    data: { source: 'api', agentId: 'navigation-session', attached: true },
  });
  await request.patch(`/api/canvas/node/${baseline}`, { data: { content: 'Agent edited this note' } });
  await request.post('/api/canvas/ax/presence', {
    data: { source: 'api', agentId: 'navigation-session', attached: false },
  });
  await expect(page.getByTestId('session-receipt')).toBeVisible();
  await page.getByTestId('session-receipt').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator(`[data-node-id="${baseline}"] .md-card-content`)).toContainText('Navigation baseline body');
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await expect(page.getByTestId('home-view')).toBeVisible();
  await expect(page.getByTestId('session-receipt')).toHaveCount(0);
  // Observe through a poll cycle, not just the initially empty toast slot.
  await page.waitForTimeout(2250);
  await expect(page.locator('.attention-toast')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Recent updates/i })).toHaveCount(0);
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: original } });
  await expect(page.locator('.canvas-node')).toHaveCount(2);
  expect((await (await request.get('/api/canvas/state')).json()).edges).toEqual(
    expect.arrayContaining([expect.objectContaining({ from: baseline, to: peer })]),
  );
});

test('a refused browser write displays its reason and retains it in history', async ({ page, request }) => {
  const id = await note(request, 'Protected review note');
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto('/workbench');
  const reason = 'This note is being edited by another person. Try again after they finish.';
  await page.route(`**/api/canvas/node/${id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    await route.fulfill({ status: 409, json: { ok: false, error: reason } });
  });
  await page.locator(`[data-node-id="${id}"] .node-title`).click();
  await page.keyboard.press('Delete');
  const toast = page.locator('.attention-toast');
  await expect(toast.getByText(reason, { exact: true })).toBeVisible();
  await expect(toast).not.toHaveAttribute('title');
  await expect(page.locator(`[data-node-id="${id}"]`)).toBeVisible();
  await toast.click();
  await expect(page.getByRole('complementary', { name: 'Recent semantic changes' })).toContainText(reason);
  await page.getByRole('button', { name: 'Collapse changes panel' }).click();
  await page.unrouteAll();
  await page.locator(`[data-node-id="${id}"] .node-title`).click();
  await page.keyboard.press('Delete');
  await expect(page.locator(`[data-node-id="${id}"]`)).toHaveCount(0);
});

test('board switching refreshes approval labels and discards stale approval reads', async ({ page, request }) => {
  const ids: string[] = [];
  for (const name of ['Approvals A', 'Approvals B']) {
    const { board } = await (await request.post('/api/canvas/boards', { data: { name } })).json();
    ids.push(board.id);
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: board.id } });
    const { approvalGate } = await (await request.post('/api/canvas/ax/approval', { data: { title: name } })).json();
    await request.post(`/api/canvas/ax/approval/${approvalGate.id}/resolve`, { data: { decision: 'approved' } });
  }
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'Start agent session', exact: true }).click();
  await page.getByLabel('Expand session panel').click();
  await page.getByRole('button', { name: /Work items/i }).click();
  const list = page.getByRole('list', { name: 'Work items and gates' });
  await expect(list).toContainText('Approvals B');
  await expect(list).toContainText('approved by api');
  let release!: () => void;
  let captured!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let intercepted = false;
  await page.route('**/api/canvas/ax/surface-snapshot', async (route) => {
    if (intercepted) return route.continue();
    intercepted = true;
    const response = await route.fetch();
    captured();
    await hold;
    await route.fulfill({ response });
  });
  try {
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: ids[0] } });
    await ready;
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: ids[1] } });
    await expect(list).toContainText('Approvals B');
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(list).not.toContainText('Approvals A');
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: ids[0] } });
    await expect(list).toContainText('Approvals A');
    await expect(list).not.toContainText('Approvals B');
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await request.post('/api/canvas/ax/presence', {
      data: { source: 'browser', attached: false },
    });
  }
});

test('board menu dismisses on canvas and card clicks; README and link actions stay usable', async ({
  page,
  request,
}) => {
  await request.post('/api/canvas/clear', { headers: HUMAN });
  const id = await note(request, 'Board introduction', 440, 80);
  const source = (await boards(request)).activeBoardId!;
  const target = (await (await request.post('/api/canvas/boards', { data: { name: 'Linked destination' } })).json())
    .board;
  await request.post('/api/canvas/node', {
    data: { type: 'board', title: 'Reference', data: { boardId: target.id }, x: 800, y: 80, width: 320, height: 260 },
  });
  await page.goto('/workbench');
  const switcher = page.getByRole('button', { name: /^Board:/ });
  const menu = page.getByRole('menu', { name: 'Boards', exact: true });
  await switcher.click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Linked destination/ })).toContainText('0 nodes');
  expect(await menu.evaluate((element) => getComputedStyle(element).backgroundColor)).toMatch(/^rgb\(/);
  for (const width of [600, 390]) {
    await page.setViewportSize({ width, height: 700 });
    const bounds = await menu.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await expect(menu.getByRole('menuitem', { name: 'All boards (Home)' })).toBeInViewport();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.canvas-viewport').click({ position: { x: 1000, y: 500 } });
  await expect(menu).toHaveCount(0);
  const card = page.locator(`[data-node-id="${id}"]`);
  await switcher.click();
  await card.getByText('Board introduction body', { exact: true }).click();
  await expect(menu).toHaveCount(0);
  await switcher.click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  const designation = card.getByRole('button', { name: 'Set as README', exact: true });
  await designation.click();
  await expect(card.getByRole('button', { name: 'README', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect((await (await request.get(`/api/canvas/boards/${source}`)).json()).board.readmeNodeId).toBe(id);
  await card.getByRole('button', { name: 'README', exact: true }).press('Enter');
  await expect(designation).toHaveAttribute('aria-pressed', 'false');
  const body = await card.locator('.md-card-content').boundingBox();
  const footer = await card.locator('.md-card-actions').boundingBox();
  expect(body!.y + body!.height).toBeLessThanOrEqual(footer!.y + 1);
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('button', { name: '</> Source', exact: true })).toBeVisible();
  await page.getByTestId('expanded-node').getByRole('button', { name: 'Close', exact: true }).click();
  // Closing saves and restores focus asynchronously. Do not send Enter to
  // another control while the overlay still owns keyboard focus.
  await expect(page.getByTestId('expanded-node')).toHaveCount(0);
  await expect(card).toBeFocused();
  await page.getByRole('button', { name: 'Open board', exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: /^Board: Linked destination/ })).toBeVisible();
});

test('the logo opens Home by click and keyboard without losing board content', async ({ page, request }) => {
  await note(request, 'Logo navigation keeps this card');
  const id = (await boards(request)).activeBoardId!;
  await request.patch(`/api/canvas/boards/${id}`, { data: { name: 'Logo navigation board' } });
  await page.goto('/workbench');
  const logo = page.getByRole('button', { name: 'PMX Canvas — Home' });
  await expect(page.getByRole('button', { name: 'Present', exact: true })).toBeVisible();
  await logo.click();
  await expect(page.getByTestId('home-view')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Present', exact: true })).toHaveCount(0);
  expect((await boards(request)).activeBoardId).toBeNull();
  await page
    .getByTestId('home-board')
    .filter({ hasText: 'Logo navigation board' })
    .getByRole('button', { name: /Logo navigation board/ })
    .click();
  // Home.dc.html: a card selects the board; the details pane opens it.
  await page.getByRole('button', { name: 'Open board' }).click();
  await expect(page.locator('.canvas-node').filter({ hasText: 'Logo navigation keeps this card' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Present', exact: true })).toBeVisible();
  await logo.focus();
  await logo.press('Enter');
  await expect(page.getByTestId('home-view')).toBeVisible();
});

test('switch boards from the top bar, go Home, delete with a confirm, and reopen', async ({ page, request }) => {
  // A board with a note on it is open; name it so the switcher shows something stable.
  await request.post('/api/canvas/clear', { headers: HUMAN });
  await note(request, 'First board note');
  const first = (await boards(request)).activeBoardId as string;
  await request.patch(`/api/canvas/boards/${first}`, { data: { name: 'E2E First' } });
  const second = (
    (await (await request.post('/api/canvas/boards', { data: { name: 'E2E Second' } })).json()) as {
      board: { id: string };
    }
  ).board.id;

  await page.goto('/workbench');
  const switcher = page.getByRole('button', { name: /^Board: E2E First/ });
  await expect(switcher).toBeVisible();
  await expect(page.locator('.canvas-node').filter({ hasText: 'First board note' })).toBeVisible();

  // Switch to the second board: the canvas is that board now.
  await switcher.click();
  await page.getByRole('menuitem', { name: /E2E Second/ }).click();
  await expect(page.getByRole('button', { name: /^Board: E2E Second/ })).toBeVisible();
  await expect(page.locator('.canvas-node')).toHaveCount(0);
  await expect(page.getByTestId('empty-state')).toBeVisible();
  expect((await boards(request)).activeBoardId).toBe(second);

  // An agent write lands on the open board and shows up live.
  await note(request, 'Second board note', 200, 160);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Second board note' })).toBeInViewport();

  // Home, at the width of an agent pane.
  await page.setViewportSize({ width: 600, height: 900 });
  await page.getByRole('button', { name: /^Board: E2E Second/ }).click();
  await page.getByRole('menuitem', { name: 'All boards (Home)' }).click();
  const home = page.getByTestId('home-view');
  await expect(home).toBeVisible();
  await expect(page.getByRole('button', { name: /^Board: Home/ })).toBeVisible();
  const secondRow = home.getByTestId('home-board').filter({ hasText: 'E2E Second' });
  await expect(secondRow).toBeInViewport();

  // Boards save automatically; backup maintenance is not a Home action.
  await expect(home.getByRole('button', { name: 'Back up now' })).toHaveCount(0);
  await expect(home.getByTestId('home-backup')).toHaveCount(0);

  // File a board under a new folder (⋯ → Move): it opens as its own folder.
  const firstRow = home.getByTestId('home-board').filter({ hasText: 'E2E First' });
  await firstRow.getByRole('button', { name: 'E2E First' }).click();
  await home.getByRole('button', { name: /More: move, rename/ }).click();
  await home.getByRole('menuitem', { name: 'Move…' }).click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('E2E Planning');
  await page.getByRole('button', { name: 'Move board', exact: true }).click();
  await home.locator('[data-testid="home-section"][data-folder="E2E Planning"]').click();
  await expect(home.getByTestId('home-board').filter({ hasText: 'E2E First' })).toBeInViewport();

  // Delete asks in place first.
  await home.getByRole('navigation', { name: 'Folder path' }).getByRole('button', { name: 'Library' }).click();
  await secondRow.getByRole('button', { name: 'E2E Second' }).click();
  await home.getByRole('button', { name: /More: move, rename/ }).click();
  await home.getByRole('menuitem', { name: 'Delete…' }).click();
  await expect(home.getByText(/Delete E2E Second and its 1 card and snapshots/)).toBeVisible();
  await home.getByRole('button', { name: 'Delete board' }).click();
  await expect(home.getByTestId('home-board').filter({ hasText: 'E2E Second' })).toHaveCount(0);
  expect((await boards(request)).boards.some((board) => board.id === second)).toBe(false);

  // Reopen the first board from Home: its note is back on screen.
  await home.locator('[data-testid="home-section"][data-folder="E2E Planning"]').click();
  await home.getByRole('button', { name: 'E2E First' }).click();
  await home.getByRole('button', { name: 'Open board' }).click();
  await expect(home).toHaveCount(0);
  await expect(page.locator('.canvas-node').filter({ hasText: 'First board note' })).toBeInViewport();
});

test('a delayed new-board response preserves a newer board choice', async ({ page, request }) => {
  const existing = (await (await request.post('/api/canvas/boards', { data: { name: 'Keep my choice' } })).json())
    .board;
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: existing.id } });
  await note(request, 'Chosen board content');
  await page.goto('/workbench');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const created = new Promise<void>((resolve) => {
    reached = resolve;
  });
  await page.route('**/api/canvas/boards', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    reached();
    await held;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: /^Board: Keep my choice/ }).click();
  await page.getByRole('menuitem', { name: 'New board…' }).click();
  await page.getByTestId('text-prompt').locator('input').fill('Delayed creation');
  await page.keyboard.press('Enter');
  await created;
  await page.getByRole('button', { name: /^Board: Keep my choice/ }).click();
  await page.getByRole('menuitem', { name: 'All boards (Home)' }).click();
  await expect(page.getByTestId('home-view')).toBeVisible();
  await page
    .getByTestId('home-view')
    .getByRole('button', { name: /Keep my choice/ })
    .click();
  await page.getByRole('button', { name: 'Open board' }).click();
  await expect(page.locator('.canvas-node').filter({ hasText: 'Chosen board content' })).toBeVisible();
  release();
  await page.unrouteAll({ behavior: 'wait' });
  // Let the released create response and its continuation settle before asserting.
  await page.waitForTimeout(200);
  await expect(page.getByRole('button', { name: /^Board: Keep my choice/ })).toBeVisible();
  expect((await boards(request)).activeBoardId).toBe(existing.id);
});

test('nested folders move boards, retain tree folding, and search the library at 600px', async ({ page, request }) => {
  const created = await (
    await request.post('/api/canvas/boards', {
      data: { name: 'Architecture decisions', folder: 'Engineering/Canvas' },
    })
  ).json();
  await request.post('/api/canvas/boards', { data: { name: 'Other decisions', folder: 'Research/Decisions' } });
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: null } });
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto('/workbench');
  const home = page.getByTestId('home-view');
  const folderChip = (path: string) => home.locator(`[data-testid="home-section"][data-folder="${path}"]`);
  const row = home.getByTestId('home-board').filter({ hasText: 'Architecture decisions' });
  await home.getByRole('navigation', { name: 'Folder path' }).getByRole('button', { name: 'Library' }).click();
  await folderChip('Engineering').click();
  await folderChip('Engineering/Canvas').click();
  await row.getByRole('button', { name: 'Architecture decisions' }).click();
  await home.getByRole('button', { name: /More: move, rename/ }).click();
  await home.getByRole('menuitem', { name: 'Move…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move Architecture decisions' });
  await dialog.getByRole('radio', { name: 'Engineering/Canvas', exact: true }).check();
  await dialog.getByRole('textbox', { name: 'New folder name' }).fill('Decisions');
  await dialog.getByRole('button', { name: 'Move board', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await folderChip('Engineering/Canvas/Decisions').click();
  await expect(row).toBeVisible();
  expect((await (await request.get(`/api/canvas/boards/${created.board.id}`)).json()).board.folder).toBe(
    'Engineering/Canvas/Decisions',
  );

  // The tree (the folder picker at this width) keeps its folding across a reload.
  const picker = home.locator('.home-narrow-picker');
  await picker.click();
  await home.getByRole('button', { name: 'Fold Engineering' }).click();
  await page.reload();
  await home.locator('.home-narrow-picker').click();
  await expect(home.getByRole('button', { name: 'Unfold Engineering' })).toHaveAttribute('aria-expanded', 'false');
  await home.locator('.home-narrow-picker').click();

  // Search reaches boards inside folded folders, and only the matches.
  await home.getByRole('searchbox', { name: 'Find boards, cards and folders' }).fill('Architecture');
  await expect(row).toBeVisible();
  await expect(home.getByTestId('home-board').filter({ hasText: 'Other decisions' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Architecture decisions' }).click();
  await home.getByRole('button', { name: /More: move, rename/ }).click();
  await home.getByRole('menuitem', { name: 'Move…' }).click();
  await dialog.getByRole('radio', { name: 'Engineering', exact: true }).check();
  await dialog.getByRole('button', { name: 'Move board', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await (await request.get(`/api/canvas/boards/${created.board.id}`)).json()).board.folder).toBe('Engineering');
  await home.getByRole('searchbox', { name: 'Find boards, cards and folders' }).clear();
  await home.getByRole('navigation', { name: 'Folder path' }).getByRole('button', { name: 'Library' }).click();
  await folderChip('Engineering').click();
  await expect(row).toBeVisible();
  await expect(folderChip('Engineering/Canvas')).toHaveCount(0);
});

test('creates a selective board copy, links boards, and jumps through library search at 600px', async ({
  page,
  request,
}) => {
  await request.post('/api/canvas/clear', { headers: HUMAN });
  const copiedId = await note(request, 'Reusable decision');
  await note(request, 'Leave this behind', 500, 120);
  const source = (await boards(request)).activeBoardId as string;
  await request.patch(`/api/canvas/boards/${source}`, { data: { name: 'Source memory', readmeNodeId: copiedId } });
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: null } });

  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto('/workbench');
  const sourceRow = page.getByTestId('home-board').filter({ hasText: 'Source memory' });
  await sourceRow.getByRole('button', { name: 'Source memory' }).click();
  await page.getByRole('button', { name: /More: move, rename/ }).click();
  await page.getByRole('menuitem', { name: 'Create from…' }).click();
  const copyDialog = page.getByRole('dialog', { name: 'Create from Source memory' });
  await expect(copyDialog).toBeInViewport();
  await expect(copyDialog.getByText(/Asks, history, and context pins start clear/)).toBeVisible();
  await copyDialog.getByLabel('Leave this behind').uncheck();
  await copyDialog.getByLabel('Board name').fill('Focused memory');
  await copyDialog.getByRole('button', { name: 'Create board' }).click();
  await expect(copyDialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Board: Home/ })).toBeVisible();
  const createdRow = page.getByTestId('home-board').filter({ hasText: 'Focused memory' });
  await expect(createdRow).toBeVisible();
  await createdRow.getByRole('button', { name: /Focused memory/ }).click();
  await page.getByRole('button', { name: 'Open board' }).click();
  await expect(
    page.locator('.canvas-node[data-node-type="markdown"]').filter({ hasText: 'Reusable decision' }),
  ).toBeVisible();
  await expect(page.locator('.canvas-node').filter({ hasText: 'Leave this behind' })).toHaveCount(0);

  await page.getByRole('button', { name: /Search & commands/ }).click();
  await page
    .getByRole('dialog', { name: 'Search and commands' })
    .getByRole('button', { name: 'Link to board…' })
    .click();
  const linkDialog = page.getByRole('dialog', { name: 'Link to a board' });
  await linkDialog.getByRole('searchbox', { name: 'Find a board to link' }).fill('Source');
  // The copy already has a source-board link. Assert the newly added card,
  // not that existing link (which can satisfy a title-only check too early).
  const linked = page.waitForResponse(
    (response) => response.url().endsWith('/api/canvas/node') && response.request().method() === 'POST',
  );
  await linkDialog.getByRole('button', { name: /Source memory/ }).click();
  const linkResponse = await linked;
  expect(linkResponse.ok()).toBe(true);
  const { id: linkedId } = (await linkResponse.json()) as { id: string };
  await expect(page.locator(`.canvas-node[data-node-id="${linkedId}"]`)).toBeInViewport();
  await expect(page.locator('.canvas-node[data-node-type="board"]')).toHaveCount(2);

  await page.getByRole('button', { name: /Search & commands/ }).click();
  const palette = page.getByRole('dialog', { name: 'Search and commands' });
  await palette.getByRole('textbox').fill('Leave this behind');
  const libraryResult = palette.getByRole('button', { name: /Leave this behind.*Source memory/ });
  await expect(libraryResult).toBeVisible();
  await libraryResult.press('Enter');
  await expect(page.getByRole('button', { name: /^Board: Source memory/ })).toBeVisible();
  await expect(page.locator('.canvas-node').filter({ hasText: 'Leave this behind' })).toBeInViewport();
});

for (const sameBoard of [false, true]) {
  test(`late board responses cannot repaint ${sameBoard ? 'newer same-board edits' : 'a newer board'}`, async ({
    page,
    request,
  }) => {
    const ids: string[] = [];
    for (const name of ['Race A', 'Race B', 'Race C']) {
      const created = await (
        await request.post('/api/canvas/boards', { data: { name: `${name} ${sameBoard}` } })
      ).json();
      ids.push(created.board.id);
      await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: created.board.id } });
      await note(request, `${name} note`);
    }
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: ids[0] } });
    await page.goto('/workbench');
    await expect(page.locator('.canvas-node').filter({ hasText: 'Race A note' })).toBeVisible();

    let release!: () => void;
    let held!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const captured = new Promise<void>((resolve) => {
      held = resolve;
    });
    let intercepted = false;
    await page.route('**/api/canvas/state?includeBlobs=true', async (route) => {
      if (intercepted) return route.continue();
      intercepted = true;
      const response = await route.fetch();
      held();
      await hold;
      await route.fulfill({ response });
    });
    try {
      await page.getByRole('button', { name: /^Board: Race A/ }).click();
      await page.getByRole('menuitem', { name: new RegExp(`Race B ${sameBoard}`) }).click();
      await captured;
      if (sameBoard) {
        await note(request, 'Race B latest', 500, 200);
      } else {
        await page.getByRole('button', { name: /^Board: Race B/ }).click();
        await page.getByRole('menuitem', { name: new RegExp(`Race C ${sameBoard}`) }).click();
      }
      const expectedTitle = sameBoard ? 'Race B latest' : 'Race C note';
      await expect(page.locator('.canvas-node').filter({ hasText: expectedTitle })).toBeVisible();
      const staleResponse = page.waitForResponse((response) =>
        response.url().includes('/api/canvas/state?includeBlobs=true'),
      );
      release();
      await staleResponse;
      // Let the response body and the client's promise continuations settle.
      await page.waitForTimeout(150);
      await expect(page.getByRole('button', { name: sameBoard ? /^Board: Race B/ : /^Board: Race C/ })).toBeVisible();
      await expect(page.locator('.canvas-node').filter({ hasText: expectedTitle })).toBeVisible();
      if (!sameBoard) await expect(page.locator('.canvas-node').filter({ hasText: 'Race B note' })).toHaveCount(0);
      expect((await boards(request)).activeBoardId).toBe(ids[sameBoard ? 1 : 2]);
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}

test('wiki navigation and human remote-card connections survive renames and retain the source', async ({
  page,
  request,
}) => {
  const target = (await (await request.post('/api/canvas/boards', { data: { name: 'Research library' } })).json())
    .board;
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: target.id } });
  const evidence = await note(request, 'Interview evidence', 900, 650);
  const source = (await (await request.post('/api/canvas/boards', { data: { name: 'Decision library' } })).json())
    .board;
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: source.id } });
  const claim = (
    await (
      await request.post('/api/canvas/node', {
        data: {
          type: 'markdown',
          title: 'Decision',
          content: '[[Research library#Interview evidence|Read the evidence]] and [[New investigation]]',
          x: 100,
          y: 100,
          width: 520,
        },
      })
    ).json()
  ).id;
  await page.goto('/workbench');
  await page.getByRole('link', { name: 'Read the evidence' }).click();
  await expect(page.getByRole('button', { name: /^Board: Research library/ })).toBeVisible();
  const card = page.locator(`[data-node-id="${evidence}"]`);
  await expect(card).toBeInViewport();
  await request.patch(`/api/canvas/boards/${target.id}`, { headers: HUMAN, data: { name: 'Renamed research' } });
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: source.id } });
  const sourceCard = page.locator(`[data-node-id="${claim}"]`);
  await sourceCard.getByRole('button', { name: 'Expand (focus mode)', exact: true }).click();
  const editor = page.locator('.md-reader-editable');
  await expect(editor).toContainText('Read the evidence');
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' — human checked');
  await page.keyboard.press('Control+s');
  await expect
    .poll(async () => (await (await request.get(`/api/canvas/node/${claim}`)).json()).data.content)
    .toContain('[[Research library#Interview evidence|Read the evidence]]');
  await expect
    .poll(async () => (await (await request.get(`/api/canvas/node/${claim}`)).json()).data.content)
    .toContain('human checked');
  await page.keyboard.press('Escape');
  const edited = await (await request.get(`/api/canvas/node/${claim}`)).json();
  expect(edited.data.wikiLinks).toEqual(
    expect.arrayContaining([
      { ref: 'Research library#Interview evidence', target: { boardId: target.id, cardId: evidence } },
      { ref: 'New investigation' },
    ]),
  );
  await page.locator(`[data-node-id="${claim}"]`).hover();
  await page.locator(`[data-node-id="${claim}"]`).getByRole('button', { name: 'More actions' }).click();
  await page.getByText('Connect to a card on another board…', { exact: true }).click();
  const picker = page.getByRole('dialog');
  await picker.getByLabel('Find a card to connect').fill('Interview evidence');
  await picker.getByRole('button', { name: /Interview evidence/ }).click();
  const footer = page.locator(`[data-node-id="${claim}"] .node-memory-link`);
  await expect(footer).toContainText('Renamed research / Interview evidence');
  await expect
    .poll(() =>
      footer.evaluate((element) => {
        const body = element.closest('.node-body')!;
        const rect = element.getBoundingClientRect();
        const bounds = body.getBoundingClientRect();
        return { scrollTop: body.scrollTop, fullyVisible: rect.top >= bounds.top && rect.bottom <= bounds.bottom + 1 };
      }),
    )
    .toEqual({ scrollTop: 0, fullyVisible: true });
  expect((await (await request.get('/api/canvas/state')).json()).edges).toEqual(
    expect.arrayContaining([expect.objectContaining({ from: claim, to: evidence, toBoardId: target.id })]),
  );
  await footer.getByRole('button').click();
  await expect(page.getByRole('button', { name: /^Board: Renamed research/ })).toBeVisible();
  await expect(card).toBeInViewport();
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: source.id } });
  await page.getByRole('link', { name: 'New investigation', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create board', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Board: New investigation/ })).toBeVisible();
  const created = (await boards(request)).boards.find((board) => board.name === 'New investigation')!;
  const savedSource = await (await request.get(`/api/canvas/node/${claim}?board=${source.id}`)).json();
  expect(savedSource.data.wikiLinks).toEqual(
    expect.arrayContaining([{ ref: 'New investigation', target: { boardId: created.id } }]),
  );
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: source.id } });
  await page.getByRole('link', { name: 'Read the evidence' }).click();
  await expect(page.getByRole('button', { name: /^Board: Renamed research/ })).toBeVisible();
  await expect(card).toBeInViewport();
});

test('relation refreshes preserve an unsaved Source draft, selection and wiki preview through Save', async ({
  page,
  request,
}) => {
  const board = (await (await request.post('/api/canvas/boards', { data: { name: 'Draft research' } })).json()).board;
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: board.id } });
  const evidence = await note(request, 'Draft evidence', 750);
  const original = 'Saved paragraph. [[Draft research#Draft evidence|Read evidence]]';
  const claim = (
    await (
      await request.post('/api/canvas/node', {
        data: { type: 'markdown', title: 'Draft decision', content: original, x: 100, y: 100, width: 480 },
      })
    ).json()
  ).id;
  const saved = await (await request.get(`/api/canvas/node/${claim}`)).json();
  await page.goto('/workbench');
  await page.locator(`[data-node-id="${claim}"]`).getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: '</> Source', exact: true }).click();
  const editor = page.locator('.md-editor-expanded textarea');
  const draft = `${original}\n\nHuman authored continuation.`;
  await editor.fill(draft);
  await expect(page.locator('.md-preview')).toContainText('Human authored continuation.');
  await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(6, 15));
  const refresh = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/render');
  expect(
    (
      await request.post('/api/canvas/edge', {
        data: { from: claim, to: evidence, type: 'references', label: 'Relation added during drafting' },
      })
    ).ok(),
  ).toBe(true);
  await (await refresh).finished();
  // Observe after the render response has been applied, not before the refresh.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(editor).toHaveValue(draft);
  expect(
    await editor.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd]),
  ).toEqual([6, 15]);
  expect((await request.delete(`/api/canvas/node/${evidence}`)).ok()).toBe(true);
  await expect(page.locator('.md-preview a.wiki-link')).toHaveAttribute('data-wiki-missing', 'true');
  await expect(editor).toHaveValue(draft);
  await expect(page.locator('.md-preview')).toContainText('Human authored continuation.');
  expect((await request.post('/api/canvas/undo')).ok()).toBe(true);
  await expect(page.locator('.md-preview a.wiki-link')).toHaveAttribute('data-wiki-card', evidence);
  await expect(editor).toHaveValue(draft);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => (await (await request.get(`/api/canvas/node/${claim}`)).json()).data.content)
    .toBe(draft);
  const persisted = await (await request.get(`/api/canvas/node/${claim}`)).json();
  expect(persisted.data.wikiLinks).toEqual(saved.data.wikiLinks);
});

test('a delayed file-backed draft render cannot overwrite a subsequently saved document or selection', async ({
  page,
  request,
}) => {
  const directory = mkdtempSync(join(process.cwd(), '.pmx-draft-test-'));
  const path = join(directory, 'draft.md');
  const saved = 'Original file text.';
  const discarded = 'Discarded intermediate draft.';
  writeFileSync(path, saved);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const board = (await (await request.post('/api/canvas/boards', { data: { name: 'File draft' } })).json()).board;
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: board.id } });
    const evidence = await note(request, 'File evidence', 750);
    const claim = (
      await (
        await request.post('/api/canvas/node', {
          data: { type: 'markdown', title: 'File decision', x: 100, y: 100, data: { path, content: saved } },
        })
      ).json()
    ).id;
    await page.goto('/workbench');
    await page.locator(`[data-node-id="${claim}"]`).getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: '</> Source', exact: true }).click();
    const editor = page.locator('.md-editor-expanded textarea');
    await expect(editor).toHaveValue(saved);
    await editor.fill(discarded);
    await expect(page.locator('.md-preview')).toContainText(discarded);
    let waiting = false;
    await page.route('**/api/render', async (route) => {
      if ((route.request().postDataJSON() as { markdown: string }).markdown !== discarded) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      waiting = true;
      await held;
      await route.fulfill({ response });
    });
    const obsoleteRender = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/render' &&
        (response.request().postDataJSON() as { markdown: string }).markdown === discarded,
    );
    expect(
      (await request.post('/api/canvas/edge', { data: { from: claim, to: evidence, type: 'references' } })).ok(),
    ).toBe(true);
    await expect.poll(() => waiting).toBe(true);
    await editor.fill(saved);
    await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(2, 8));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
    expect(readFileSync(path, 'utf8')).toBe(saved);
    release();
    await (await obsoleteRender).finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(editor).toHaveValue(saved);
    expect(
      await editor.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd]),
    ).toEqual([2, 8]);
    await expect(page.locator('.md-preview')).toContainText(saved);
    expect(readFileSync(path, 'utf8')).toBe(saved);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
    rmSync(directory, { recursive: true, force: true });
  }
});

test('whole-library Graph updates card context on board pin and unpin without clearing card pins', async ({
  page,
  request,
}) => {
  const board = (await (await request.post('/api/canvas/boards', { data: { name: 'Context filter' } })).json()).board;
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: board.id } });
  await note(request, 'Ordinary context card');
  const pinned = await note(request, 'Individually pinned card', 520);
  expect((await request.post('/api/canvas/context-pins', { headers: HUMAN, data: { nodeIds: [pinned] } })).ok()).toBe(
    true,
  );
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Focus', exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'board: Context filter', exact: true }).click();
  await page.getByRole('checkbox', { name: 'In context only', exact: true }).check();
  const ordinary = page.getByRole('button', { name: 'card: Ordinary context card', exact: true });
  const individual = page.getByRole('button', { name: 'card: Individually pinned card', exact: true });
  await expect(ordinary).toHaveCount(0);
  await expect(individual).toBeVisible();
  const details = page.getByRole('complementary', { name: 'Selection details' });
  await details.getByRole('button', { name: "Pin board to the agent's context", exact: true }).click();
  await expect(ordinary).toBeVisible();
  await expect(individual).toBeVisible();
  await details.getByRole('button', { name: "Unpin board from the agent's context", exact: true }).click();
  await expect(ordinary).toHaveCount(0);
  await expect(individual).toBeVisible();
  const graph = await (await request.get('/api/canvas/memory-graph')).json();
  expect(
    graph.nodes
      .filter((node: { kind: string; inContext: boolean }) => node.kind === 'card' && node.inContext)
      .map((node: { title: string }) => node.title),
  ).toEqual(['Individually pinned card']);
});

test('Home Map persists human positions and Graph matches agent focus without opening a board', async ({
  page,
  request,
}) => {
  const source = (
    await (await request.post('/api/canvas/boards', { data: { name: 'Planning map', folder: 'Work' } })).json()
  ).board;
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: source.id } });
  const claim = await note(request, 'A decision to explore');
  const orphan = (await (await request.post('/api/canvas/boards', { data: { name: 'Unlinked scratchpad' } })).json())
    .board;
  const remote = (await (await request.post('/api/canvas/boards', { data: { name: 'Remote research' } })).json()).board;
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: remote.id } });
  const evidence = await note(request, 'Remote Map evidence', 2600, 1800);
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: source.id } });
  await request.post('/api/canvas/edge', {
    data: { from: claim, to: evidence, toBoardId: remote.id, type: 'references' },
  });
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  const discoveryResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/canvas/memory-graph',
  );
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const discovery = await discoveryResponse;
  expect(new URL(discovery.url()).searchParams.get('projection')).toBe('boards');
  expect((await discovery.json()).nodes.every((node: { kind: string }) => node.kind === 'board')).toBe(true);
  const tile = page.getByRole('button', { name: 'board: Planning map', exact: true });
  await expect(tile).toBeVisible();
  await expect(page.getByRole('button', { name: 'board: Unlinked scratchpad', exact: true })).toBeVisible();
  const initial = await tile.boundingBox();
  if (!initial) throw new Error('Map tile missing');
  await page.mouse.move(initial.x + 50, initial.y + 30);
  await page.mouse.down();
  await page.mouse.move(initial.x + 115, initial.y + 65, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/canvas/boards')).json()).boards.find(
          (board: { id: string }) => board.id === source.id,
        )?.mapPosition,
    )
    .toEqual({ x: 125, y: 400 });
  await page.reload();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(tile).toBeVisible();
  await expect.poll(() => tile.boundingBox()).toMatchObject({ x: initial.x + 65, y: initial.y + 35 });
  await tile.click();
  await page.getByRole('button', { name: 'Reset position', exact: true }).click();
  await expect.poll(() => tile.boundingBox()).toMatchObject({ x: initial.x, y: initial.y });
  await page.route(`**/api/canvas/boards/${source.id}`, (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 409, json: { ok: false, error: 'Map position refused for this test.' } })
      : route.continue(),
  );
  const reset = await tile.boundingBox();
  if (!reset) throw new Error('Reset tile missing');
  await page.mouse.move(reset.x + 50, reset.y + 30);
  await page.mouse.down();
  await page.mouse.move(reset.x + 115, reset.y + 65, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.attention-toast')).toContainText('Map position refused for this test.');
  await expect.poll(() => tile.boundingBox()).toMatchObject({ x: initial.x, y: initial.y });
  await page.unrouteAll();
  await page.getByRole('button', { name: "Pin board to the agent's context", exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Remote Map evidence', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remote Map evidence', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Board: Remote research/ })).toBeVisible();
  await expect(page.locator(`[data-node-id="${evidence}"]`)).toBeInViewport();
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await page.getByRole('combobox', { name: 'Focus', exact: true }).selectOption(source.id);
  await page.getByRole('combobox', { name: 'Depth', exact: true }).selectOption('0');
  await expect(page.locator('.home-memory-select')).toHaveCount(1);
  const projected = await (
    await request.get(`/api/canvas/memory-graph?focus=${source.id}&depth=0&consumer=wave2-e2e`)
  ).json();
  expect(projected.nodes.map((node: { title: string }) => node.title)).toEqual(['Planning map']);
  expect((await boards(request)).activeBoardId).toBeNull();
  expect(projected.nodes.some((node: { boardId: string }) => node.boardId === orphan.id)).toBe(false);
  await page.getByRole('combobox', { name: 'Focus', exact: true }).selectOption('pins');
  await page.getByRole('combobox', { name: 'Depth', exact: true }).selectOption('1');
  await expect(page.getByRole('button', { name: 'card: A decision to explore', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'card: A decision to explore', exact: true }).click();
  await page.getByRole('button', { name: 'Open card', exact: true }).click();
  await expect(page.locator('.canvas-node').filter({ hasText: 'A decision to explore' })).toBeInViewport();
});

test('a wiki card jump waits for a delayed target layout before focusing it', async ({ page, request }) => {
  const target = (await (await request.post('/api/canvas/boards', { data: { name: 'Slow research' } })).json()).board;
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: target.id } });
  const id = await note(request, 'Far away evidence', 2600, 1800);
  const source = (await (await request.post('/api/canvas/boards', { data: { name: 'Slow decision' } })).json()).board;
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: source.id } });
  await request.post('/api/canvas/node', {
    data: { type: 'markdown', content: '[[Slow research#Far away evidence|Jump to evidence]]', x: 100, y: 100 },
  });
  await page.goto('/workbench');
  await expect(page.getByRole('link', { name: 'Jump to evidence' })).toBeVisible();
  let delayed = false;
  await page.route('**/api/canvas/state?*', async (route) => {
    const response = await route.fetch();
    delayed = true;
    await new Promise((resolve) => setTimeout(resolve, 2200));
    await route.fulfill({ response });
  });
  await page.getByRole('link', { name: 'Jump to evidence' }).click();
  await expect(page.getByRole('button', { name: /^Board: Slow research/ })).toBeVisible();
  await expect(page.locator(`[data-node-id="${id}"]`)).toBeInViewport();
  expect(delayed).toBe(true);
  await page.unrouteAll({ behavior: 'wait' });
});
