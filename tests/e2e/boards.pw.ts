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

  // Back up the whole library from Home.
  await home.getByRole('button', { name: 'Back up now' }).click();
  await expect(home.getByTestId('home-backup')).toContainText('Last backup just now');

  // File a board under a new category: Home shows it in its own section.
  const firstRow = home.getByTestId('home-board').filter({ hasText: 'E2E First' });
  await firstRow.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('menuitem', { name: 'New category…' }).click();
  await page.getByTestId('text-prompt').locator('input').fill('E2E Planning');
  await page.keyboard.press('Enter');
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
