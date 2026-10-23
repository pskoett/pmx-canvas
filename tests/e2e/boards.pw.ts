/**
 * Many boards in the workbench (plan 012): the top-bar switcher, Home, and the
 * in-place delete confirm — asserted on what the human sees.
 */
import { expect, test, setWorkspaceFeatures, type APIRequestContext, type Page } from './workspace-fixture.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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

async function note(
  request: APIRequestContext,
  title: string,
  x = 120,
  y = 120,
  contentOrigin?: 'imported',
): Promise<string> {
  const response = await request.post('/api/canvas/node', {
    data: {
      type: 'markdown',
      title,
      content: `${title} body`,
      data: { contentOrigin },
      x,
      y,
      width: 320,
      height: 180,
    },
  });
  return ((await response.json()) as { id: string }).id;
}

async function expectReadableGraphLabels(page: Page, count: number) {
  await expect(page.locator('.graph-link text')).toHaveCount(count);
  expect(
    await page.locator('.graph-links').evaluate((svg) => {
      const labels = [...svg.querySelectorAll('text')].map((text) => {
        const rect = text.getBoundingClientRect();
        const halo = Math.hypot(text.getScreenCTM()!.a, text.getScreenCTM()!.b) * 3;
        return {
          text: text.textContent,
          left: rect.left - halo,
          right: rect.right + halo,
          top: rect.top - halo,
          bottom: rect.bottom + halo,
        };
      });
      const nodes = [...document.querySelectorAll('.graph-node')].map((node) => node.getBoundingClientRect());
      return labels.flatMap((label, index) =>
        [...nodes, ...labels.slice(index + 1)]
          .filter(
            (other) =>
              label.left < other.right &&
              label.right > other.left &&
              label.top < other.bottom &&
              label.bottom > other.top,
          )
          .map(() => label.text),
      );
    }),
  ).toEqual([]);
}

test('Home manages shared relation presets while board filters show only existing connections', async ({
  page,
  request,
}) => {
  const first = await note(request, 'Evidence');
  const second = await note(request, 'Claim', 600);
  const boardA = (await boards(request)).activeBoardId!;
  for (const kind of ['supports', 'qualifies']) {
    expect(
      (
        await request.post('/api/canvas/edge', {
          headers: HUMAN,
          data: { from: first, to: second, type: 'relation', kind, reason: `Why ${kind}` },
        })
      ).ok(),
    ).toBe(true);
  }
  const originalEdges = (await (await request.get('/api/canvas/state', { headers: HUMAN })).json()).edges;
  const { board: boardB } = await (
    await request.post('/api/canvas/boards', { data: { name: 'Citations only' } })
  ).json();
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: boardB.id } });
  const source = await note(request, 'Source');
  const target = await note(request, 'Citation', 600);
  await request.post('/api/canvas/edge', {
    headers: HUMAN,
    data: { from: source, to: target, type: 'relation', kind: 'cites' },
  });
  const originalB = (await (await request.get('/api/canvas/boards')).json()).boards.find(
    (board: { id: string }) => board.id === boardB.id,
  );
  let releaseKnowledge!: () => void;
  const heldKnowledge = new Promise<void>((resolve) => {
    releaseKnowledge = resolve;
  });
  await page.route('**/api/canvas/knowledge', async (route) => {
    await heldKnowledge;
    await route.continue();
  });
  await page.goto('/workbench');
  await expect(page.getByLabel('Filter board relations').locator('option')).toHaveText(['All relations', 'cites · 1']);
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await page.setViewportSize({ width: 390, height: 900 });
  const homePresetButton = page.getByRole('button', { name: 'Relation presets', exact: true });
  const homePresetBounds = (await homePresetButton.boundingBox())!;
  expect(homePresetBounds.x + homePresetBounds.width).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Relation presets', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Workspace relation presets' });
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await expect(dialog).toContainText('Relation presets unavailable');
  releaseKnowledge();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(dialog.getByRole('button', { name: 'Use on board', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole('button', { name: 'Customize preset', exact: true })).toBeInViewport({ ratio: 1 });
  await dialog.getByRole('button', { name: 'Add preset', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('  Verification  ');
  await dialog.getByRole('button', { name: 'Add kind', exact: true }).click();
  await dialog.getByLabel('Kind 1', { exact: true }).fill('  assesses  ');
  await dialog.getByLabel('Ink 1', { exact: true }).selectOption('derived');
  await dialog.getByLabel('Arrow', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Preset saved for the workspace');
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await expect(dialog.getByLabel('Saved relation preview')).toContainText('assesses');
  await expect(dialog.getByLabel('Saved relation preview')).toContainText('Undirected: A — B');
  await page.reload();
  await page.getByRole('button', { name: 'Relation presets', exact: true }).click();
  await dialog
    .getByRole('group', { name: 'Workspace relation presets' })
    .getByRole('button', { name: /^Verification/ })
    .click();
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Customize preset', exact: true }).click();
  await expect(dialog.getByLabel('Kind 1', { exact: true })).toHaveValue('assesses');
  await expect(dialog.getByLabel('Arrow', { exact: true })).not.toBeChecked();
  await dialog.getByLabel('Kind 1', { exact: true }).fill('UNSAVED kind');
  await dialog.getByLabel('Ink 1', { exact: true }).selectOption('contradicts');
  await dialog.getByLabel('Arrow', { exact: true }).check();
  await expect(dialog.getByRole('button', { name: 'Use on board', exact: true })).toHaveCount(0);
  await page.route('**/api/canvas/knowledge/relation-preset', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }),
  );
  await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Preset was not saved');
  await expect(dialog.getByLabel('Kind 1', { exact: true })).toHaveValue('UNSAVED kind');
  await page.unroute('**/api/canvas/knowledge/relation-preset');
  await dialog.getByRole('button', { name: 'Cancel customization', exact: true }).click();
  const guard = dialog.getByRole('alertdialog', { name: 'Discard preset changes' });
  await expect(guard).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(guard).toHaveCount(0);
  await expect(dialog.getByLabel('Kind 1', { exact: true })).toHaveValue('UNSAVED kind');
  await dialog.getByRole('button', { name: 'Cancel customization', exact: true }).click();
  await guard.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(dialog.getByLabel('Kind 1', { exact: true })).toHaveValue('UNSAVED kind');
  await dialog.getByRole('button', { name: 'Cancel customization', exact: true }).click();
  await guard.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await dialog.getByLabel('Apply saved preset to board').selectOption(boardA);
  await dialog.getByRole('button', { name: 'Use on board', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Preset applied');
  const applied = (await (await request.get('/api/canvas/boards')).json()).boards;
  expect(applied.find((board: { id: string }) => board.id === boardA).relationVocabulary).toEqual([
    { kind: 'assesses', ink: 'derived', directed: false },
  ]);
  // Busy disables the clicked button, so focus may fall back to the page body.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Relation presets', exact: true }).click();
  await dialog
    .getByRole('group', { name: 'Workspace relation presets' })
    .getByRole('button', { name: /^Verification/ })
    .click();
  await dialog.getByRole('button', { name: 'Customize preset', exact: true }).click();
  await dialog.getByLabel('Kind 1', { exact: true }).fill('later saved kind');
  await dialog.getByLabel('Arrow', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Preset saved for the workspace');
  await expect(dialog.getByLabel('Saved relation preview')).toContainText('later saved kind');
  await expect(dialog.getByLabel('Saved relation preview')).toContainText('Directed: A → B');
  expect((await (await request.get('/api/canvas/boards')).json()).boards).toEqual(applied);
  await dialog.getByRole('button', { name: 'Delete preset', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancel deletion', exact: true }).click();
  await expect(dialog.getByLabel('Saved relation preview')).toContainText('later saved kind');
  await dialog.getByRole('button', { name: 'Delete preset', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Preset deleted');
  await expect(
    dialog.getByRole('group', { name: 'Workspace relation presets' }).getByRole('button', { name: /^Verification/ }),
  ).toHaveCount(0);
  const catalog = (await (await request.get('/api/canvas/boards')).json()).boards;
  expect(catalog.find((board: { id: string }) => board.id === boardB.id)).toEqual(originalB);
  expect(catalog.find((board: { id: string }) => board.id === boardA).relationVocabulary).toEqual([
    { kind: 'assesses', ink: 'derived', directed: false },
  ]);
  await dialog.getByRole('button', { name: 'Close relation presets' }).click();
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: boardA } });
  await expect(page.getByLabel('Filter board relations').locator('option')).toHaveText([
    'All relations',
    'supports · 1',
    'qualifies · 1',
  ]);
  await page.getByLabel('Filter board relations').selectOption('qualifies');
  await expect(page.getByRole('button', { name: 'qualifies 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Filter board relations')).toHaveValue('');
  await setWorkspaceFeatures(request, { knowledgeLifecycle: true });
  for (const filter of ['To review', 'Retired']) {
    const button = page.getByRole('button', { name: new RegExp(`^${filter} ·`) });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Settings' })).toHaveCount(0);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByLabel('Filter board relations').selectOption('qualifies');
  expect((await (await request.get('/api/canvas/state', { headers: HUMAN })).json()).edges).toEqual(originalEdges);
  const filtered = originalEdges.find((edge: { kind: string }) => edge.kind === 'qualifies');
  expect((await request.delete('/api/canvas/edge', { headers: HUMAN, data: { id: filtered.id } })).ok()).toBe(true);
  await expect(page.getByLabel('Filter board relations')).toHaveValue('');
  const remaining = originalEdges.find((edge: { kind: string }) => edge.kind === 'supports');
  expect((await request.delete('/api/canvas/edge', { headers: HUMAN, data: { id: remaining.id } })).ok()).toBe(true);
  await expect(page.getByLabel('Filter board relations')).toHaveCount(0);
});

test('category glyph choices preserve custom glyphs and policy with clear search spacing', async ({
  page,
  request,
}) => {
  await setWorkspaceFeatures(request, { knowledgeLifecycle: true });
  const category = {
    id: 'glyph-picker',
    name: 'Glyph example',
    glyph: 'Ω',
    decayType: 'reality',
    rate: 'medium',
    cadenceDays: 37,
    triggers: [],
    revalidationMethod: 'Compare original evidence',
  };
  expect((await request.post('/api/canvas/knowledge/category', { headers: HUMAN, data: { category } })).ok()).toBe(
    true,
  );
  const savedCategory = async () => {
    const catalog = (await (await request.get('/api/canvas/knowledge')).json()) as {
      categories: Array<typeof category>;
    };
    return catalog.categories.find((item) => item.id === category.id);
  };
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await page.getByRole('button', { name: 'Categories', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'Categories', exact: true });
  await dialog.getByRole('button', { name: /^Ω Glyph example/ }).click();
  for (const width of [600, 1024, 1920, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const search = (await dialog.getByRole('searchbox', { name: 'Search categories' }).boundingBox())!;
    const add = (await dialog.getByRole('button', { name: 'Add category', exact: true }).boundingBox())!;
    expect(add.y - (search.y + search.height)).toBeGreaterThanOrEqual(8);
    const choices = dialog.getByRole('group', { name: 'Glyph choices' }).getByRole('button');
    await expect(choices).toHaveCount(9);
    for (const button of await choices.all()) {
      const bounds = (await button.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
  }
  await dialog.getByRole('button', { name: 'Choose glyph ▤', exact: true }).click();
  await expect(dialog.getByLabel('Glyph', { exact: true })).toHaveValue('▤');
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(category.name);
  expect(await savedCategory()).toEqual(category);
  await dialog.getByRole('button', { name: 'Save category', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Category saved.');
  expect(await savedCategory()).toEqual({ ...category, glyph: '▤' });
  await dialog.getByLabel('Glyph', { exact: true }).fill('Ж');
  await expect(dialog.getByRole('button', { name: 'Choose glyph ▤', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await dialog.getByRole('button', { name: 'Save category', exact: true }).click();
  await expect.poll(savedCategory).toEqual({ ...category, glyph: 'Ж' });
  await page.reload();
  await page.getByRole('button', { name: 'Categories', exact: true }).last().click();
  await dialog.getByRole('button', { name: /^Ж Glyph example/ }).click();
  await expect(dialog.getByLabel('Glyph', { exact: true })).toHaveValue('Ж');
  expect(await savedCategory()).toEqual({ ...category, glyph: 'Ж' });
});

test('Home board action labels stay on one line alongside review and more controls', async ({ page, request }) => {
  await setWorkspaceFeatures(request, { knowledgeLifecycle: true });
  const { board } = await (await request.post('/api/canvas/boards', { data: { name: 'Needs review' } })).json();
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: board.id } });
  const cardId = await note(request, 'Evidence to review', 120, 120, 'imported');
  expect(
    (
      await request.post(`/api/canvas/node/${cardId}/lifecycle`, {
        headers: HUMAN,
        data: {
          lifecycleOverride: {
            decayType: 'reality',
            rate: 'medium',
            cadenceDays: 7,
            triggers: [],
            revalidationMethod: 'Read the evidence',
          },
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await page.getByTestId('home-board').getByRole('button', { name: 'Needs review', exact: true }).click();
  const details = page.getByRole('complementary', { name: 'Board details' });
  await expect(details.getByRole('button', { name: 'Review cards', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1280, 1024, 600, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = (await details.boundingBox())!;
    for (const name of ['Open board', 'Review cards', 'More: move, rename, create from, delete']) {
      const button = details.getByRole('button', { name, exact: true });
      await expect(button).toBeInViewport({ ratio: 1 });
      const buttonBounds = (await button.boundingBox())!;
      expect(buttonBounds.x).toBeGreaterThanOrEqual(bounds.x);
      expect(buttonBounds.x + buttonBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    }
    expect(
      await details.getByRole('button', { name: 'Open board', exact: true }).evaluate((button) => {
        const text = document.createRange();
        text.selectNodeContents(button);
        return text.getClientRects().length;
      }),
    ).toBe(1);
  }
  await details.getByRole('button', { name: 'Open board', exact: true }).click();
  await expect(page.getByTestId('home-view')).toHaveCount(0);
  await expect(page.locator('.canvas-node').filter({ hasText: 'Evidence to review' })).toBeInViewport();
});

test('Home Review scopes individual cards, reveals grouped content and docks without validating unsaved edits', async ({
  page,
  request,
}) => {
  await setWorkspaceFeatures(request, { knowledgeLifecycle: true });
  // Folder policies outlive board deletion, including across runner invocations.
  // This case needs an unclassified sibling even in a reused workspace.
  for (const path of ['Projects', 'Projects/Child', 'Projects/Child/Long descendant folder']) {
    expect(
      (
        await request.post('/api/canvas/knowledge/folder', {
          headers: HUMAN,
          data: { path, categoryId: null, lifecycleOverride: null },
        })
      ).ok(),
    ).toBe(true);
  }
  const { board: scoped } = await (
    await request.post('/api/canvas/boards', {
      data: { name: 'Scoped evidence', folder: 'Projects/Child/Long descendant folder' },
    })
  ).json();
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: scoped.id } });
  const cardId = await note(request, 'Authoritative evidence', 120, 120, 'imported');
  await note(request, 'Neutral unclassified card', 650);
  const policy = {
    decayType: 'reality',
    rate: 'medium',
    cadenceDays: 7,
    triggers: [],
    revalidationMethod: 'Inspect original content',
  };
  expect(
    (
      await request.post(`/api/canvas/node/${cardId}/lifecycle`, {
        headers: HUMAN,
        data: { lifecycleOverride: policy },
      })
    ).ok(),
  ).toBe(true);
  const { id: groupId } = await (
    await request.post('/api/canvas/group', { headers: HUMAN, data: { title: 'Folded evidence', childIds: [cardId] } })
  ).json();
  await request.patch(`/api/canvas/node/${groupId}`, { headers: HUMAN, data: { collapsed: true } });
  const { board: outside } = await (
    await request.post('/api/canvas/boards', { data: { name: 'Outside scope', folder: 'ProjectsElsewhere' } })
  ).json();
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: outside.id } });
  const outsideId = await note(request, 'Outside evidence', 120, 120, 'imported');
  await request.post(`/api/canvas/node/${outsideId}/lifecycle`, {
    headers: HUMAN,
    data: { lifecycleOverride: policy },
  });
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const queue = page.getByRole('region', { name: 'Card review queue' });
  await expect(queue.getByRole('heading', { name: 'Knowledge review', exact: true })).toBeVisible();
  await queue.getByLabel('Review scope').selectOption('');
  await expect(queue.locator('tbody tr')).toHaveCount(2);
  await queue.getByLabel('Review scope').selectOption('Projects');
  await expect(queue).toContainText('Projects and descendants');
  await expect(queue.locator('tbody tr')).toHaveCount(1);
  await expect(queue).not.toContainText('Outside evidence');
  await expect(queue).toContainText('No review policy: 2 cards');
  await queue.getByLabel('Source warnings only').check();
  await expect(queue.locator('tbody tr')).toHaveCount(0);
  await queue.getByLabel('Source warnings only').uncheck();
  // A longer descendant option must not push the native scope arrow out of
  // view, even when a shorter parent is selected. Check the scroll containers,
  // not just the root document: Home can clip overflow inside its main pane.
  for (const width of [390, 600, 1024, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const queueBounds = (await queue.boundingBox())!;
    const scopeBounds = (await queue.getByLabel('Review scope').boundingBox())!;
    expect(scopeBounds.x + scopeBounds.width).toBeLessThanOrEqual(queueBounds.x + queueBounds.width);
    expect(await queue.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.locator('.home-main').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 600, height: 900 });
  await queue.getByRole('button', { name: 'Open review: Authoritative evidence on Scoped evidence' }).click();
  const drawer = page.getByRole('dialog', { name: 'Review card', exact: true });
  const card = page.locator(`[data-node-id="${cardId}"]`);
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole('heading', { name: 'Review card · Authoritative evidence', exact: true }),
  ).toBeVisible();
  await expect(card).toBeInViewport({ ratio: 1 });
  await expect(card).toContainText('Authoritative evidence body');
  await expect(drawer).not.toHaveAttribute('aria-modal', 'true');
  const region = (await page.locator('.canvas-region').boundingBox())!;
  const dock = (await drawer.boundingBox())!;
  expect(dock.y).toBeGreaterThanOrEqual(region.y + region.height - 1);
  expect(dock.x + dock.width).toBeLessThanOrEqual(600);
  for (const width of [1440, 600, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(card).toBeInViewport({ ratio: 1 });
    await drawer.getByRole('button', { name: 'Not now', exact: true }).click();
    await card.getByRole('button', { name: /review due/ }).click();
    await expect(drawer).toBeVisible();
    // The complete card must fit the actual canvas, not merely the browser
    // viewport behind a dock. Reopening exercises a different mount path.
    await expect
      .poll(async () => {
        const content = (await card.boundingBox())!;
        const canvas = (await page.locator('.canvas-region').boundingBox())!;
        return (
          content.x >= canvas.x &&
          content.y >= canvas.y &&
          content.x + content.width <= canvas.x + canvas.width &&
          content.y + content.height <= canvas.y + canvas.height
        );
      })
      .toBe(true);
  }
  await drawer.getByLabel('What did you check?').fill('Dismissal is not validation');
  await drawer.getByRole('button', { name: 'Not now', exact: true }).click();
  expect((await (await request.get(`/api/canvas/node/${cardId}/lifecycle`)).json()).records).toHaveLength(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await card.getByRole('button', { name: 'Expand (focus mode)', exact: true }).click();
  await page.getByRole('button', { name: '</> Source', exact: true }).click();
  await page.locator('.md-editor-expanded textarea').fill('Unsaved source must not validate');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await drawer.getByLabel('What did you check?').fill('This is still a draft');
  await expect(drawer.getByRole('button', { name: 'Checked, still correct', exact: true })).toBeDisabled();
  await expect(drawer).toContainText("Save the card's edits");
  const contentBounds = (await page.getByTestId('expanded-node').boundingBox())!;
  const sideDock = (await drawer.boundingBox())!;
  expect(contentBounds.x + contentBounds.width).toBeLessThanOrEqual(sideDock.x);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('.md-editor-expanded textarea')).toHaveValue('Unsaved source must not validate');
  const detail = await (await request.get(`/api/canvas/node/${cardId}/lifecycle`)).json();
  expect(detail.records).toHaveLength(0);
  expect((await (await request.get(`/api/canvas/node/${cardId}`)).json()).data.content).toBe(
    'Authoritative evidence body',
  );
});

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
  await setWorkspaceFeatures(request, { agentSessions: true });
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
  await setWorkspaceFeatures(request, { agentSessions: true });
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
    await page.route(/\/api\/canvas\/state\?includeBlobs=true(?:&|$)/, async (route) => {
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

test('group reference controls navigate and the blank frame retains selection', async ({ page, request }) => {
  const destination = (await (await request.post('/api/canvas/boards', { data: { name: 'Group destination' } })).json())
    .board;
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: destination.id } });
  const target = await note(request, 'Remote group evidence');
  const source = (await (await request.post('/api/canvas/boards', { data: { name: 'Group source' } })).json()).board;
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: source.id } });
  const neighbour = await note(request, 'Keyboard neighbour', 820, 200);
  const group = (await (
    await request.post('/api/canvas/group', {
      data: { title: 'Reference frame', x: 120, y: 120, width: 600, height: 360 },
    })
  ).json()) as { id: string };
  expect(
    (
      await request.post('/api/canvas/edge', {
        data: { from: group.id, to: target, toBoardId: destination.id, type: 'references' },
      })
    ).ok(),
  ).toBe(true);
  await request.post('/api/canvas/viewport', { data: { x: 0, y: 0, scale: 1 } });
  await page.goto('/workbench');
  const frame = page.locator(`.canvas-node[data-node-id="${group.id}"]`);
  const reference = frame.getByRole('region', { name: 'Cross-board references' }).getByRole('button');
  await expect(reference).toContainText('Remote group evidence');
  const box = (await reference.boundingBox())!;
  expect(
    await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.node-memory-links'), {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    }),
  ).toBe(true);
  const bounds = (await frame.boundingBox())!;
  await page.keyboard.down('Shift');
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.keyboard.up('Shift');
  await expect(frame).toHaveClass(/selected/);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(frame).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(`.canvas-node[data-node-id="${neighbour}"]`)).toBeFocused();
  await reference.click();
  await expect(page.getByRole('button', { name: /^Board: Group destination/ })).toBeVisible();
  await expect(page.locator(`.canvas-node[data-node-id="${target}"]`)).toBeVisible();
});

test('high-degree reference footers leave card content and actions usable', async ({ page, request }) => {
  test.setTimeout(120_000);
  const source = await note(request, 'Index');
  const sourceBoard = (await boards(request)).activeBoardId!;
  const target = (await (await request.post('/api/canvas/boards', { data: { name: 'Reference library' } })).json())
    .board;
  const batch = await request.post('/api/canvas/batch', {
    data: {
      operations: Array.from({ length: 103 }, (_, index) => ({
        op: 'node.add',
        args: {
          destinationBoardId: target.id,
          type: 'markdown',
          title: `Evidence ${index}`,
          content: `Source ${index}`,
          x: index * 400,
          y: 100,
        },
      })),
    },
  });
  const targets = (await batch.json()).results as Array<{ id: string }>;
  expect(targets).toHaveLength(103);
  expect(
    (
      await request.patch(`/api/canvas/node/${source}`, {
        data: {
          content: `# Index\n\n[[${target.id}#${targets[0].id}|Read evidence]]`,
          width: 640,
          height: 480,
          strictSize: true,
        },
      })
    ).ok(),
  ).toBe(true);
  for (const node of targets) {
    expect(
      (
        await request.post('/api/canvas/edge', {
          data: { from: source, to: node.id, toBoardId: target.id, type: 'references' },
        })
      ).ok(),
    ).toBe(true);
  }
  await page.goto('/workbench');
  const card = page.locator(`[data-node-id="${source}"]`);
  const link = card.getByRole('link', { name: 'Read evidence', exact: true });
  const checkNavigation = async (id: string) => {
    const destination = page.locator(`[data-node-id="${id}"]`);
    // Dense-board loading and focus can outlast the default five-second check.
    // Require the complete card inside the canvas and reachable by the pointer.
    await expect
      .poll(
        () =>
          destination.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const canvas = element.closest('.canvas-region')!.getBoundingClientRect();
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              rect.left >= canvas.left &&
              rect.right <= canvas.right &&
              rect.top >= canvas.top &&
              rect.bottom <= canvas.bottom &&
              element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
            );
          }),
        { timeout: 15_000 },
      )
      .toBe(true);
  };
  for (const [width, scale] of [
    [1440, 1],
    [1024, 0.68],
    [600, 0.68],
    [1920, 1],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await request.post('/api/canvas/viewport', { data: { x: 20, y: 90, scale } });
    // The HTTP acknowledgement precedes the rendered camera update. Start the
    // scrolling check only once this fixture's (120,120) card is at that camera.
    await expect
      .poll(() =>
        card.evaluate((element, scale) => {
          const rect = element.getBoundingClientRect();
          const canvas = element.closest('.canvas-region')!.getBoundingClientRect();
          return (
            Math.abs(rect.left - canvas.left - (120 * scale + 20)) < 0.1 &&
            Math.abs(rect.top - canvas.top - (120 * scale + 90)) < 0.1
          );
        }, scale),
      )
      .toBe(true);
    await expect(card.locator('.node-memory-link')).toHaveCount(103);
    await expect
      .poll(() =>
        link.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        }),
      )
      .toBe(true);
    await expect(card.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    if (width === 1440) {
      const before = await card.boundingBox();
      const references = card.getByRole('region', { name: 'Cross-board references' });
      await references.hover();
      await page.mouse.wheel(0, 300);
      await expect.poll(() => references.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await references.focus();
      await references.press('End');
      await expect.poll(() => references.evaluate((element) => element.scrollTop)).toBeGreaterThan(2500);
      await references.press('Home');
      await expect.poll(() => references.evaluate((element) => element.scrollTop)).toBe(0);
      expect(await card.boundingBox()).toEqual(before);
    }
    const last = card.locator('.node-memory-link').last().getByRole('button');
    await last.scrollIntoViewIfNeeded();
    await last.click();
    await checkNavigation(targets[102].id);
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: sourceBoard } });
    await card.getByRole('button', { name: 'Expand (focus mode)', exact: true }).click();
    const expanded = page.getByTestId('expanded-node');
    const expandedReferences = expanded.getByRole('region', { name: 'Cross-board references' });
    await expect(expandedReferences.locator('.node-memory-link')).toHaveCount(103);
    await expandedReferences.focus();
    await expandedReferences.press('End');
    const expandedLast = expandedReferences.getByRole('button').last();
    await expect(expandedLast).toBeInViewport({ ratio: 1 });
    expect(
      await expandedLast.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const clip = element.closest('.node-memory-links')!.getBoundingClientRect();
        return (
          rect.top >= clip.top &&
          rect.bottom <= clip.bottom &&
          element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
        );
      }),
    ).toBe(true);
    await expect(expanded.locator('.md-reader-editable')).toContainText('Index');
    await expandedLast.click();
    await checkNavigation(targets[102].id);
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: sourceBoard } });
    await link.click();
    await checkNavigation(targets[0].id);
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: sourceBoard } });
  }
});

test('reading expanded Markdown preserves exact source while edits save before wiki navigation', async ({
  page,
  request,
}) => {
  const sourceBoard = (await (await request.post('/api/canvas/boards', { data: { name: 'Source library' } })).json())
    .board.id as string;
  const destination = (await (await request.post('/api/canvas/boards', { data: { name: 'Read destination' } })).json())
    .board;
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: sourceBoard } });
  const source = await note(request, 'Exact source');
  const content = `- One\n- Two\n\n| A | B |\n| --- | --- |\n| Left | Right |\n\n[[${destination.id}|Read destination]]\n`;
  await request.patch(`/api/canvas/node/${source}`, { data: { content } });
  const target = (
    await (
      await request.post('/api/canvas/node', {
        data: { destinationBoardId: destination.id, type: 'markdown', title: 'Remote evidence', content: 'Evidence' },
      })
    ).json()
  ).id as string;
  expect(
    (
      await request.post('/api/canvas/edge', {
        data: { from: source, to: target, toBoardId: destination.id, type: 'references' },
      })
    ).ok(),
  ).toBe(true);
  const original = await (await request.get(`/api/canvas/node/${source}`)).json();
  await page.goto('/workbench');
  const card = page.locator(`[data-node-id="${source}"]`);
  const editor = page.locator('.md-reader-editable');
  for (const action of ['close', 'navigate', 'reference']) {
    await card.getByRole('button', { name: 'Expand (focus mode)', exact: true }).click();
    await expect(editor).toContainText('Read destination');
    await editor.focus();
    if (action === 'close') {
      await page.keyboard.press('Control+s');
      await page.getByTestId('expanded-node').getByRole('button', { name: 'Close', exact: true }).click();
    } else {
      if (action === 'reference') {
        await page
          .getByTestId('expanded-node')
          .getByRole('region', { name: 'Cross-board references' })
          .getByRole('button')
          .click();
      } else await editor.getByRole('link', { name: 'Read destination', exact: true }).click();
      await expect(page.getByRole('button', { name: /^Board: Read destination/ })).toBeVisible();
    }
    await expect(page.getByTestId('expanded-node')).toHaveCount(0);
    const unchanged = await (await request.get(`/api/canvas/node/${source}?board=${sourceBoard}`)).json();
    expect(unchanged.data.content).toBe(content);
    expect(unchanged.contentRevision).toBe(original.contentRevision);
    if (action !== 'close') {
      await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: sourceBoard } });
      await expect(page.getByRole('button', { name: /^Board: Source library/ })).toBeVisible();
    }
  }
  await card.getByRole('button', { name: 'Expand (focus mode)', exact: true }).click();
  await expect(editor).toContainText('Read destination');
  await editor.focus();
  await page.keyboard.press('Home');
  await page.keyboard.type('Actually edited ');
  await editor.getByRole('link', { name: 'Read destination', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Board: Read destination/ })).toBeVisible();
  const edited = await (await request.get(`/api/canvas/node/${source}?board=${sourceBoard}`)).json();
  expect(edited.data.content).toContain('Actually edited');
  expect(edited.contentRevision).toBeGreaterThan(original.contentRevision);

  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: sourceBoard } });
  await card.getByRole('button', { name: 'Expand (focus mode)', exact: true }).click();
  await expect(editor).toContainText('Actually edited');
  await editor.focus();
  await page.keyboard.press('Home');
  await page.keyboard.type('Reference edit ');
  let saveStarted = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/canvas/node/${source}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      saveStarted = true;
      await held;
    }
    await route.continue();
  });
  try {
    await page
      .getByTestId('expanded-node')
      .getByRole('region', { name: 'Cross-board references' })
      .getByRole('button')
      .click();
    await expect.poll(() => saveStarted).toBe(true);
    await expect(page.getByRole('button', { name: /^Board: Source library/ })).toBeVisible();
    release();
    await expect(page.getByRole('button', { name: /^Board: Read destination/ })).toBeVisible();
    const saved = await (await request.get(`/api/canvas/node/${source}?board=${sourceBoard}`)).json();
    expect(saved.data.content).toContain('Reference edit');
    expect(saved.contentRevision).toBeGreaterThan(edited.contentRevision);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }

  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: sourceBoard } });
  await card.getByRole('button', { name: 'Expand (focus mode)', exact: true }).click();
  await expect(editor).toContainText('Reference edit');
  await editor.focus();
  await page.keyboard.press('Home');
  await page.keyboard.type('Refused edit ');
  await page.route(`**/api/canvas/node/${source}`, (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 409, json: { ok: false, error: 'Source changed during this edit.' } })
      : route.continue(),
  );
  await page
    .getByTestId('expanded-node')
    .getByRole('region', { name: 'Cross-board references' })
    .getByRole('button')
    .click();
  await expect(page.locator('.attention-toast')).toContainText('Source changed during this edit.');
  await expect(page.getByRole('button', { name: /^Board: Source library/ })).toBeVisible();
  await expect(editor).toContainText('Refused edit');
  const refused = await (await request.get(`/api/canvas/node/${source}?board=${sourceBoard}`)).json();
  expect(refused.data.content).not.toContain('Refused edit');
  await page.unrouteAll({ behavior: 'wait' });
});

for (const linkType of ['reference', 'wiki']) {
  test(`a later Home click cancels ${linkType} navigation waiting for a Markdown save`, async ({ page, request }) => {
    const sourceBoard = (await (await request.post('/api/canvas/boards', { data: { name: 'Save source' } })).json())
      .board.id as string;
    const destination = (
      await (await request.post('/api/canvas/boards', { data: { name: 'Save destination' } })).json()
    ).board.id as string;
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: sourceBoard } });
    const source = await note(request, 'Save before leaving');
    await request.patch(`/api/canvas/node/${source}`, { data: { content: `[[${destination}|Destination]]` } });
    const target = (
      await (
        await request.post('/api/canvas/node', {
          data: { destinationBoardId: destination, type: 'markdown', title: 'Destination', content: 'Evidence' },
        })
      ).json()
    ).id as string;
    await request.post('/api/canvas/edge', {
      data: { from: source, to: target, toBoardId: destination, type: 'references' },
    });
    await page.goto('/workbench');
    await page
      .locator(`[data-node-id="${source}"]`)
      .getByRole('button', { name: 'Expand (focus mode)', exact: true })
      .click();
    const editor = page.locator('.md-reader-editable');
    await expect(editor).toContainText('Destination');
    await editor.focus();
    await page.keyboard.press('Home');
    await page.keyboard.type('Saved before Home ');
    let releaseSave!: () => void;
    let releaseHome!: () => void;
    const heldSave = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const heldHome = new Promise<void>((resolve) => {
      releaseHome = resolve;
    });
    await page.route(`**/api/canvas/node/${source}`, async (route) => {
      if (route.request().method() === 'PATCH') await heldSave;
      await route.continue();
    });
    const requestedBoards: Array<string | null> = [];
    await page.route('**/api/canvas/boards/open', async (route) => {
      const id = route.request().postDataJSON().id as string | null;
      requestedBoards.push(id);
      if (id === null) await heldHome;
      await route.continue();
    });
    try {
      const saveRequest = page.waitForRequest(
        (req) => req.method() === 'PATCH' && req.url().endsWith(`/node/${source}`),
      );
      if (linkType === 'reference') {
        await page
          .getByTestId('expanded-node')
          .getByRole('region', { name: 'Cross-board references' })
          .getByRole('button')
          .click();
      } else await editor.getByRole('link', { name: 'Destination', exact: true }).click();
      await saveRequest;
      await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
      await expect.poll(() => requestedBoards).toEqual([null]);
      const saveResponse = page.waitForResponse(
        (res) => res.request().method() === 'PATCH' && res.url().endsWith(`/node/${source}`),
      );
      releaseSave();
      expect((await saveResponse).status()).toBe(200);
      // Home has not reached the server, so board identity alone cannot cancel the older jump.
      await expect(page.getByRole('button', { name: /^Board: Save source/ })).toBeVisible();
      await page.getByTestId('expanded-node').getByRole('button', { name: '</> Source', exact: true }).click();
      await expect(
        page.getByTestId('expanded-node').getByRole('button', { name: 'Saved', exact: true }),
      ).toBeDisabled();
      releaseHome();
      await expect(page.getByRole('button', { name: /^Board: Home/ })).toBeVisible();
      expect(requestedBoards).toEqual([null]);
      expect((await boards(request)).activeBoardId).toBeNull();
      const saved = await (await request.get(`/api/canvas/node/${source}?board=${sourceBoard}`)).json();
      expect(saved.data.content).toContain('Saved before Home');
    } finally {
      releaseSave();
      releaseHome();
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
  await sourceCard.getByRole('button', { name: 'Expand (focus mode)', exact: true }).click();
  await editor.getByRole('link', { name: 'Read the evidence' }).click();
  await expect(page.getByRole('button', { name: /^Board: Renamed research/ })).toBeVisible();
  await expect(card).toBeInViewport();
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: source.id } });
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
  await sourceCard.getByRole('button', { name: 'Expand (focus mode)', exact: true }).click();
  await page.getByRole('button', { name: '</> Source', exact: true }).click();
  const rawSource = page.locator('.md-editor-expanded textarea');
  // A real rich edit must save before creating and binding the missing board.
  await rawSource.fill(`${edited.data.content}\n`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to document', exact: true }).click();
  await editor.focus();
  await page.keyboard.press('Home');
  await page.keyboard.type('Before creating the board: ');
  const blurSaved = page.waitForResponse(
    (response) => response.url().endsWith(`/api/canvas/node/${claim}`) && response.request().method() === 'PATCH',
  );
  await editor.getByRole('link', { name: 'New investigation', exact: true }).click();
  await blurSaved;
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
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: source.id } });
  await request.patch(`/api/canvas/node/${claim}`, {
    data: { content: `${savedSource.data.content}\n\n[[Conflicted investigation]]` },
  });
  await page.getByRole('link', { name: 'Conflicted investigation', exact: true }).click();
  const peerContent = 'A peer changed this source while its link dialog was open.';
  await request.patch(`/api/canvas/node/${claim}`, { data: { content: peerContent } });
  await page.getByRole('dialog').getByRole('button', { name: 'Create board', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Board created, but the source changed');
  expect((await (await request.get(`/api/canvas/node/${claim}`)).json()).data.content).toBe(peerContent);
  expect((await boards(request)).activeBoardId).toBe(source.id);
});

test('narrow library filters remain reachable alongside retained Updates', async ({ page, request }) => {
  const id = await note(request, 'Retained update probe');
  const original = (await boards(request)).activeBoardId!;
  const second = (await (await request.post('/api/canvas/boards', { data: { name: 'Context peer' } })).json()).board;
  for (const boardId of [original, second.id]) {
    expect((await request.post(`/api/canvas/boards/${boardId}/pin`, { headers: HUMAN })).ok()).toBe(true);
  }
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto('/workbench');
  await page.route(`**/api/canvas/node/${id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    await route.fulfill({ status: 409, json: { ok: false, error: 'Keep this review note.' } });
  });
  await page.locator(`[data-node-id="${id}"] .node-title`).click();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('button', { name: /Recent updates/i })).toBeVisible();
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  // Home intentionally clears board attention. A refused write while browsing
  // the library supplies a real retained notice, rather than injecting UI state.
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await page.route('**/api/canvas/boards', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({ status: 409, json: { ok: false, error: 'Library is temporarily read-only.' } });
  });
  await page.getByRole('button', { name: /Board:/ }).click();
  await page.getByRole('menuitem', { name: 'New board…', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Refused library board');
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await page.keyboard.press('Escape');
  const updates = page.getByRole('button', { name: /Recent updates/i });
  await expect(updates).toBeVisible();
  const filters = page.getByRole('button', { name: 'Filters', exact: true });
  const a = (await updates.boundingBox())!;
  const b = (await filters.boundingBox())!;
  expect(a.y >= b.y + b.height || b.y >= a.y + a.height || a.x >= b.x + b.width || b.x >= a.x + a.width).toBe(true);
  await filters.click();
  await expect(filters).toHaveAttribute('aria-expanded', 'true');
  const search = page.getByRole('searchbox', { name: 'Search graph', exact: true });
  for (const width of [390, 600, 760, 390]) {
    await page.setViewportSize({ width, height: 900 });
    // The toolbar can wrap on resize. Observe the painted layout after its
    // ResizeObserver has positioned Updates, not rectangles from different frames.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const a = (await updates.boundingBox())!;
    const b = (await filters.boundingBox())!;
    expect(a.y >= b.y + b.height || b.y >= a.y + a.height || a.x >= b.x + b.width || b.x >= a.x + a.width).toBe(true);
    await filters.click();
    await expect(filters).toHaveAttribute('aria-expanded', 'false');
    await filters.click();
    await expect(filters).toHaveAttribute('aria-expanded', 'true');
    const tab = (await updates.boundingBox())!;
    const field = (await search.boundingBox())!;
    expect(tab.x + tab.width <= field.x || tab.y + tab.height <= field.y).toBe(true);
    expect(tab.x).toBeGreaterThanOrEqual(0);
    await search.fill('Search still reachable');
    await expect(search).toHaveValue('Search still reachable');
    await search.fill('');
    const context = page.getByTestId('context-chip');
    const chip = (await context.boundingBox())!;
    expect(chip.x + chip.width).toBeLessThanOrEqual(width);
    await context.click();
    await expect(page.getByRole('dialog', { name: "In the agent's context" })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('external-indicator').click();
    await expect(page.getByTestId('activity-feed')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('activity-feed')).toHaveCount(0);
  }
  await updates.click();
  await expect(page.getByRole('complementary', { name: 'Recent semantic changes' })).toBeVisible();
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

test('a draft render delayed across A → B → A never retargets a saved wiki link', async ({ page, request }) => {
  const targetName = 'Delayed render evidence';
  const first = (await (await request.post('/api/canvas/boards', { data: { name: targetName } })).json()).board;
  const source = (await (await request.post('/api/canvas/boards', { data: { name: 'Render owner A' } })).json()).board;
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: source.id } });
  const original = `[[${targetName}|Read evidence]]`;
  const claim = (
    await (
      await request.post('/api/canvas/node', {
        data: { type: 'markdown', title: 'Qualified draft', content: original, x: 100, y: 100, width: 480 },
      })
    ).json()
  ).id;
  await request.patch(`/api/canvas/boards/${first.id}`, { data: { name: 'Archived render evidence' } });
  const replacement = (await (await request.post('/api/canvas/boards', { data: { name: targetName } })).json()).board;
  const other = (await (await request.post('/api/canvas/boards', { data: { name: 'Render owner B' } })).json()).board;
  await page.goto('/workbench');
  await page.locator(`[data-node-id="${claim}"]`).getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: '</> Source', exact: true }).click();
  await expect(page.locator('.md-preview a.wiki-link')).toHaveAttribute('data-wiki-board', first.id);
  const draft = `${original}\n\nHuman draft retained on A.`;
  let send!: () => void;
  let deliver!: () => void;
  const sending = new Promise<void>((resolve) => {
    send = resolve;
  });
  const delivering = new Promise<void>((resolve) => {
    deliver = resolve;
  });
  let captured = false;
  let processed = false;
  let status = 0;
  await page.route('**/api/render', async (route) => {
    const body = route.request().postDataJSON() as { markdown: string; nodeId?: string };
    if (captured || body.markdown !== draft || body.nodeId !== claim) return route.continue();
    captured = true;
    await sending;
    const response = await route.fetch();
    status = response.status();
    processed = true;
    await delivering;
    await route.fulfill({ response });
  });
  try {
    await page.locator('.md-editor-expanded textarea').fill(draft);
    await expect.poll(() => captured).toBe(true);
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: other.id } });
    await expect(page.getByRole('button', { name: /^Board: Render owner B/ })).toBeVisible();
    send();
    await expect.poll(() => processed).toBe(true);
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: source.id } });
    await expect(page.locator(`[data-node-id="${claim}"]`)).toBeVisible();
    await page.locator(`[data-node-id="${claim}"]`).getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: '</> Source', exact: true }).click();
    await expect(page.locator('.md-editor-expanded textarea')).toHaveValue(draft);
    await expect(page.locator('.md-preview a.wiki-link')).toHaveAttribute('data-wiki-board', first.id);
    deliver();
    await page.unrouteAll({ behavior: 'wait' });
    await page.getByRole('button', { name: 'Back to document', exact: true }).click();
    const link = page.getByRole('dialog', { name: 'Qualified draft' }).getByRole('link', { name: 'Read evidence' });
    await expect(link).toHaveAttribute('data-wiki-board', first.id);
    await expect(link).not.toHaveAttribute('data-wiki-board', replacement.id);
    expect(status).toBe(409);
    expect((await (await request.get(`/api/canvas/node/${claim}`)).json()).data.wikiLinks).toEqual([
      { ref: targetName, target: { boardId: first.id } },
    ]);
  } finally {
    send();
    deliver();
    await page.unrouteAll({ behavior: 'wait' });
  }
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
    await page.route(`**/api/canvas/node/${claim}`, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 409, json: { ok: false, error: 'Card update refused after file save.' } })
        : route.continue(),
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.attention-toast')).toContainText('Card update refused after file save.');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    await expect(editor).toHaveValue(saved);
    expect(readFileSync(path, 'utf8')).toBe(saved);
    await page.unroute(`**/api/canvas/node/${claim}`);
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
  await page.getByRole('button', { name: 'board: Context filter', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Only in context', exact: true }).check();
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

test('the shortcut reference accepts Escape immediately on a board and Home', async ({ page, request }) => {
  await note(request, 'Keyboard reference');
  await page.goto('/workbench');
  await expect(page.locator('.canvas-node')).toHaveCount(1);
  for (const surface of ['board', 'home']) {
    if (surface === 'home') await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    // Send Escape at the first committed overlay, before a deferred effect can
    // catch up. A painted dialog must not depend on a later keyboard subscription.
    const opened = page.evaluate(
      () =>
        new Promise<string | null>((resolve) => {
          const observer = new MutationObserver(() => {
            const overlay = document.querySelector('.shortcut-overlay');
            if (!overlay) return;
            observer.disconnect();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            resolve(overlay.textContent);
          });
          observer.observe(document.body, { childList: true, subtree: true });
        }),
    );
    await page.getByRole('menuitem', { name: 'Keyboard shortcuts', exact: true }).click();
    expect(await opened).toContain('Keyboard Shortcuts');
    await expect(page.locator('.shortcut-overlay')).toHaveCount(0);
  }
});

test('Escape deselects in Home Folders and Map after closing menus first', async ({ page, request }) => {
  const { board } = await (await request.post('/api/canvas/boards', { data: { name: 'Escape selection' } })).json();
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: board.id } });
  await note(request, 'Selection evidence');
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  for (const mode of ['Folders', 'Map']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    const selected = page.getByRole('button', {
      name: mode === 'Folders' ? 'Escape selection' : 'board: Escape selection',
      exact: true,
    });
    await selected.click();
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    const camera = mode === 'Folders' ? null : await page.locator('.home-memory-world').getAttribute('style');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Settings' })).toHaveCount(0);
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(selected).toHaveAttribute('aria-pressed', 'false');
    if (mode !== 'Folders') await expect(page.locator('.home-memory-world')).toHaveAttribute('style', camera!);
    await expect(page.getByRole('button', { name: 'Board: Home. Switch board', exact: true })).toBeVisible();
  }
});

test('Graph stays live through agent board switches without losing camera, selection or anchors', async ({
  page,
  request,
}) => {
  const { board } = await (
    await request.post('/api/canvas/boards', { data: { name: 'Live library', folder: 'Research/Pricing' } })
  ).json();
  await request.post('/api/canvas/boards/open', { data: { id: board.id } });
  const source = await note(request, 'Live source');
  const target = await note(request, 'Live conclusion', 520);
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.getByRole('button', { name: 'board: Live library', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'board: Live library', exact: true }).click();
  const sourceNode = page.getByRole('button', { name: 'card: Live source', exact: true });
  await sourceNode.click();
  await page.getByRole('button', { name: 'Expand details', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  const anchors = () =>
    page.locator('.graph-node').evaluateAll((nodes) =>
      nodes.map((node) => ({
        key: node.getAttribute('data-key'),
        left: (node as HTMLElement).style.left,
        top: (node as HTMLElement).style.top,
      })),
    );
  const originalAnchors = await anchors();
  const camera = await page.locator('.home-memory-world').getAttribute('style');
  // Real agent writes reopen a board from Home. The human's library view must stay mounted.
  expect((await request.post('/api/canvas/boards/open', { data: { id: board.id } })).ok()).toBe(true);
  expect(
    (
      await request.patch(`/api/canvas/node/${source}`, {
        data: { title: 'Live source updated', content: 'New source facts' },
      })
    ).ok(),
  ).toBe(true);
  const updated = page.getByRole('button', { name: 'card: Live source updated', exact: true });
  await expect(updated).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Board: Home. Switch board', exact: true })).toBeVisible();
  await expect(page.locator('.home-memory-world')).toHaveAttribute('style', camera!);
  expect(await anchors()).toEqual(originalAnchors);
  expect(
    (
      await request.post('/api/canvas/edge', {
        data: { from: source, to: target, type: 'references', kind: 'supports', reason: 'Live evidence' },
      })
    ).ok(),
  ).toBe(true);
  const details = page.getByRole('complementary', { name: 'Selection details' });
  await expect(details).toContainText('supports (why: Live evidence)');
  await expect(page.getByRole('button', { name: 'card: Live conclusion', exact: true })).toBeVisible();
  // Only the new neighbor gets an anchor; the existing focus must not move.
  const withNeighbor = await anchors();
  expect(withNeighbor).toHaveLength(2);
  expect(withNeighbor).toEqual(expect.arrayContaining(originalAnchors));
  expect((await request.post('/api/canvas/context-pins', { headers: HUMAN, data: { nodeIds: [source] } })).ok()).toBe(
    true,
  );
  await expect(details).toContainText('⌖ In context');
  await expect(updated.locator('..')).toHaveClass(/in-context/);
  await page.locator('.home-memory-toolbar').click();
  await page.keyboard.press('m');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('https://example.com/not-a-hidden-board-card'));
  await page.keyboard.press('ControlOrMeta+v');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Keyboard shortcuts', exact: true }).click();
  await expect(page.locator('.shortcut-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.shortcut-overlay')).toHaveCount(0);
  expect((await (await request.get('/api/canvas/state')).json()).nodes).toHaveLength(2);
  await expect(page.locator('.graph-node.is-card')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'board: Live library', exact: true })).toHaveCount(0);
  // The focused endpoint survives filters; only its neighbors are filtered out.
  const folder = page.getByRole('checkbox', { name: 'Research', exact: true });
  await expect(folder).toBeChecked();
  await folder.uncheck();
  await expect(updated).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'card: Live conclusion', exact: true })).toHaveCount(0);
  await folder.check();
  await expect(updated).toBeVisible();
  await request.patch(`/api/canvas/boards/${board.id}`, { data: { folder: 'Research/Pricing/Archive' } });
  await expect(details).toContainText('Research/Pricing/Archive');
  expect(await anchors()).toEqual(withNeighbor);
  await page.getByRole('button', { name: 'Fit view', exact: true }).click();
  await expect(updated).toBeInViewport();
  await details.getByRole('button', { name: 'Open card', exact: true }).click();
  await expect(page.locator(`[data-node-id="${source}"]`)).toBeInViewport();
  await expect(page.getByRole('button', { name: /^Board: Live library/ })).toBeVisible();
  // The same native clipboard gesture still creates a visible card once the board is open.
  await page.locator('.canvas-viewport').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('.canvas-node[data-node-type="webpage"]')).toBeInViewport();
  expect((await (await request.get('/api/canvas/state')).json()).nodes).toHaveLength(3);
});

test('Home Map persists human positions and Graph explores without opening a board', async ({ page, request }) => {
  const source = (
    await (await request.post('/api/canvas/boards', { data: { name: 'Planning map', folder: 'Work/Projects' } })).json()
  ).board;
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: source.id } });
  const claim = await note(request, 'A decision to explore');
  await request.post('/api/canvas/boards', { data: { name: 'Unlinked scratchpad' } });
  const remote = (await (await request.post('/api/canvas/boards', { data: { name: 'Remote research' } })).json()).board;
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: remote.id } });
  const evidence = await note(request, 'Remote Map evidence', 2600, 1800);
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: source.id } });
  await request.post('/api/canvas/edge', {
    data: { from: claim, to: evidence, toBoardId: remote.id, type: 'references' },
  });
  for (let index = 0; index < 4; index++) {
    const target = (
      await (
        await request.post('/api/canvas/node', {
          data: {
            destinationBoardId: remote.id,
            type: 'markdown',
            title: `Further evidence ${index}`,
            content: 'Evidence',
          },
        })
      ).json()
    ).id as string;
    expect(
      (
        await request.post('/api/canvas/edge', {
          data: { from: claim, to: target, toBoardId: remote.id, type: 'references' },
        })
      ).ok(),
    ).toBe(true);
  }
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  const discoveryResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/canvas/memory-graph',
  );
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const discovery = await discoveryResponse;
  expect(new URL(discovery.url()).searchParams.get('projection')).toBe('boards');
  expect((await discovery.json()).nodes.every((node: { kind: string }) => node.kind === 'board')).toBe(true);
  const help = (await page.locator('.home-memory-empty-details .home-memory-help').boundingBox())!;
  const collapse = (await page.getByRole('button', { name: 'Collapse details', exact: true }).boundingBox())!;
  expect(help.y).toBeGreaterThan(collapse.y + collapse.height);
  const tile = page.getByRole('button', { name: 'board: Planning map', exact: true });
  await expect(tile).toBeVisible();
  await expect(page.getByRole('button', { name: 'board: Unlinked scratchpad', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /▾ Work 1 boards/ }).click();
  await expect(tile).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'board: Unlinked scratchpad', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /▸ Work 1 boards/ }).click();
  await expect(page.getByRole('button', { name: /▾ Projects 1 boards/ })).toBeVisible();
  await page.getByRole('button', { name: 'Fit view', exact: true }).click();
  const mapOrigin = () =>
    tile.evaluate((button) => {
      const node = button.parentElement!;
      return { x: node.offsetLeft - node.offsetWidth / 2, y: node.offsetTop - node.offsetHeight / 2 };
    });
  const originalPosition = await mapOrigin();
  const scale = await page
    .locator('.home-memory-world')
    .evaluate((world) => new DOMMatrix(getComputedStyle(world).transform).a);
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
    .toEqual({
      x: expect.closeTo(originalPosition.x + 65 / scale, 3),
      y: expect.closeTo(originalPosition.y + 35 / scale, 3),
    });
  const saved = await mapOrigin();
  const dragged = await tile.boundingBox();
  expect(dragged!.x).toBeCloseTo(initial.x + 65, 0);
  expect(dragged!.y).toBeCloseTo(initial.y + 35, 0);
  await page.reload();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(tile).toBeVisible();
  await expect.poll(mapOrigin).toEqual(saved);
  await tile.click();
  const inspector = page.locator('.home-memory-inspector');
  const details = page.getByRole('complementary', { name: 'Selection details' });
  const resize = page.getByRole('separator', { name: 'Resize relation details' });
  await expect(details.getByRole('button', { name: 'Remote Map evidence', exact: true })).toBeVisible();
  const legend = (await page.getByLabel('Legend', { exact: true }).boundingBox())!;
  expect((await inspector.boundingBox())!.y).toBeGreaterThanOrEqual(legend.y + legend.height);
  expect((await inspector.boundingBox())!.width).toBeCloseTo(
    (await page.getByRole('main', { name: 'Library Map' }).boundingBox())!.width,
    0,
  );
  const camera = await page.locator('.home-memory-world').getAttribute('style');
  const height = (await inspector.boundingBox())!.height;
  expect(height).toBe(280);
  const handle = (await resize.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 64, { steps: 8 });
  await page.mouse.up();
  expect((await inspector.boundingBox())!.height).toBeCloseTo(height + 64, 0);
  await resize.press('ArrowDown');
  await resize.press('ArrowDown');
  expect((await inspector.boundingBox())!.height).toBeCloseTo(height, 0);
  await page.getByRole('button', { name: 'Collapse details', exact: true }).click();
  await expect(details.locator('li').first()).toBeHidden();
  await expect(details.getByRole('button', { name: 'Open board', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand details', exact: true }).click();
  await expect(page.locator('.home-memory-world')).toHaveAttribute('style', camera!);
  expect(await mapOrigin()).toEqual(saved);
  for (const width of [600, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 600) {
      await page.getByRole('button', { name: 'Fit view', exact: true }).click();
      await tile.click();
      await expect(page.getByRole('button', { name: 'Filters', exact: true })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    }
    await expect(details.getByRole('button', { name: 'Remote Map evidence', exact: true })).toBeVisible();
    const bounds = (await inspector.boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    const actions = (await details.locator('.home-memory-actions').boundingBox())!;
    const body = (await details.locator('.home-memory-detail-body').boundingBox())!;
    expect(body.y - (actions.y + actions.height)).toBeGreaterThanOrEqual(8);
    expect((await page.locator('.home-memory-stage').boundingBox())!.height).toBeGreaterThanOrEqual(160);
  }
  for (const width of [1280, 600]) {
    await page.setViewportSize({ width, height: 900 });
    for (const height of [280, 380]) {
      const separator = (await resize.boundingBox())!;
      const current = (await inspector.boundingBox())!.height;
      await page.mouse.move(separator.x + 100, separator.y + separator.height / 2);
      await page.mouse.down();
      await page.mouse.move(separator.x + 100, separator.y + separator.height / 2 + current - height, { steps: 5 });
      await page.mouse.up();
      const last = details.locator('.home-memory-connections li').last();
      await last.getByRole('button').scrollIntoViewIfNeeded();
      expect(
        await last.evaluate((row) => {
          const scroller = row.closest('.home-memory-detail-body')!;
          const clip = scroller.getBoundingClientRect();
          const style = getComputedStyle(scroller);
          return row.getBoundingClientRect().bottom <= clip.bottom - Number.parseFloat(style.borderBottomWidth);
        }),
      ).toBe(true);
    }
  }
  await details.locator('.home-memory-detail-body').evaluate((body) => {
    body.scrollTop = 0;
  });
  await expect(page.locator('.home-memory-sidebar')).not.toContainText('Remote Map evidence');
  expect((await boards(request)).activeBoardId).toBeNull();
  await page.getByRole('button', { name: 'Fit view', exact: true }).click();
  await page.getByRole('button', { name: 'Reset position', exact: true }).click();
  await expect.poll(mapOrigin).toEqual(originalPosition);
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
  await expect.poll(mapOrigin).toEqual(originalPosition);
  await page.unrouteAll();
  await page.getByRole('button', { name: "Pin board to the agent's context", exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Remote Map evidence', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remote Map evidence', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Board: Remote research/ })).toBeVisible();
  await expect(page.locator(`[data-node-id="${evidence}"]`)).toBeInViewport();
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.graph-node.is-board')).toHaveCount(2);
  await expect(page.locator('.graph-node.is-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'board: Unlinked scratchpad', exact: true })).toBeVisible();
  await expect(
    page.locator('.graph-unlinked .graph-tray-node').filter({ hasText: 'Unlinked scratchpad' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'board: Planning map', exact: true }).click();
  await expect(page.locator('.graph-node.is-board')).toHaveCount(1);
  expect((await boards(request)).activeBoardId).toBeNull();
  await expect(page.getByRole('button', { name: 'card: A decision to explore', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'card: A decision to explore', exact: true }).click();
  await page.getByRole('button', { name: 'Open card', exact: true }).click();
  await expect(page.locator('.canvas-node').filter({ hasText: 'A decision to explore' })).toBeInViewport();
});

test('Graph dragging moves through neighbors and settles locally at every exploration level', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const library: Array<{ id: string; card: string }> = [];
  for (const name of ['Dynamic graph', 'Neighbor one', 'Neighbor two']) {
    const { board } = await (await request.post('/api/canvas/boards', { headers: HUMAN, data: { name } })).json();
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: board.id } });
    library.push({ id: board.id, card: await note(request, `${name} evidence`) });
  }
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: library[0].id } });
  const second = await note(request, 'Local neighbor', 520);
  const third = await note(request, 'Local chain', 960);
  for (const target of [
    { card: second, id: library[0].id },
    { card: third, id: library[0].id },
    library[1],
    library[2],
  ])
    await request.post('/api/canvas/edge', {
      headers: HUMAN,
      data: { from: library[0].card, to: target.card, toBoardId: target.id, type: 'references', kind: 'supports' },
    });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.graph-node')).toHaveCount(3);
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /\/api\/canvas\/(boards|node|edge|context-pins|memory)/.test(request.url()))
      writes.push(request.url());
  });
  const boxes = () =>
    page.locator('.graph-node').evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { key: node.getAttribute('data-key'), x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
  const retained: Array<Awaited<ReturnType<typeof boxes>>> = [];
  for (const name of ['board: Dynamic graph', 'card: Dynamic graph evidence', 'card: Dynamic graph evidence']) {
    await page.getByRole('button', { name: 'Fit view', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    const dragged = page.getByRole('button', { name, exact: true });
    const before = await boxes();
    const key = await dragged.locator('..').getAttribute('data-key');
    const origin = before.find((node) => node.key === key)!;
    const peer = before.find((node) => node.key !== key)!;
    const destination = { x: peer.x + peer.width / 2, y: peer.y + peer.height / 2 };
    const camera = await page.locator('.home-memory-world').getAttribute('style');
    const path = await page.getByRole('navigation', { name: 'Graph path' }).textContent();
    await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2);
    await page.mouse.down();
    await page.mouse.move(destination.x, destination.y, { steps: 12 });
    await expect
      .poll(async () => {
        const r = (await dragged.boundingBox())!;
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })
      .toEqual({ x: expect.closeTo(destination.x, 0), y: expect.closeTo(destination.y, 0) });
    await expect.poll(async () => (await boxes()).find((node) => node.key === peer.key)).not.toEqual(peer);
    // Dispatch cancellation to check rollback of every displaced neighbor, not just the held node.
    await dragged.dispatchEvent('pointercancel', { pointerId: 1 });
    await page.mouse.up();
    await expect.poll(boxes).toEqual(before);
    await expect(page.getByRole('navigation', { name: 'Graph path' })).toHaveText(path!);
    await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2);
    await page.mouse.down();
    await page.mouse.move(destination.x, destination.y, { steps: 12 });
    await page.mouse.up();
    await expect(async () => {
      const settled = await boxes();
      await page.waitForTimeout(600);
      expect(await boxes()).toEqual(settled);
    }).toPass({ timeout: 15_000 });
    const after = await boxes();
    const held = after.find((node) => node.key === key)!;
    expect(held.x + held.width / 2).toBeCloseTo(destination.x, 0);
    expect(held.y + held.height / 2).toBeCloseTo(destination.y, 0);
    expect(after.find((node) => node.key === peer.key)).not.toEqual(peer);
    for (const [index, a] of after.entries())
      for (const b of after.slice(index + 1))
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(
          true,
        );
    await expect(page.locator('.home-memory-world')).toHaveAttribute('style', camera!);
    await expect(page.getByRole('navigation', { name: 'Graph path' })).toHaveText(path!);
    retained.push(after);
    await dragged.click();
  }
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(boxes).toEqual(retained[1]);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(boxes).toEqual(retained[0]);
  expect(writes).toEqual([]);
  expect((await boards(request)).activeBoardId).toBeNull();
});

test('Graph keeps dense connection routes drawn and readable while dragging and hovering', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const { board } = await (
    await request.post('/api/canvas/boards', { headers: HUMAN, data: { name: 'Routing' } })
  ).json();
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: board.id } });
  const cards: string[] = [];
  for (let i = 0; i < 32; i++) cards.push(await note(request, `Routing card ${i + 1}`));
  const links = cards.map((from, i) => ({ from, to: cards[(i + 1) % cards.length] }));
  for (let i = 2; i < 18; i++) links.push({ from: cards[0], to: cards[i] });
  for (const link of links)
    expect(
      (
        await request.post('/api/canvas/edge', {
          headers: HUMAN,
          data: { ...link, type: 'references', kind: 'supports' },
        })
      ).ok(),
    ).toBe(true);
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await page.getByRole('button', { name: 'board: Routing', exact: true }).click();
  await expect(page.locator('.graph-node')).toHaveCount(32);
  await expect(page.locator('.graph-link')).toHaveCount(48);
  await page.getByRole('button', { name: 'Fit view', exact: true }).click();
  const first = page.getByRole('button', { name: 'card: Routing card 1', exact: true });
  const second = page.getByRole('button', { name: 'card: Routing card 2', exact: true });
  const origin = (await first.boundingBox())!,
    target = (await second.boundingBox())!;
  await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2);
  const frames = page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const counts: number[] = [];
        const sample = () => {
          counts.push(document.querySelectorAll('.graph-link').length);
          if (counts.length < 240) requestAnimationFrame(sample);
          else resolve(counts);
        };
        requestAnimationFrame(sample);
      }),
  );
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 20 });
  await page.mouse.up();
  expect(await frames).toEqual(Array(240).fill(48));
  await expect(page.locator('.graph-link')).toHaveCount(48);
  // Most auto-settled cards need breathing room, not just a collision-free border.
  const gaps = await page.locator('.graph-node').evaluateAll((nodes) => {
    const boxes = nodes.map((node) => node.getBoundingClientRect());
    return boxes
      .map((box, index) =>
        Math.min(
          ...boxes.flatMap((peer, other) =>
            index === other
              ? []
              : [
                  Math.hypot(
                    Math.max(0, peer.left - box.right, box.left - peer.right),
                    Math.max(0, peer.top - box.bottom, box.top - peer.bottom),
                  ) / box.height,
                ],
          ),
        ),
      )
      .sort((a, b) => a - b);
  });
  expect(gaps[Math.floor(gaps.length / 2)]).toBeGreaterThanOrEqual(0.5);
  // Counting paths alone would accept a straight-line fallback hidden under node bodies.
  expect(
    await page.locator('.graph-links').evaluate((svg) => {
      const bodies = [...document.querySelectorAll('.graph-node')].map((node) => ({
        title: node.querySelector('strong')!.textContent,
        rect: node.getBoundingClientRect(),
      }));
      return [...svg.querySelectorAll<SVGPathElement>('.graph-link-line')].flatMap((path) => {
        const matrix = path.getScreenCTM()!;
        for (let length = 2; length < path.getTotalLength(); length += 3) {
          const p = path.getPointAtLength(length);
          const point = new DOMPoint(p.x, p.y).matrixTransform(matrix);
          // Exclude the painted border, where a route is supposed to meet its endpoint.
          const covered = bodies.find(
            ({ rect: r }) =>
              point.x > r.left + 1 && point.x < r.right - 1 && point.y > r.top + 1 && point.y < r.bottom - 1,
          );
          if (covered) return [{ link: path.parentElement!.getAttribute('aria-label'), hiddenBy: covered.title }];
        }
        return [];
      });
    }),
  ).toEqual([]);
  await first.hover();
  expect(
    await page
      .locator('.graph-link')
      .evaluateAll((links) => links.every((link) => Number(getComputedStyle(link).opacity) >= 0.65)),
  ).toBe(true);
  expect((await boards(request)).activeBoardId).toBeNull();
});

test('Graph drills Library, Board and one-hop Card scenes without opening or pinning', async ({ page, request }) => {
  test.setTimeout(90_000);
  const library: Array<{ id: string; name: string; cards: string[] }> = [];
  const titles = [
    ['Interviews', 'SMB survey', 'Enterprise', 'Quote log', 'Signup poll'],
    ['Billing', 'Revenue', 'Churn', 'Retention', 'ARPA'],
    ['Competitors', 'Price sheet', 'Tier matrix', 'Teardown', 'Free tier'],
    ['Pricing', 'Pro at $24?', 'Margin model', 'Alt: usage', 'Assumptions'],
    ['Legal', 'Consent', 'Terms', 'Privacy', 'Review'],
    ['Delivery', 'Rollout', 'Owner', 'Capacity', 'Checklist'],
    ['Roadmap', 'Q4 launch', 'Milestone', 'Scope', 'Experiment'],
    ['Unlinked', 'Idea', 'Question', 'Scratch', 'Later'],
  ];
  for (const [index, [name, ...cards]] of titles.entries()) {
    const { board } = await (
      await request.post('/api/canvas/boards', {
        headers: HUMAN,
        data: { name, folder: index < 4 ? 'Research' : index < 7 ? 'Planning' : 'Scratch' },
      })
    ).json();
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: board.id } });
    const ids: string[] = [];
    for (const title of cards) ids.push(await note(request, title));
    library.push({ id: board.id, name, cards: ids });
  }
  const relations: Array<{ a: number; ac: number; b: number; bc: number; kind: string }> = [];
  for (const [a, b, count] of [
    [0, 1, 2],
    [0, 2, 1],
    [0, 3, 7],
    [1, 3, 7],
    [2, 3, 5],
    [3, 4, 3],
    [3, 5, 5],
    [3, 6, 4],
    [4, 5, 2],
    [5, 6, 2],
  ]) {
    for (let i = 0; i < count; i++) {
      const pricing = a === 3 || b === 3;
      const pc = i < 2 ? 0 : 1 + ((i - 2) % 3);
      const rc = i < 2 ? i : 2 + (Math.floor((i - 2) / 3) % 2);
      let ac = pricing && a === 3 ? pc : pricing ? rc : i % 4;
      let bc = pricing && b === 3 ? pc : pricing ? rc : (i + 1) % 4;
      let from = a,
        to = b;
      if (a === 0 && b === 3 && i === 1) {
        from = b;
        to = a;
        ac = 0;
        bc = 0;
      }
      relations.push({
        a: from,
        ac,
        b: to,
        bc,
        kind:
          a === 0 && b === 3 && i < 2
            ? i === 0
              ? 'contradicts'
              : 'cites'
            : ['supports', 'depends-on', 'related'][i % 3],
      });
    }
  }
  for (let a = 0; a < 8; a++)
    for (let i = 0; i < (a === 3 ? 3 : 1); i++)
      relations.push({ a, ac: a === 3 ? 1 + i : 1, b: a, bc: a === 3 ? 1 + ((i + 1) % 3) : 2, kind: 'related' });
  for (const relation of relations) {
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: library[relation.a].id } });
    expect(
      (
        await request.post('/api/canvas/edge', {
          headers: HUMAN,
          data: {
            from: library[relation.a].cards[relation.ac],
            to: library[relation.b].cards[relation.bc],
            ...(relation.a !== relation.b ? { toBoardId: library[relation.b].id } : {}),
            type: 'relation',
            kind: relation.kind,
            reason: `${relation.kind}: independently authored evidence`,
          },
        })
      ).ok(),
    ).toBe(true);
  }
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  const hub = (name: string) => page.getByRole('button', { name: `board: ${name}`, exact: true });
  const card = (name: string) => page.getByRole('button', { name: `card: ${name}`, exact: true });
  const world = page.locator('.home-memory-world');
  const details = page.getByRole('complementary', { name: 'Selection details' });
  // Entry stays at 100%; generated IDs can place Pricing outside the initial viewport.
  await expect(hub('Pricing')).toHaveCount(1);
  await expect(page.locator('.graph-accounting')).toHaveText(
    '48 links · 38 between boards · 10 inside boards · 0 missing',
  );
  await expect(page.locator('.graph-node.is-card')).toHaveCount(0);
  await expect(page.locator('.home-memory-inspector')).toHaveClass(/is-collapsed/);
  await expect(page.locator('.graph-link.is-bundle')).toHaveCount(10);
  expect(
    await page
      .locator('.graph-link.is-bundle')
      .evaluateAll((edges) => edges.map((edge) => Number(edge.getAttribute('data-count'))).sort((a, b) => a - b)),
  ).toEqual([1, 2, 2, 2, 3, 4, 5, 5, 7, 7]);
  await expect(page.locator('.graph-link.is-bundle .graph-link-line[marker-end]')).toHaveCount(0);
  await expectReadableGraphLabels(page, 9);
  expect(
    await page
      .locator('.graph-link.is-bundle')
      .evaluateAll((links) => links.every((link) => (link as SVGElement).style.stroke === 'var(--c-muted)')),
  ).toBe(true);
  await expect(page.locator('.graph-link.is-exact')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Explore board|Compare with/ })).toHaveCount(0);
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (
      /\/api\/canvas\/(boards|node|edge|context-pins|knowledge|memory)/.test(request.url()) &&
      request.method() !== 'GET'
    )
      mutations.push(request.url());
  });
  await page.getByPlaceholder('Search this graph…').fill('Pricing');
  await page.getByRole('button', { name: 'Pricing', exact: true }).click();
  await expect(hub('Pricing')).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const overviewCamera = await world.getAttribute('style');
  const pricingBox = (await hub('Pricing').boundingBox())!;
  const pricingAnchor = await hub('Pricing').locator('..').getAttribute('style');
  const x = pricingBox.x + pricingBox.width / 2;
  const y = pricingBox.y + pricingBox.height / 2;
  expect(
    await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), {
      x,
      y,
    }),
  ).toBe('board: Pricing');
  await page.mouse.move(x, y);
  await page.mouse.down();
  // A late unpressed move must not turn a click into a drag or move its node.
  const input = await page.context().newCDPSession(page);
  await input.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 24, y: y + 9, buttons: 0 });
  await page.mouse.up();
  await input.detach();
  await expect(page.getByRole('navigation', { name: 'Graph path' })).toHaveText('Library›Pricing');
  await expect(hub('Pricing')).toHaveCount(0);
  await expect(page.locator('.graph-node.is-board.is-external')).toHaveCount(6);
  await expect(page.locator('.graph-node.is-card')).toHaveCount(4);
  await expect(card('SMB survey')).toHaveCount(0);
  await expect(page.locator('.graph-link[data-count="0"]')).toHaveCount(0);
  await expect(page.locator('.graph-membership')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand details', exact: true }).click();
  const inspected = page.locator('.graph-link.is-exact').first();
  await inspected.focus();
  await expect(inspected).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(inspected).toHaveClass(/is-selected/);
  const inspectionId = await inspected.getAttribute('data-link-id');
  await page.getByPlaceholder('Search this graph…').fill('Pricing');
  // Filtering preserves the camera; use the search result to reach a peripheral card.
  await page.getByRole('button', { name: 'Pro at $24?', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  const boardCamera = await world.getAttribute('style');
  await card('Pro at $24?').click();
  await expect(card('Pro at $24?')).toHaveAttribute('aria-pressed', 'true');
  await expect(details.locator('li')).toHaveCount(12);
  await expect(details).toContainText('← contradicts');
  await expect(details).toContainText('→ cites');
  await expect(details).toContainText('why: contradicts: independently authored evidence');
  await expect(page.locator('.graph-node.is-board')).toHaveCount(0);
  // Exactly the focused card's authored one-hop facts, never neighbors' other edges.
  const expected = relations
    .filter((edge) => (edge.a === 3 && edge.ac === 0) || (edge.b === 3 && edge.bc === 0))
    .map((edge) => ({
      from: JSON.stringify([library[edge.a].id, library[edge.a].cards[edge.ac]]),
      to: JSON.stringify([library[edge.b].id, library[edge.b].cards[edge.bc]]),
    }));
  expect(
    await page
      .locator('.graph-link.is-exact')
      .evaluateAll((edges) =>
        edges.map((edge) => ({ from: edge.getAttribute('data-from'), to: edge.getAttribute('data-to') })),
      ),
  ).toEqual(expect.arrayContaining(expected));
  await expect(page.locator('.graph-link.is-exact')).toHaveCount(expected.length);
  await expectReadableGraphLabels(page, expected.length);
  expect(
    await page
      .locator('.graph-node.is-card')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-key')).sort()),
  ).toEqual([...new Set(expected.flatMap((edge) => [edge.from, edge.to]))].sort());
  // Directed neighbors sit on their authored side; bidirectional neighbors sit below.
  const positions = await page.locator('.graph-node').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { key: node.getAttribute('data-key')!, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }),
  );
  const focus = JSON.stringify([library[3].id, library[3].cards[0]]);
  const center = positions.find((node) => node.key === focus)!;
  for (const peer of positions.filter((node) => node.key !== focus)) {
    const incoming = expected.some((edge) => edge.from === peer.key && edge.to === focus);
    const outgoing = expected.some((edge) => edge.from === focus && edge.to === peer.key);
    if (incoming && outgoing) expect(peer.y).toBeGreaterThan(center.y);
    else if (incoming) expect(peer.x).toBeLessThan(center.x);
    else expect(peer.x).toBeGreaterThan(center.x);
  }
  await page.getByPlaceholder('Search this graph…').fill('Pro at');
  await page.getByRole('checkbox', { name: 'Card relations', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  const cardCamera = await world.getAttribute('style');
  await expect(page.getByRole('button', { name: 'Collapse details', exact: true })).toBeVisible();
  await details.getByRole('button', { name: 'Follow Q4 launch', exact: true }).click();
  await expect(card('Q4 launch')).toHaveAttribute('aria-pressed', 'true');
  await expect(card('Q4 launch')).toBeInViewport();
  await expect(hub('Roadmap')).toHaveCount(0);
  await expect(page.locator('.graph-node.is-board')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(card('Pro at $24?')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByPlaceholder('Search this graph…')).toHaveValue('Pro at');
  await expect(page.getByRole('checkbox', { name: 'Card relations', exact: true })).not.toBeChecked();
  await expect(world).toHaveAttribute('style', cardCamera!);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Graph path' })).toHaveText('Library›Pricing');
  await expect(page.getByPlaceholder('Search this graph…')).toHaveValue('Pricing');
  await expect(world).toHaveAttribute('style', boardCamera!);
  await expect(page.locator('.graph-link.is-selected')).toHaveAttribute('data-link-id', inspectionId!);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Graph path' })).toHaveText('Library');
  await expect(page.getByPlaceholder('Search this graph…')).toHaveValue('Pricing');
  await expect(world).toHaveAttribute('style', overviewCamera!);
  await expect(hub('Pricing').locator('..')).toHaveAttribute('style', pricingAnchor!);
  await expect(page.locator('.graph-node.is-card')).toHaveCount(0);
  expect(mutations).toEqual([]);
  expect((await boards(request)).activeBoardId).toBeNull();
});

test('Graph card ego preserves board-qualified duplicate IDs, directed facts and Escape hierarchy', async ({
  page,
  request,
}) => {
  const library: Array<{ id: string; card: string }> = [];
  for (const name of ['Qualified Alpha', 'Qualified Beta']) {
    const { board } = await (await request.post('/api/canvas/boards', { headers: HUMAN, data: { name } })).json();
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: board.id } });
    library.push({ id: board.id, card: await note(request, `${name} evidence`) });
    await note(request, `${name} unrelated card`);
  }
  await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: library[0].id } });
  const shared = library[0].card;
  // As in the switch-acceptance fixture, only storage seeding needs SQLite:
  // the create API generates fresh IDs, but restored boards may share raw card IDs.
  const db = new DatabaseSync(process.env.PMX_PLAYWRIGHT_DB_PATH ?? 'test-results/playwright/canvas.db');
  try {
    expect(
      db.prepare('UPDATE nodes SET id = ? WHERE board_id = ? AND id = ?').run(shared, library[1].id, library[1].card)
        .changes,
    ).toBe(1);
  } finally {
    db.close();
  }
  for (const [from, to, kind] of [
    [0, 1, 'contradicts'],
    [1, 0, 'cites'],
  ] as const) {
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: library[from].id } });
    expect(
      (
        await request.post('/api/canvas/edge', {
          headers: HUMAN,
          data: {
            from: shared,
            to: shared,
            toBoardId: library[to].id,
            type: 'relation',
            kind,
            reason: `${kind} original direction`,
          },
        })
      ).ok(),
    ).toBe(true);
  }
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.graph-link.is-bundle')).toHaveCount(1);
  await expect(page.locator('.graph-link.is-bundle')).toHaveAttribute('data-count', '2');
  await page.getByRole('button', { name: 'board: Qualified Alpha', exact: true }).click();
  await expect(page.locator('.graph-node.is-board.is-external')).toHaveCount(1);
  await expect(page.locator('.graph-unlinked .graph-tray-node')).toHaveText(/Qualified Alpha unrelated card/);
  await page.getByRole('button', { name: 'card: Qualified Alpha evidence', exact: true }).click();
  await expect(page.locator('.graph-node.is-card')).toHaveCount(2);
  await expect(page.locator('.graph-link.is-exact')).toHaveCount(2);
  const alpha = JSON.stringify([library[0].id, shared]);
  const beta = JSON.stringify([library[1].id, shared]);
  expect(
    await page
      .locator('.graph-node.is-card')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-key')).sort()),
  ).toEqual([alpha, beta].sort());
  expect(
    await page
      .locator('.graph-link.is-exact')
      .evaluateAll((edges) =>
        edges.map((edge) => [edge.getAttribute('data-from'), edge.getAttribute('data-to')]).sort(),
      ),
  ).toEqual(
    [
      [alpha, beta],
      [beta, alpha],
    ].sort(),
  );
  await expect(page.locator('.graph-link.is-exact > .graph-link-line[marker-end]')).toHaveCount(2);
  const details = page.getByRole('complementary', { name: 'Selection details' });
  await expect(details.locator('li').first()).toBeHidden();
  // Click the actual rendered curve, not an SVG group's empty bounding-box center.
  await page.getByRole('button', { name: 'Fit view', exact: true }).click();
  const point = await page
    .locator('.graph-link.is-exact .graph-link-line')
    .first()
    .evaluate((element) => {
      const path = element as SVGPathElement;
      const p = path.getPointAtLength(path.getTotalLength() / 2);
      const screen = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!);
      return { x: screen.x, y: screen.y };
    });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole('button', { name: 'Collapse details', exact: true })).toBeVisible();
  await expect(details.locator('li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Settings' })).toHaveCount(0);
  await expect(page.locator('.graph-link.is-selected')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.graph-link.is-selected')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'card: Qualified Alpha evidence', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(details.locator('li')).toHaveCount(2);
  await expect(details).toContainText('→ contradicts');
  await expect(details).toContainText('← cites');
  await expect(details).toContainText('Qualified Alpha evidence → Qualified Beta evidence');
  await expect(details).toContainText('Qualified Beta evidence → Qualified Alpha evidence');
  const camera = await page.locator('.home-memory-world').getAttribute('style');
  await details.getByRole('button', { name: 'Follow Qualified Beta evidence', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'card: Qualified Beta evidence', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'card: Qualified Beta evidence', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'card: Qualified Alpha evidence', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'card: Qualified Alpha evidence', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.home-memory-world')).toHaveAttribute('style', camera!);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Graph path' })).toHaveText('Library›Qualified Alpha');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Graph path' })).toHaveText('Library');
  expect((await boards(request)).activeBoardId).toBeNull();
});

test('Graph keeps a dense 12-board, 96-card, 111-link library as boards until explicitly explored', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const library: Array<{ id: string; cards: string[] }> = [];
  for (let index = 0; index < 12; index++) {
    const name = `Dense board ${String(index + 1).padStart(2, '0')}`;
    const { board } = await (
      await request.post('/api/canvas/boards', {
        headers: HUMAN,
        data: { name, folder: index < 6 ? 'Research' : 'Planning' },
      })
    ).json();
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: board.id } });
    const cards: string[] = [];
    for (let i = 0; i < 8; i++) cards.push(await note(request, `${name} card ${i + 1}`));
    library.push({ id: board.id, cards });
    for (let i = 0; i < 7; i++)
      expect(
        (
          await request.post('/api/canvas/edge', {
            headers: HUMAN,
            data: { from: cards[i], to: cards[i + 1], type: 'relation', kind: 'supports' },
          })
        ).ok(),
      ).toBe(true);
  }
  // 84 internal chains plus 27 independently chosen cross-board facts = 111, not membership.
  let cross = 0;
  for (let a = 0; a < 12 && cross < 27; a++) {
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: library[a].id } });
    for (let b = a + 1; b < 12 && cross < 27; b++, cross++)
      expect(
        (
          await request.post('/api/canvas/edge', {
            headers: HUMAN,
            data: {
              from: library[a].cards[0],
              to: library[b].cards[0],
              toBoardId: library[b].id,
              type: 'relation',
              kind: 'cites',
            },
          })
        ).ok(),
      ).toBe(true);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.graph-node.is-board')).toHaveCount(12);
  await expect(page.locator('.graph-node.is-card')).toHaveCount(0);
  await expect(page.locator('.graph-link.is-bundle')).toHaveCount(27);
  await expect(page.locator('.graph-accounting')).toHaveText(
    '111 links · 27 between boards · 84 inside boards · 0 missing',
  );
  // A fitted node census alone missed paths running through readable names.
  expect(
    await page.locator('.graph-links').evaluate((svg) => {
      const names = [...document.querySelectorAll('.graph-node strong')].map((node) => ({
        title: node.textContent,
        rect: node.getBoundingClientRect(),
      }));
      return [...svg.querySelectorAll<SVGPathElement>('.graph-link-line')].flatMap((path) => {
        const matrix = path.getScreenCTM()!;
        for (let length = 0; length < path.getTotalLength(); length += 4) {
          const p = path.getPointAtLength(length);
          const point = new DOMPoint(p.x, p.y).matrixTransform(matrix);
          const crossed = names.find(
            ({ rect: r }) => point.x > r.left && point.x < r.right && point.y > r.top && point.y < r.bottom,
          );
          if (crossed)
            return [
              {
                from: path.parentElement!.getAttribute('data-from'),
                to: path.parentElement!.getAttribute('data-to'),
                title: crossed.title,
                x: point.x,
                y: point.y,
              },
            ];
        }
        return [];
      });
    }),
  ).toEqual([]);
  for (const width of [1920, 1280, 1024, 600]) {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 900 });
    await page.getByRole('button', { name: 'Fit view', exact: true }).click();
    await expect(page.locator('.home-memory-toolbar')).toContainText('0 partly/outside view');
    const result = await page.locator('.home-memory-stage').evaluate((stage) => {
      const clip = stage.getBoundingClientRect();
      const labels = [...stage.querySelectorAll('.is-board .home-memory-select')].map((label) => ({
        title: label.querySelector('strong')!.textContent,
        rect: label.getBoundingClientRect(),
      }));
      return {
        clipped: labels
          .filter(
            ({ rect: r }) => r.left < clip.left || r.right > clip.right || r.top < clip.top || r.bottom > clip.bottom,
          )
          .map(({ title }) => title),
        overlaps: labels.flatMap((a, i) =>
          labels
            .slice(i + 1)
            .flatMap((b) =>
              a.rect.left < b.rect.right &&
              a.rect.right > b.rect.left &&
              a.rect.top < b.rect.bottom &&
              a.rect.bottom > b.rect.top
                ? [[a.title, b.title]]
                : [],
            ),
        ),
      };
    });
    expect(result, `board labels at ${width}px`).toEqual({ clipped: [], overlaps: [] });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('checkbox', { name: 'Planning', exact: true }).uncheck();
  await expect(page.locator('.graph-node.is-board')).toHaveCount(6);
  await expect(page.locator('.graph-accounting')).toHaveText(
    '111 links · 27 between boards · 84 inside boards · 0 missing',
  );
  await page.getByRole('checkbox', { name: 'Planning', exact: true }).check();
  // Hiding an entire kind removes its drawing, never its library accounting.
  await page.getByRole('checkbox', { name: 'Card relations', exact: true }).uncheck();
  await expect(page.locator('.graph-link.is-bundle')).toHaveCount(0);
  await expect(page.locator('.graph-accounting')).toHaveText(
    '111 links · 27 between boards · 84 inside boards · 0 missing',
  );
  await page.getByRole('checkbox', { name: 'Card relations', exact: true }).check();
  await page.getByRole('button', { name: 'board: Dense board 01', exact: true }).click();
  await expect(page.locator('.graph-node.is-card')).toHaveCount(8);
  await expect(page.locator('.graph-link.is-exact')).toHaveCount(7);
  await expect(page.locator('.graph-node.is-board.is-external')).toHaveCount(11);
  await expect(page.getByRole('button', { name: 'board: Dense board 01', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'card: Dense board 01 card 1', exact: true }).click();
  await expect(page.locator('.graph-node.is-board')).toHaveCount(0);
  await expect(page.locator('.graph-node.is-card')).toHaveCount(13);
  await expect(page.locator('.graph-link.is-exact')).toHaveCount(12);
  expect((await boards(request)).activeBoardId).toBeNull();
});

test('Graph caps a 220-card board and searches beyond the cap without opening content', async ({ page, request }) => {
  test.setTimeout(90_000);
  const dense: Array<{ id: string; title: string }> = [];
  for (const [name, folder, count] of [
    ['Dense research', 'Research', 220],
    ['Delivery', 'Planning', 1],
    ['Scratchpad', 'Scratch', 1],
  ] as const) {
    const { board } = await (await request.post('/api/canvas/boards', { data: { name, folder } })).json();
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: board.id } });
    const cards: string[] = [];
    for (let i = 0; i < count; i++) {
      const title = `${name} card ${String(i + 1).padStart(3, '0')}`;
      const id = await note(request, title);
      cards.push(id);
      if (name === 'Dense research') dense.push({ id, title });
    }
    // All 220 cards are genuinely connected; the first is the highest-degree endpoint.
    for (let i = 1; i < cards.length; i++)
      expect(
        (
          await request.post('/api/canvas/edge', {
            headers: HUMAN,
            data: { from: cards[0], to: cards[i], type: 'relation', kind: 'supports' },
          })
        ).ok(),
      ).toBe(true);
  }
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'PMX Canvas — Home' }).click();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.graph-node.is-board')).toHaveCount(0);
  await expect(page.locator('.graph-node.is-card')).toHaveCount(0);
  await expect(page.locator('.graph-unlinked .graph-tray-node')).toHaveCount(3);
  await page.getByPlaceholder('Search this graph…').fill('Delivery');
  await expect(page.locator('.graph-unlinked .graph-tray-node')).toHaveCount(1);
  await page.getByRole('button', { name: 'board: Delivery', exact: true }).click();
  await expect(page.locator('.graph-unlinked .graph-tray-node')).toHaveCount(1);
  await page.getByRole('button', { name: 'card: Delivery card 001', exact: true }).click();
  await expect(page.getByRole('button', { name: 'card: Delivery card 001', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByPlaceholder('Search this graph…').fill('');
  await page.getByRole('button', { name: 'board: Dense research', exact: true }).click();
  await expect(page.locator('.home-memory-toolbar')).toContainText('80 of 220 connected drawn');
  await expect(page.locator('.home-memory-toolbar')).toContainText('0 filtered · 140 hidden · 0 without links');
  await expect(page.locator('.graph-node.is-card')).toHaveCount(80);
  await expect(page.getByRole('button', { name: 'card: Dense research card 001', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show more connections', exact: true }).click();
  await expect(page.locator('.graph-node.is-card')).toHaveCount(160);
  await expect(page.locator('.home-memory-toolbar')).toContainText('160 of 220 connected');
  const shown = await page.locator('.graph-node strong').allTextContents();
  const beyondCap = dense.find((card) => !shown.includes(card.title))!;
  await expect(page.getByRole('button', { name: `card: ${beyondCap.title}`, exact: true })).toHaveCount(0);
  await page.getByPlaceholder('Search this graph…').fill(beyondCap.title);
  await expect(page.locator('.graph-node.is-card')).toHaveCount(1);
  await expect(page.locator('.home-memory-toolbar')).toContainText('1 of 220 connected');
  await page.locator('.graph-search-results').getByRole('button', { name: beyondCap.title, exact: true }).click();
  const found = page.getByRole('button', { name: `card: ${beyondCap.title}`, exact: true });
  await expect(found).toBeInViewport();
  await expect(found).toHaveAttribute('aria-pressed', 'false');
  await found.click();
  await expect(found).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Board: Home. Switch board', exact: true })).toBeVisible();
  expect((await boards(request)).activeBoardId).toBeNull();
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

for (const fetchedBeforeJump of [false, true]) {
  test(`a completed card jump survives an older catalog replay (response already fetched=${fetchedBeforeJump})`, async ({
    page,
    request,
  }) => {
    const a = (await (await request.post('/api/canvas/boards', { data: { name: 'Jump source' } })).json()).board.id;
    const b = (await (await request.post('/api/canvas/boards', { data: { name: 'Jump target' } })).json()).board.id;
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: b } });
    const target = await note(request, 'Far evidence', 2600, 1800);
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: a } });
    await request.post('/api/canvas/node', {
      data: { type: 'markdown', content: '[[Jump target#Far evidence|Jump]]', x: 100, y: 100 },
    });
    await page.goto('/workbench?transport=poll');
    await expect(page.getByRole('link', { name: 'Jump', exact: true })).toBeVisible();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fetchCatalog!: () => void;
    const catalogQueued = new Promise<void>((resolve) => {
      fetchCatalog = resolve;
    });
    let held = false;
    let fetched = false;
    await page.route('**/api/workbench/poll?*', async (route) => {
      held = true;
      if (fetchedBeforeJump) {
        await catalogQueued;
        const response = await route.fetch();
        fetched = true;
        await gate;
        await route.fulfill({ response });
      } else {
        await gate;
        await route.fulfill({ response: await route.fetch() });
      }
    });
    try {
      await expect.poll(() => held).toBe(true);
      expect(
        (await request.patch(`/api/canvas/boards/${a}`, { headers: HUMAN, data: { name: 'Renamed source' } })).ok(),
      ).toBe(true);
      fetchCatalog();
      if (fetchedBeforeJump) await expect.poll(() => fetched).toBe(true);
      await page.getByRole('link', { name: 'Jump', exact: true }).click();
      const card = page.locator(`[data-node-id="${target}"]`);
      await expect(card).toBeInViewport();
      const replay = page.waitForResponse((response) => response.url().includes('/api/workbench/poll?'));
      release();
      await replay;
      await page.waitForTimeout(500);
      await expect(page.getByRole('button', { name: /^Board: Jump target/ })).toBeVisible();
      await expect(card).toBeInViewport();
    } finally {
      fetchCatalog();
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}

for (const transport of ['sse', 'poll']) {
  test(`human Source save retains its draft and authorship after daemon restart (${transport})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const directory = mkdtempSync(join(tmpdir(), 'pmx-workbench-reconnect-'));
    let child: ChildProcess | undefined;
    let releaseReconnect!: () => void;
    const reconnectGate = new Promise<void>((resolve) => {
      releaseReconnect = resolve;
    });
    const stop = async () => {
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    };
    const start = async (port = 0): Promise<string> => {
      child = spawn('bun', ['run', 'src/cli/index.ts', '--no-open', `--port=${port}`], {
        env: {
          ...process.env,
          PMX_CANVAS_WORKSPACE_ROOT: directory,
          PMX_CANVAS_DB_PATH: join(directory, 'canvas.db'),
          PMX_CANVAS_DISABLE_BROWSER_OPEN: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let log = '';
      const url = await new Promise<string>((resolve, reject) => {
        child!.once('error', reject);
        child!.once('exit', () => reject(new Error(`Test daemon exited: ${log}`)));
        child!.stderr!.on('data', (chunk) => {
          log += String(chunk);
        });
        child!.stdout!.on('data', (chunk) => {
          log += String(chunk);
          const port = log.match(/PMX Canvas running at http:\/\/localhost:(\d+)/)?.[1];
          if (port) resolve(`http://127.0.0.1:${port}`);
        });
      });
      expect((await request.get(`${url}/health`)).ok()).toBe(true);
      return url;
    };
    try {
      const url = await start();
      const html = await (await request.get(`${url}/workbench`)).text();
      const token = JSON.parse(html.match(/window\.__PMX_WORKBENCH_TOKEN = ("[^"]+")/)![1]) as string;
      const created = await request.post(`${url}/api/canvas/node`, {
        headers: { 'x-pmx-workbench': '1', 'x-pmx-workbench-token': token },
        data: { type: 'markdown', title: 'Reconnect decision', content: 'Saved decision.', x: 100, y: 100 },
      });
      const { id } = await created.json();
      await page.goto(`${url}/workbench?transport=${transport}`);
      await page.locator(`[data-node-id="${id}"]`).getByRole('button', { name: 'Edit', exact: true }).click();
      await page.getByRole('button', { name: '</> Source', exact: true }).click();
      const editor = page.locator('.md-editor-expanded textarea');
      const draft = 'Saved decision.\n\nHuman continuation kept across restart.';
      await editor.fill(draft);
      await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(6, 15));
      const connected = page.waitForResponse(async (response) => {
        const path = new URL(response.url()).pathname;
        if (transport === 'sse') return path === '/api/workbench/events';
        if (path !== '/api/workbench/poll') return false;
        const body = await response.json();
        return body.events.some((entry: { event: string }) => entry.event === 'connected');
      });
      // Hold renewal, but let ordinary requests reach the restarted daemon.
      await page.route(/\/api\/workbench\/(?:events|poll)(?:\?|$)/, async (route) => {
        await reconnectGate;
        await route.continue();
      });
      await stop();
      expect(await start(Number(new URL(url).port))).toBe(url);
      const refused = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/api/canvas/node/${id}` && response.request().method() === 'PATCH',
      );
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      expect((await refused).status()).toBe(409);
      await expect(page.locator('.attention-toast')).toContainText('Reconnect before saving');
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
      await expect(editor).toHaveValue(draft);
      expect((await (await request.get(`${url}/api/canvas/node/${id}`)).json()).data.content).toBe('Saved decision.');
      releaseReconnect();
      await connected;
      // Wait for the reconnect snapshot's human heartbeat, not merely its response headers.
      await expect
        .poll(async () => (await (await request.get(`${url}/api/canvas/human-presence`)).json()).humans.length)
        .toBeGreaterThan(0);
      await expect(editor).toHaveValue(draft);
      expect(
        await editor.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd]),
      ).toEqual([6, 15]);
      // A refused draft belongs to the card, not the overlay component.
      await page.locator('.expanded-close').click();
      await page.locator(`[data-node-id="${id}"]`).getByRole('button', { name: 'Edit', exact: true }).click();
      await page.getByRole('button', { name: '</> Source', exact: true }).click();
      await expect(editor).toHaveValue(draft);
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
      const saved = await (await request.get(`${url}/api/canvas/node/${id}`)).json();
      expect(saved.data.content).toBe(draft);
      expect(saved.lastEditedBy.actor).toBe('human');
      expect((await (await request.get(`${url}/api/canvas/history`)).json()).top.actor).toBe('human');
      if (transport === 'poll') {
        await page.goto(`${url}/workbench?transport=poll&agent=reconnect-agent`);
        await page.locator(`[data-node-id="${id}"]`).getByRole('button', { name: 'Edit', exact: true }).click();
        await page.getByRole('button', { name: '</> Source', exact: true }).click();
        // Hold layout delivery: the acknowledgement must carry the actual author,
        // not rely on a later poll to correct a fabricated human byline.
        await page.route(/\/api\/workbench\/poll(?:\?|$)/, (route) => route.abort());
        await editor.fill('Agent continuation of the human decision.');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
        const edited = await (await request.get(`${url}/api/canvas/node/${id}`)).json();
        expect(edited.lastEditedBy).toMatchObject({ actor: 'agent', source: 'reconnect-agent' });
        await page.locator('.expanded-close').click();
        await expect(page.locator(`[data-node-id="${id}"] .node-type-icon`)).toHaveAttribute(
          'data-byline',
          'Edited by reconnect-agent',
        );
      }
    } finally {
      releaseReconnect();
      await page.unrouteAll({ behavior: 'wait' });
      await page.goto('about:blank');
      await stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test.describe('save and board ownership boundaries', () => {
  test.use({ deviceScaleFactor: 2 });
  for (const fileBacked of [false, true]) {
    test(`a suspended native Save refuses subsequent canonical content without changing its draft (file-backed=${fileBacked})`, async ({
      page,
      request,
      context,
    }) => {
      const directory = mkdtempSync(join(process.cwd(), '.pmx-save-fence-'));
      const path = join(directory, 'decision.md');
      const original = 'Original shared decision.';
      const draft = 'Human draft waiting for render.';
      const newer = 'Newer decision saved in another tab.';
      writeFileSync(path, original);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const peer = await context.newPage();
      try {
        const { id } = await (
          await request.post('/api/canvas/node', {
            headers: HUMAN,
            data: {
              type: 'markdown',
              title: 'Concurrent decision',
              content: original,
              x: 100,
              y: 100,
              ...(fileBacked ? { data: { path } } : {}),
            },
          })
        ).json();
        for (const tab of [page, peer]) {
          await tab.goto('/workbench?transport=poll');
          await tab.locator(`[data-node-id="${id}"]`).getByRole('button', { name: 'Edit', exact: true }).click();
          await tab.getByRole('button', { name: '</> Source', exact: true }).click();
        }
        const editor = page.locator('.md-editor-expanded textarea');
        await editor.fill(draft);
        await expect(page.locator('.md-preview')).toContainText(draft);
        let captured = false;
        await page.route('**/api/render', async (route) => {
          if (captured || route.request().postDataJSON().markdown !== draft) return route.continue();
          captured = true;
          const response = await route.fetch();
          await gate;
          await route.fulfill({ response });
        });
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect.poll(() => captured).toBe(true);
        await peer.locator('.md-editor-expanded textarea').fill(newer);
        // Arm before the write: the incremental poll may arrive before Saved paints.
        const newerPoll = page.waitForResponse(
          async (response) => response.url().includes('/api/workbench/poll') && (await response.text()).includes(newer),
        );
        await peer.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(peer.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
        // Observe a real poll containing the newer canonical body, without editing this draft.
        await newerPoll;
        await expect(editor).toHaveValue(draft);
        const patch = page.waitForResponse(
          (response) => response.url().endsWith(`/api/canvas/node/${id}`) && response.request().method() === 'PATCH',
        );
        release();
        expect((await patch).status()).toBe(409);
        await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
        expect((await (await request.get(`/api/canvas/node/${id}`)).json()).data.content).toBe(newer);
        if (fileBacked) expect(readFileSync(path, 'utf8')).toBe(newer);
        await expect(editor).toHaveValue(draft);
        await page.screenshot({ path: test.info().outputPath(`native-conflict-${fileBacked}.png`) });
        // A subsequent deliberate human save may override work already observed.
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
        const saved = await (await request.get(`/api/canvas/node/${id}`)).json();
        expect(saved.data.content).toBe(draft);
        expect(saved.lastEditedBy.actor).toBe('human');
        if (fileBacked) expect(readFileSync(path, 'utf8')).toBe(draft);
        await page.screenshot({ path: test.info().outputPath(`native-saved-${fileBacked}.png`) });
      } finally {
        release();
        await page.unrouteAll({ behavior: 'wait' });
        await peer.close();
        await page.goto('about:blank');
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }

  test('switch acceptance detaches old same-ID cards until the new layout arrives and retains the original draft', async ({
    page,
    request,
  }) => {
    const ids: string[] = [];
    const cardIds: string[] = [];
    for (const name of ['Switch owner A', 'Switch owner B']) {
      const { board } = await (await request.post('/api/canvas/boards', { data: { name } })).json();
      ids.push(board.id);
      await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: board.id } });
      cardIds.push(await note(request, name));
    }
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: ids[0] } });
    const sharedId = cardIds[0]!;
    // Fixture only: closed boards can contain IDs repeated by imports/restores.
    // The public create API generates fresh IDs, so qualify this stored row
    // before exercising the real board-open response and browser save boundary.
    const db = new DatabaseSync(process.env.PMX_PLAYWRIGHT_DB_PATH ?? 'test-results/playwright/canvas.db');
    try {
      expect(
        db.prepare('UPDATE nodes SET id = ? WHERE board_id = ? AND id = ?').run(sharedId, ids[1]!, cardIds[1]!).changes,
      ).toBe(1);
    } finally {
      db.close();
    }
    await page.goto('/workbench?transport=poll');
    const card = page.locator(`[data-node-id="${sharedId}"]`);
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: '</> Source', exact: true }).click();
    const draft = 'Unsaved A-only continuation.';
    await page.locator('textarea').fill(draft);
    await expect(page.locator('.md-preview')).toContainText(draft);
    await page.locator('.expanded-close').click();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/api\/(?:canvas\/state|workbench\/poll)(?:\?|$)/, async (route) => {
      await gate;
      await route.continue();
    });
    try {
      await page.getByRole('button', { name: /^Board: Switch owner A/ }).click();
      await page.getByRole('menuitem', { name: /^Switch owner B/ }).click();
      await expect(page.getByRole('button', { name: /^Board: Switch owner B/ })).toBeVisible();
      await expect(card).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath('switch-awaiting-layout.png') });
      release();
      await page.unrouteAll({ behavior: 'wait' });
      await expect(card).toContainText('Switch owner B body');
      await card.getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(page.locator('[contenteditable]')).toContainText('Switch owner B body');
      await page.locator('.expanded-close').click();
      await page.getByRole('button', { name: /^Board: Switch owner B/ }).click();
      await page.getByRole('menuitem', { name: /^Switch owner A/ }).click();
      await card.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.getByRole('button', { name: '</> Source', exact: true }).click();
      await expect(page.locator('textarea')).toHaveValue(draft);
      await page.screenshot({ path: test.info().outputPath('switch-restored-draft.png') });
      expect((await (await request.get(`/api/canvas/node/${sharedId}?board=${ids[1]}`)).json()).data.content).toBe(
        'Switch owner B body',
      );
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
});

for (const remount of [false, true]) {
  for (const fileBacked of [false, true]) {
    test(`a superseded native save cannot overwrite newer content (file-backed=${fileBacked}, remount=${remount})`, async ({
      page,
      request,
    }) => {
      const directory = mkdtempSync(join(process.cwd(), '.pmx-save-race-'));
      const path = join(directory, 'decision.md');
      writeFileSync(path, 'Original decision.');
      const older = 'Intermediate decision.';
      const newer = 'Latest checked decision.';
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let waiting = false;
      try {
        const { id } = await (
          await request.post('/api/canvas/node', {
            headers: HUMAN,
            data: {
              type: 'markdown',
              title: 'Save ordering',
              content: 'Original decision.',
              x: 100,
              y: 100,
              ...(fileBacked ? { data: { path } } : {}),
            },
          })
        ).json();
        await page.goto('/workbench?transport=poll');
        await page.locator(`[data-node-id="${id}"]`).getByRole('button', { name: 'Edit', exact: true }).click();
        await page.getByRole('button', { name: '</> Source', exact: true }).click();
        const editor = page.locator('.md-editor-expanded textarea');
        await editor.fill(older);
        await expect(page.locator('.md-preview')).toContainText(older);
        await page.route('**/api/render', async (route) => {
          if (route.request().postDataJSON().markdown !== older) return route.continue();
          const response = await route.fetch();
          waiting = true;
          await gate;
          await route.fulfill({ response });
        });
        const oldRender = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/api/render' && response.request().postDataJSON().markdown === older,
        );
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect.poll(() => waiting).toBe(true);
        if (remount) {
          await page.locator('.expanded-close').click();
          await page.locator(`[data-node-id="${id}"]`).getByRole('button', { name: 'Edit', exact: true }).click();
          await page.getByRole('button', { name: '</> Source', exact: true }).click();
        }
        await editor.fill(newer);
        await expect(page.locator('.md-preview')).toContainText(newer);
        if (fileBacked)
          expect((await request.post('/api/file/save', { headers: HUMAN, data: { path, content: newer } })).ok()).toBe(
            true,
          );
        const observed = page.waitForResponse(
          async (response) => response.url().includes('/api/workbench/poll') && (await response.text()).includes(newer),
        );
        expect((await request.patch(`/api/canvas/node/${id}`, { headers: HUMAN, data: { content: newer } })).ok()).toBe(
          true,
        );
        release();
        await (await oldRender).finished();
        // Allow the obsolete continuation to send its write, rather than accepting
        // the first still-correct sample immediately after the held render ends.
        await page.waitForTimeout(250);
        expect((await (await request.get(`/api/canvas/node/${id}`)).json()).data.content).toBe(newer);
        // A new human attempt may override observed work, not a revision this
        // browser has not received yet. Do not depend on SSE flushing in Chromium.
        await observed;
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
        if (fileBacked) expect(readFileSync(path, 'utf8')).toBe(newer);
        await page.locator('.expanded-close').click();
        await page.locator(`[data-node-id="${id}"]`).getByRole('button', { name: 'Edit', exact: true }).click();
        await expect(page.locator('[contenteditable]')).toContainText(newer);
      } finally {
        release();
        await page.unrouteAll({ behavior: 'wait' });
        await page.goto('about:blank');
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
}

test.describe('native acknowledgement and resync ownership', () => {
  test.use({ deviceScaleFactor: 2 });
  for (const closeBeforeAck of [true, false]) {
    for (const fileBacked of [false, true]) {
      test(`close saves a trailing native draft through its own preceding acknowledgement (file=${fileBacked}, queued=${closeBeforeAck})`, async ({
        page,
        request,
      }) => {
        const directory = mkdtempSync(join(process.cwd(), '.pmx-ack-lineage-'));
        const path = join(directory, 'decision.md');
        writeFileSync(path, 'Original.');
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        try {
          const { id } = await (
            await request.post('/api/canvas/node', {
              headers: HUMAN,
              data: {
                type: 'markdown',
                title: 'Trailing decision',
                content: 'Original.',
                x: 100,
                y: 100,
                ...(fileBacked ? { data: { path } } : {}),
              },
            })
          ).json();
          await page.goto('/workbench?transport=poll');
          await page.locator(`[data-node-id="${id}"]`).getByRole('button', { name: 'Edit', exact: true }).click();
          const editor = page.locator('[contenteditable]');
          await expect(editor).toContainText('Original.');
          // Only acknowledgements can advance this browser's canonical revision.
          await page.route('**/api/workbench/poll?*', (route) => route.abort());
          let held = false;
          await page.route(`**/api/canvas/node/${id}`, async (route) => {
            if (route.request().method() === 'PATCH' && route.request().postDataJSON().content === 'First save.') {
              held = true;
              await gate;
            }
            await route.continue();
          });
          const firstAck = page.waitForResponse(
            (response) =>
              response.url().endsWith(`/api/canvas/node/${id}`) &&
              response.request().method() === 'PATCH' &&
              response.request().postDataJSON().content === 'First save.',
          );
          await editor.fill('First save.');
          await editor.press('Control+s');
          await expect.poll(() => held).toBe(true);
          await editor.fill('Final trailing draft.');
          const trailingAck = page.waitForResponse(
            (response) =>
              response.url().endsWith(`/api/canvas/node/${id}`) &&
              response.request().method() === 'PATCH' &&
              response.request().postDataJSON().content === 'Final trailing draft.',
          );
          if (closeBeforeAck) await page.locator('.expanded-close').click();
          release();
          expect((await firstAck).status()).toBe(200);
          await (await firstAck).finished();
          if (!closeBeforeAck) {
            // Let the ACK continuation run, without a canonical poll or debounce.
            await page.waitForTimeout(50);
            await page.locator('.expanded-close').click();
          }
          expect((await trailingAck).status()).toBe(200);
          await expect
            .poll(async () => (await (await request.get(`/api/canvas/node/${id}`)).json()).data.content)
            .toBe('Final trailing draft.');
          if (fileBacked) expect(readFileSync(path, 'utf8')).toBe('Final trailing draft.');
          await page.locator(`[data-node-id="${id}"]`).getByRole('button', { name: 'Edit', exact: true }).click();
          await expect(page.locator('[contenteditable]')).toContainText('Final trailing draft.');
          await page.screenshot({ path: test.info().outputPath(`trailing-save-${fileBacked}-${closeBeforeAck}.png`) });
        } finally {
          release();
          await page.unrouteAll({ behavior: 'wait' });
          await page.goto('about:blank');
          rmSync(directory, { recursive: true, force: true });
        }
      });
    }
  }

  test('a held B resync refuses A state after another tab opens A', async ({ page, request, context }) => {
    const a = (await (await request.post('/api/canvas/boards', { data: { name: 'Resync A' } })).json()).board.id;
    expect((await request.post('/api/canvas/boards', { data: { name: 'Resync B' } })).ok()).toBe(true);
    await request.post('/api/canvas/boards/open', { headers: HUMAN, data: { id: a } });
    const cardA = await note(request, 'A-only content');
    const peer = await context.newPage();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      for (const tab of [page, peer]) {
        await tab.goto('/workbench?transport=poll');
        await expect(tab.locator(`[data-node-id="${cardA}"]`)).toBeVisible();
      }
      await page.route('**/api/workbench/poll?*', (route) => route.abort());
      let held = false;
      await page.route('**/api/canvas/state?*', async (route) => {
        held = true;
        await gate;
        await route.continue();
      });
      await page.getByRole('button', { name: /^Board: Resync A/ }).click();
      await page.getByRole('menuitem', { name: /^Resync B/ }).click();
      await expect(page.getByRole('button', { name: /^Board: Resync B/ })).toBeVisible();
      await expect.poll(() => held).toBe(true);
      await expect(peer.getByRole('button', { name: /^Board: Resync B/ })).toBeVisible();
      await peer.getByRole('button', { name: /^Board: Resync B/ }).click();
      await peer.getByRole('menuitem', { name: /^Resync A/ }).click();
      await expect(peer.locator(`[data-node-id="${cardA}"]`)).toBeVisible();
      expect((await boards(request)).activeBoardId).toBe(a);
      const resync = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/canvas/state');
      release();
      expect((await resync).status()).toBe(409);
      await expect(page.getByRole('button', { name: /^Board: Resync B/ })).toBeVisible();
      await expect(page.locator('.canvas-node')).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath('wrong-owner-resync-refused.png') });
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
      await peer.close();
    }
  });
});
