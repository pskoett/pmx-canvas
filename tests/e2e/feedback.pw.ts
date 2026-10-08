import { expect, test } from '@playwright/test';

test('feedback rail button opens a private draft and hands only entered fields to GitHub', async ({
  page,
  context,
}) => {
  // Intercept the handoff: never create an issue or send test content to GitHub.
  await context.route('https://github.com/**', (route) => route.fulfill({ body: 'GitHub draft handoff' }));
  await page.goto('/workbench');
  // Send feedback lives in the rail's Settings menu (Chrome.dc.html §7).
  const button = page.getByRole('button', { name: 'Settings', exact: true });
  const sendFeedback = () =>
    page.getByRole('menu', { name: 'Settings' }).getByRole('menuitem').filter({ hasText: 'Send feedback' });
  await expect(button).toBeInViewport();
  await button.click();
  await sendFeedback().click();
  const dialog = page.getByRole('dialog', { name: 'Bug and feedback' });
  await expect(dialog).toBeVisible();
  const next = dialog.getByRole('button', { name: 'Continue on GitHub' });
  await expect(next).toBeDisabled();
  await expect(dialog.getByLabel('Feedback type')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();

  await page.setViewportSize({ width: 390, height: 600 });
  await expect(button).toBeInViewport();
  await button.click();
  await sendFeedback().click();
  const type = dialog.getByRole('button', { name: 'Feedback type' });
  await type.click();
  const menu = dialog.getByRole('menu', { name: 'Feedback type' });
  await expect(menu).toBeInViewport();
  await expect(menu.getByRole('menuitemradio', { name: /Bug report/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio', { name: 'Feature request' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(type).toBeFocused();
  await expect(dialog).toBeVisible();
  await type.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(type).toHaveText('Feature request');
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  expect((await cancel.boundingBox())!.height).toBeGreaterThanOrEqual(36);
  await expect(cancel).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await dialog.getByLabel('Title', { exact: true }).fill('Spacing & zoom + café?');
  await dialog.getByLabel('Description').fill('Keep A & B apart.\nExpected: 24px + room for 日本語.');
  await expect(next).toBeEnabled();
  await expect(next).toBeInViewport();
  const popupPromise = page.waitForEvent('popup');
  await next.click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  const url = new URL(popup.url());
  expect(url.origin + url.pathname).toBe('https://github.com/pskoett/pmx-canvas/issues/new');
  expect([...url.searchParams.keys()].sort()).toEqual(['body', 'title']);
  expect(url.searchParams.get('title')).toBe('Spacing & zoom + café?');
  expect(url.searchParams.get('body')?.replaceAll('\r\n', '\n')).toBe(
    '## Feature request\n\nKeep A & B apart.\nExpected: 24px + room for 日本語.',
  );
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await popup.close();
  // The original draft stays available if the host blocks or closes the new tab.
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Spacing & zoom + café?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

for (const [theme, width] of [
  ['harbor', 1280],
  ['daylight', 390],
] as const) {
  test(`feedback and agent menus use the ${theme} theme at ${width}px`, async ({ browser, request }, testInfo) => {
    await request.post('/api/canvas/theme', { data: { theme } });
    for (const source of ['menu-author', 'menu-reviewer']) {
      await request.post('/api/canvas/ax/presence', { data: { source, attached: true } });
    }
    const context = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    try {
      await page.goto('/workbench');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const trigger = page.getByRole('button', { name: 'Steer which agent' });
      await trigger.click();
      const agents = page.getByRole('menu', { name: 'Steer which agent' });
      await expect(agents).toBeInViewport({ ratio: 1 });
      await expect(agents.getByRole('menuitemradio', { name: /menu-reviewer/ })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('agent-menu.png') });
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await trigger.click();
      await agents.getByRole('menuitemradio', { name: /menu-reviewer/ }).click();
      await expect(page.getByLabel('Steer the agent')).toHaveAttribute('placeholder', /menu-reviewer/);

      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page
        .getByRole('menu', { name: 'Settings' })
        .getByRole('menuitem')
        .filter({ hasText: 'Send feedback' })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Bug and feedback' });
      await dialog.getByRole('button', { name: 'Feedback type' }).click();
      const kinds = dialog.getByRole('menu', { name: 'Feedback type' });
      await expect(kinds).toBeInViewport({ ratio: 1 });
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: testInfo.outputPath('feedback-menu.png') });
      await page.keyboard.press('Escape');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      for (const name of ['Draw (A)', 'Text note', 'Eraser']) {
        const tool = page.getByRole('button', { name, exact: true });
        await expect(tool).toBeInViewport({ ratio: 1 });
        await tool.click();
        await expect(tool).toHaveAttribute('aria-pressed', 'true');
      }
      await page.screenshot({ path: testInfo.outputPath('annotation-rail.png') });
    } finally {
      await context.close();
      for (const source of ['menu-author', 'menu-reviewer']) {
        await request.post('/api/canvas/ax/presence', { data: { source, attached: false } });
      }
      await request.post('/api/canvas/theme', { data: { theme: 'harbor' } });
    }
  });
}
