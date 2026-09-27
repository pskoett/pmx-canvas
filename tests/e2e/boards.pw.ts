/**
 * Many boards in the workbench (plan 012): the top-bar switcher, Home, and the
 * in-place delete confirm — asserted on what the human sees.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';

const HUMAN = { 'x-pmx-workbench': '1' };

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

  // File a board under a new category: Home shows it in its own section.
  const firstRow = home.getByTestId('home-board').filter({ hasText: 'E2E First' });
  await firstRow.getByRole('button', { name: 'Move', exact: true }).click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('E2E Planning');
  await page.getByRole('button', { name: 'Move board', exact: true }).click();
  const planning = home.getByTestId('home-section').filter({ hasText: 'E2E Planning' });
  await expect(planning.getByTestId('home-board').filter({ hasText: 'E2E First' })).toBeInViewport();

  // Delete asks in place first.
  await secondRow.getByRole('button', { name: 'Delete' }).click();
  await expect(home.getByText(/Delete E2E Second and its 1 node and snapshots/)).toBeVisible();
  await home.getByRole('button', { name: 'Delete board' }).click();
  await expect(home.getByTestId('home-board').filter({ hasText: 'E2E Second' })).toHaveCount(0);
  expect((await boards(request)).boards.some((board) => board.id === second)).toBe(false);

  // Reopen the first board from Home: its note is back on screen.
  await home.getByRole('button', { name: /E2E First/ }).click();
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
  await expect(page.locator('.canvas-node').filter({ hasText: 'Chosen board content' })).toBeVisible();
  release();
  await page.unrouteAll({ behavior: 'wait' });
  // Let the released create response and its continuation settle before asserting.
  await page.waitForTimeout(200);
  await expect(page.getByRole('button', { name: /^Board: Keep my choice/ })).toBeVisible();
  expect((await boards(request)).activeBoardId).toBe(existing.id);
});

test('nested folders move boards, retain collapse state, and search across closed branches', async ({
  page,
  request,
}) => {
  const created = await (
    await request.post('/api/canvas/boards', {
      data: { name: 'Architecture decisions', category: 'Engineering/Canvas' },
    })
  ).json();
  await request.post('/api/canvas/boards', { data: { name: 'Other decisions', category: 'Research/Decisions' } });
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: null } });
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto('/workbench');
  const row = page.getByTestId('home-board').filter({ hasText: 'Architecture decisions' });
  await row.getByRole('button', { name: 'Move', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Move Architecture decisions' });
  await dialog.getByRole('radio', { name: 'Engineering/Canvas', exact: true }).check();
  await dialog.getByRole('textbox', { name: 'New folder name' }).fill('Decisions');
  await dialog.getByRole('button', { name: 'Move board', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const branch = page.locator('[data-folder="Engineering/Canvas/Decisions"]');
  await expect(branch.getByTestId('home-board')).toContainText('Architecture decisions');
  expect((await (await request.get(`/api/canvas/boards/${created.board.id}`)).json()).board.category).toBe(
    'Engineering/Canvas/Decisions',
  );
  const engineering = page.locator('[data-folder="Engineering"] > button');
  await engineering.click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(engineering).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('searchbox', { name: 'Find boards and folders' }).fill('Architecture');
  await expect(branch.getByTestId('home-board')).toBeVisible();
  await expect(page.getByTestId('home-board').filter({ hasText: 'Other decisions' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Move', exact: true }).click();
  await dialog.getByRole('radio', { name: 'Engineering', exact: true }).check();
  await dialog.getByRole('button', { name: 'Move board', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await (await request.get(`/api/canvas/boards/${created.board.id}`)).json()).board.category).toBe(
    'Engineering',
  );
  await expect(branch).toHaveCount(0);
  await expect(page.locator('[data-folder="Engineering"]')).toContainText('Architecture decisions');
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
