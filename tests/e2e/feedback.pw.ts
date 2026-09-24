import { expect, test } from '@playwright/test';

test('feedback rail button opens a private draft and hands only entered fields to GitHub', async ({
  page,
  context,
}) => {
  // Intercept the handoff: never create an issue or send test content to GitHub.
  await context.route('https://github.com/**', (route) => route.fulfill({ body: 'GitHub draft handoff' }));
  await page.goto('/workbench');
  const button = page.getByRole('button', { name: 'Bug and feedback', exact: true });
  await expect(button).toBeInViewport();
  await button.hover();
  await expect(page.getByTestId('rail-tooltip')).toHaveText('Bug and feedback');
  await button.click();
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
  await dialog.getByLabel('Feedback type').selectOption('Feature request');
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
