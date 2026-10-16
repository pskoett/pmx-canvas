import { expect, test, setWorkspaceFeatures, type APIRequestContext } from './workspace-fixture.js';
import { execFileSync } from 'node:child_process';

const headers = { 'x-pmx-workbench': '1' };
async function post(request: APIRequestContext, path: string, data: object = {}) {
  const response = await request.post(`/api/canvas/${path}`, { data, headers });
  expect(response.ok()).toBe(true);
  return response;
}

test.beforeEach(async ({ request }) => {
  const { presences } = await (await request.get('/api/canvas/ax/presence')).json();
  for (const presence of presences) {
    if (presence.attached) {
      await post(request, 'ax/presence', { source: presence.source, agentId: presence.agentId, attached: false });
    }
  }
  await post(request, 'ax/policy', { scope: null });
  await post(request, 'clear');
  await post(request, 'context-pins', { nodeIds: [] });
  await post(request, 'viewport', { x: 0, y: 0, scale: 1 });
});

test('title click selects for context pinning; shift toggles; dragging preserves selection; groups match', async ({
  page,
  request,
}) => {
  const a = await (
    await post(request, 'node', {
      type: 'markdown',
      title: 'Alpha',
      content: 'First',
      x: 100,
      y: 100,
      width: 300,
      height: 180,
    })
  ).json();
  const b = await (
    await post(request, 'node', {
      type: 'markdown',
      title: 'Beta',
      content: 'Second',
      x: 500,
      y: 100,
      width: 300,
      height: 180,
    })
  ).json();
  await post(request, 'group', { title: 'Review group', x: 150, y: 400, width: 450, height: 200 });
  await page.goto('/workbench');
  const alpha = page.locator(`[data-node-id="${a.id}"]`);
  const beta = page.locator(`[data-node-id="${b.id}"]`);
  await alpha.locator('.node-title').click();
  await expect(alpha).toHaveClass(/selected/);
  await page.getByRole('button', { name: 'Pin as context', exact: true }).click();
  await expect(alpha).toHaveClass(/context-pinned/);
  await alpha.locator('.node-title').click();
  await beta.locator('.node-title').click({ modifiers: ['Shift'] });
  await expect(page.locator('.canvas-node.selected')).toHaveCount(2);
  await beta.locator('.node-title').click({ modifiers: ['Shift'] });
  await expect(page.locator('.canvas-node.selected')).toHaveCount(1);
  const before = await beta.boundingBox();
  const title = await beta.locator('.node-title').boundingBox();
  if (!before || !title) throw new Error('Missing node geometry');
  await page.mouse.move(title.x + 15, title.y + 8);
  await page.mouse.down();
  await page.mouse.move(title.x + 95, title.y + 78, { steps: 10 });
  await page.mouse.up();
  await expect(alpha).toHaveClass(/selected/);
  await expect(beta).not.toHaveClass(/selected/);
  await expect.poll(async () => (await beta.boundingBox())!.x - before.x).toBeGreaterThan(60);
  await beta.locator('.node-title').click();
  await expect(beta).toHaveClass(/selected/);
  await expect(alpha).not.toHaveClass(/selected/);
  const group = page.locator('.group-node');
  await group.locator('.group-name').click();
  await expect(group).toHaveClass(/selected/);
  await expect(beta).not.toHaveClass(/selected/);
  await group.locator('.group-name').click({ modifiers: ['Shift'] });
  await expect(group).not.toHaveClass(/selected/);
  await group.getByRole('button', { name: 'Collapse group', exact: true }).click();
  await page.locator('.group-chip-name').click();
  await expect(page.locator('.group-chip')).toHaveClass(/selected/);
});

test('only changed top-level endings show receipts; workers retain snapshots', async ({ page, request }) => {
  await setWorkspaceFeatures(request, { agentSessions: true });
  await page.goto('/workbench');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-session-active', 'false');
  const receipt = page.getByTestId('session-receipt');
  const presence = (agentId: string, attached: boolean, parentAgentId?: string) =>
    post(request, 'ax/presence', {
      source: 'api',
      agentId,
      label: agentId,
      attached,
      parentAgentId,
      cursor: { x: 200, y: 200 },
    });
  const end = (agentId: string) => presence(agentId, false);
  await presence('empty-session', true);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-session-active', 'true');
  await end('empty-session');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-session-active', 'false');
  await expect(receipt).toHaveCount(0);
  await post(request, 'node', { type: 'markdown', title: 'Baseline', content: 'Before', x: 100, y: 100 });
  await presence('no-edit-session', true);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-session-active', 'true');
  await end('no-edit-session');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-session-active', 'false');
  await expect(receipt).toHaveCount(0);
  await presence('orchestrator', true);
  await presence('worker', true, 'orchestrator');
  await expect(page.locator('.agent-cursor[data-session-id="worker"]')).toHaveCount(1);
  await post(request, 'node', { type: 'markdown', title: 'Worker result', content: 'After', x: 500, y: 100 });
  await end('worker');
  // SSE presence confirms the worker's detach was consumed.
  await expect(page.locator('.agent-cursor[data-session-id="worker"]')).toHaveCount(0);
  await expect(receipt).toHaveCount(0);
  const snapshots = await (await request.get('/api/canvas/snapshots?all=true')).json();
  expect(snapshots.some((s: { name: string }) => s.name.includes('worker'))).toBe(true);
  await end('orchestrator');
  await expect(receipt).toBeVisible();
  await receipt.getByRole('button', { name: 'View diff' }).click();
  await expect(page.getByTestId('session-receipt-diff')).toHaveText('This session: 1 added · 0 removed · 0 modified');
  await receipt.getByRole('button', { name: 'Dismiss receipt' }).click();
  await expect(receipt).toHaveCount(0);
});

test('top-level sessions ending together share one receipt that points at History', async ({ page, request }) => {
  await setWorkspaceFeatures(request, { agentSessions: true });
  await page.goto('/workbench');
  const receipt = page.getByTestId('session-receipt');
  const presence = (agentId: string, attached: boolean) =>
    post(request, 'ax/presence', { source: 'api', agentId, label: agentId, attached });
  await post(request, 'node', { type: 'markdown', title: 'Baseline', content: 'Before', x: 100, y: 100 });
  await presence('alpha', true);
  await presence('beta', true);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-session-active', 'true');
  await post(request, 'node', { type: 'markdown', title: 'Alpha result', content: 'A', x: 400, y: 100 });
  await post(request, 'node', { type: 'markdown', title: 'Beta result', content: 'B', x: 700, y: 100 });
  await presence('alpha', false);
  await presence('beta', false);
  await expect(receipt.locator('.session-receipt-title')).toContainText('2 sessions ended');
  await expect(receipt.locator('.session-receipt-who')).toHaveText('alpha, beta');
  await expect(receipt).toHaveCount(1);
  await expect(receipt.getByRole('button', { name: 'View diff' })).toHaveCount(0);
  await expect(receipt).toContainText('History has each session');
});

test('See change stacks marked words, keeps later human edits, and reopens its board; the narrow avatar exposes its lens', async ({
  page,
  request,
}) => {
  await setWorkspaceFeatures(request, { agentSessions: true });
  const { board } = await (await post(request, 'boards', { name: 'Pricing research' })).json();
  await post(request, 'boards/open', { id: board.id });
  const before = 'SMB buyers compare price first. Most would keep their plan. Support came second.';
  const after = 'SMB buyers compare price first. Eight would downgrade. Support came second.';
  const a = await (
    await post(request, 'node', { type: 'markdown', title: 'SMB', content: before, x: 100, y: 100 })
  ).json();
  const preamble = 'Research background stays the same. '.repeat(50);
  const b = await (
    await post(request, 'node', {
      type: 'markdown',
      title: 'Churn',
      content: `${preamble}September: 2% ${preamble}`,
      x: 480,
      y: 100,
    })
  ).json();
  await post(request, 'node', { type: 'markdown', title: 'Untouched', content: 'Keep this', x: 100, y: 400 });
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto('/workbench');
  const presence = (attached: boolean) =>
    post(request, 'ax/presence', { source: 'api', agentId: 'receipt-agent', label: 'Codex', attached });
  await presence(true);
  expect((await request.patch(`/api/canvas/node/${a.id}`, { data: { content: after } })).ok()).toBe(true);
  expect(
    (
      await request.patch(`/api/canvas/node/${b.id}`, { data: { content: `${preamble}September: 3% ${preamble}` } })
    ).ok(),
  ).toBe(true);
  await post(request, 'context-pins', { nodeIds: [a.id] });
  const avatar = page.getByRole('button', { name: 'Codex session details' });
  const popover = page.getByRole('dialog', { name: 'Codex session details' });
  for (const width of [600, 390]) {
    await page.setViewportSize({ width, height: 900 });
    // Escape must work as soon as the popover exists, not only after a
    // deferred listener catches up. The pointer still opens the real control.
    const opened = page.evaluate(
      () =>
        new Promise<string | null>((resolve) => {
          const observer = new MutationObserver(() => {
            const dialog = document.querySelector('.agent-session-popover');
            if (!dialog) return;
            observer.disconnect();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            resolve(dialog.textContent);
          });
          observer.observe(document.body, { childList: true, subtree: true });
        }),
    );
    await avatar.click();
    expect(await opened).toContain('Codex');
    await expect(popover).toHaveCount(0);
    await expect(avatar).toHaveAttribute('aria-expanded', 'false');
    await expect(avatar).toBeFocused();
  }
  await page.setViewportSize({ width: 600, height: 900 });
  await avatar.click();
  await expect(popover).toContainText('2 edited');
  await expect(page.locator('.agent-chip-touches')).toBeHidden();
  await popover.getByRole('switch', { name: 'Dim untouched nodes' }).click();
  await expect(page.locator('.canvas-node.lens-dimmed')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(avatar).toBeFocused();
  await avatar.click();
  await popover.getByRole('button', { name: 'Open session panel' }).click();
  await expect(page.getByRole('complementary', { name: 'Session', exact: true })).toBeVisible();
  await avatar.click();
  await expect(popover).toBeVisible();
  await presence(false);
  await expect(popover).toHaveCount(0);
  const receipt = page.getByTestId('session-receipt');
  await expect(receipt).toContainText('What Codex did');
  await receipt.getByRole('button', { name: 'See change' }).first().click();
  const sides = receipt.locator('.session-receipt-diff-side');
  const boxes = await sides.evaluateAll((elements) =>
    elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
  expect(boxes[1].y).toBeGreaterThanOrEqual(boxes[0].y + boxes[0].height);
  expect(boxes[1].x).toBe(boxes[0].x);
  expect(await sides.first().locator('del').allTextContents()).toContain('Most');
  expect(await sides.last().locator('ins').allTextContents()).toContain('Eight');
  await expect(sides.first()).toContainText('Support came second.');
  await receipt.getByRole('button', { name: 'See change' }).click();
  await expect(receipt.getByRole('button', { name: 'Hide change' })).toHaveCount(1);
  await expect(sides.first()).toContainText('September: 2%');
  const visibleChanges = await receipt.locator('.session-receipt-diff-text').evaluateAll((boxes) =>
    boxes.map((box) => {
      const mark = box.querySelector('del, ins');
      if (!mark) return false;
      const textRect = box.getBoundingClientRect(),
        markRect = mark.getBoundingClientRect();
      return markRect.top >= textRect.top && markRect.bottom <= textRect.bottom;
    }),
  );
  expect(visibleChanges).toEqual([true, true]);
  await page.setViewportSize({ width: 600, height: 420 });
  const bounds = await receipt.evaluate((element) => ({
    bottom: element.getBoundingClientRect().bottom,
    parentBottom: element.parentElement!.getBoundingClientRect().bottom,
  }));
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.parentBottom);
  expect(await receipt.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
  await receipt.hover({ position: { x: 20, y: 20 } });
  await page.mouse.wheel(0, 1000);
  await expect(receipt.getByRole('button', { name: 'History', exact: true })).toBeInViewport();
  await expect(receipt.getByRole('switch', { name: 'Dim untouched nodes' })).toBeInViewport();
  await receipt.getByRole('button', { name: 'Undo this card' }).scrollIntoViewIfNeeded();
  await expect(receipt.getByRole('button', { name: 'Undo this card' })).toBeInViewport();
  await page.setViewportSize({ width: 600, height: 900 });
  // This write really is the person (a bare workbench marker is not an actor credential).
  const html = await (await request.get('/workbench')).text();
  const encoded = html.match(/window\.__PMX_WORKBENCH_TOKEN = ("[^"]+")/)?.[1];
  if (!encoded) throw new Error('Missing workbench credential');
  expect(
    (
      await request.patch(`/api/canvas/node/${b.id}`, {
        data: { content: 'My corrected figure: 4%' },
        headers: { ...headers, 'x-pmx-workbench-token': JSON.parse(encoded) },
      })
    ).ok(),
  ).toBe(true);
  await expect(receipt.getByRole('button', { name: 'You edited it since' })).toBeDisabled();
  await expect(receipt).toContainText('undo would lose your edit');
  const other = await (await post(request, 'boards', { name: 'Other board' })).json();
  await post(request, 'boards/open', { id: other.board.id });
  await expect(receipt.getByRole('button', { name: 'Unpin', exact: true })).toBeDisabled();
  await receipt.getByRole('button', { name: 'Open Pricing research to undo' }).click();
  await expect(page.getByRole('button', { name: /^Board: Pricing research/ })).toBeVisible();
  await expect(receipt.getByRole('button', { name: 'Unpin', exact: true })).toBeEnabled();
  await receipt.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(receipt.getByRole('button', { name: 'Kept your edits' })).toBeDisabled();
  await expect(page.locator(`[data-node-id="${a.id}"] .md-card-content`)).toContainText('Most would keep their plan.');
  await expect(page.locator(`[data-node-id="${b.id}"]`)).toContainText('My corrected figure: 4%');
  await receipt.getByRole('button', { name: 'See change' }).click();
  await expect(receipt.getByRole('button', { name: '✓ Undone' })).toBeDisabled();
  await expect(receipt).toContainText('the card shows Before again');
  await presence(true);
  await expect(avatar).toBeVisible();
  await expect(popover).toHaveCount(0);
  await presence(false);
});

test('receipt Undo protects an unseen human edit and repeated Unpin never adds pins', async ({ page, request }) => {
  await setWorkspaceFeatures(request, { agentSessions: true });
  const { board } = await (await post(request, 'boards', { name: 'Stale receipt' })).json();
  await post(request, 'boards/open', { id: board.id });
  const a = await (
    await post(request, 'node', { type: 'markdown', title: 'Agent edit', content: 'Before A', x: 100, y: 100 })
  ).json();
  const b = await (
    await post(request, 'node', { type: 'markdown', title: 'Human correction', content: 'Before B', x: 500, y: 100 })
  ).json();
  const c = await (
    await post(request, 'node', { type: 'markdown', title: 'Later pin', content: 'Keep pinned', x: 100, y: 600 })
  ).json();
  let pause = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/workbench/poll*', async (route) => {
    const response = await route.fetch();
    if (pause) await held;
    await route.fulfill({ response });
  });
  await page.goto('/workbench?transport=poll');
  const presence = (attached: boolean) =>
    post(request, 'ax/presence', { source: 'api', agentId: 'stale-receipt-agent', label: 'Codex', attached });
  await presence(true);
  expect((await request.patch(`/api/canvas/node/${a.id}`, { data: { content: 'After A' } })).ok()).toBe(true);
  expect((await request.patch(`/api/canvas/node/${b.id}`, { data: { content: 'After B' } })).ok()).toBe(true);
  await post(request, 'context-pins', { nodeIds: [a.id, b.id] });
  await presence(false);
  const receipt = page.getByTestId('session-receipt');
  await expect(receipt).toContainText('Human correction');
  const html = await (await request.get('/workbench')).text();
  const encoded = html.match(/window\.__PMX_WORKBENCH_TOKEN = ("[^"]+")/)?.[1];
  if (!encoded) throw new Error('Missing workbench credential');
  pause = true;
  try {
    expect(
      (
        await request.patch(`/api/canvas/node/${b.id}`, {
          data: { content: 'Human corrected B' },
          headers: { ...headers, 'x-pmx-workbench-token': JSON.parse(encoded) },
        })
      ).ok(),
    ).toBe(true);
    await expect(page.locator(`.canvas-node[data-node-id="${b.id}"]`)).toContainText('After B');
    const settled = page.waitForResponse(
      (response) => response.url().endsWith('/restore-node') && response.request().postDataJSON().nodeId === b.id,
    );
    await receipt.getByRole('button', { name: 'Undo', exact: true }).click();
    await settled;
    const state = await (await request.get('/api/canvas/state', { headers: { 'x-pmx-proxied-read': '1' } })).json();
    expect(state.nodes.find((node: { id: string }) => node.id === a.id).data.content).toBe('Before A');
    expect(state.nodes.find((node: { id: string }) => node.id === b.id).data.content).toBe('Human corrected B');
    await expect(receipt.getByRole('button', { name: 'Kept your edits' })).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.locator(`.canvas-node[data-node-id="${b.id}"]`)).toContainText('Human corrected B');
  await post(request, 'context-pins', { nodeIds: [a.id], mode: 'remove' });
  await post(request, 'context-pins', { nodeIds: [c.id], mode: 'add' });
  await expect(page.locator(`.canvas-node[data-node-id="${a.id}"]`)).not.toHaveClass(/context-pinned/);
  await expect(page.locator(`.canvas-node[data-node-id="${c.id}"]`)).toHaveClass(/context-pinned/);
  const unpin = receipt.getByRole('button', { name: 'Unpin', exact: true });
  for (let i = 0; i < 2; i++) {
    await unpin.click();
    await expect(page.locator('.canvas-node.context-pinned')).toHaveCount(1);
    await expect(page.locator(`.canvas-node[data-node-id="${b.id}"]`)).not.toHaveClass(/context-pinned/);
    await expect
      .poll(async () => {
        const response = await request.get('/api/canvas/pinned-context', { headers: { 'x-pmx-proxied-read': '1' } });
        expect(response.ok()).toBe(true);
        return (await response.json()).nodeIds;
      })
      .toEqual([c.id]);
  }

  // More than one session's pin limit can accumulate in the open receipt.
  const recorded: string[] = [];
  for (let i = 0; i < 21; i++) {
    const node = await (
      await post(request, 'node', {
        type: 'markdown',
        title: `Merged pin ${i}`,
        content: 'Recorded context',
        x: 1000 + (i % 5) * 500,
        y: 100 + Math.floor(i / 5) * 400,
      })
    ).json();
    recorded.push(node.id);
  }
  await presence(true);
  await post(request, 'context-pins', { nodeIds: recorded.slice(0, 20) });
  await presence(false);
  await expect(receipt).toContainText('Merged pin 19');
  await presence(true);
  await post(request, 'context-pins', { nodeIds: [recorded[20]] });
  await presence(false);
  await expect(receipt).toContainText('Merged pin 20');
  await post(request, 'context-pins', { nodeIds: [c.id], mode: 'add' });
  await unpin.click();
  await expect
    .poll(async () => {
      const response = await request.get('/api/canvas/pinned-context', { headers: { 'x-pmx-proxied-read': '1' } });
      return (await response.json()).nodeIds;
    })
    .toEqual([c.id]);
  // Let in-flight poll handlers finish before the page fixture closes their transport.
  await page.unrouteAll({ behavior: 'wait' });
});

test('receipt Unpin refuses a board switch hidden by a held poll, even with the same card ID', async ({
  page,
  request,
}) => {
  await setWorkspaceFeatures(request, { agentSessions: true });
  const { board: a } = await (await post(request, 'boards', { name: 'Pin race A' })).json();
  const { board: b } = await (await post(request, 'boards', { name: 'Pin race B' })).json();
  await post(request, 'boards/open', { id: a.id });
  const card = await (
    await post(request, 'node', { type: 'markdown', title: 'Shared card', content: 'Keep this', x: 100, y: 100 })
  ).json();
  // Seed the otherwise-uncreatable same-ID collision in the inactive board.
  // Switching away flushes A; B must be inactive while its fixture is inserted.
  await post(request, 'boards/open', { id: b.id });
  await post(request, 'boards/open', { id: a.id });
  execFileSync('bun', [
    '-e',
    `const { Database } = require('bun:sqlite');
     const db = new Database(process.argv[1]);
     db.query('INSERT INTO nodes SELECT ?, id, type, pos_x, pos_y, width, height, z_index, collapsed, pinned, data, attribution, content_revision, links_revision FROM nodes WHERE board_id = ? AND id = ?').run(process.argv[2], process.argv[3], process.argv[4]);
     db.close();`,
    process.env.PMX_PLAYWRIGHT_DB_PATH ?? 'test-results/playwright/canvas.db',
    b.id,
    a.id,
    card.id,
  ]);
  let pause = false;
  let release!: () => void;
  let pollHeld!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const intercepted = new Promise<void>((resolve) => {
    pollHeld = resolve;
  });
  await page.route('**/api/workbench/poll*', async (route) => {
    if (pause) {
      pollHeld();
      await held;
    }
    await route.continue();
  });
  await page.goto('/workbench?transport=poll');
  await expect(page.getByRole('button', { name: /^Board: Pin race A/ })).toBeVisible();
  await post(request, 'ax/presence', { source: 'api', agentId: 'pin-race-agent', label: 'Codex', attached: true });
  expect((await request.patch(`/api/canvas/node/${card.id}`, { data: { content: 'Agent changed A' } })).ok()).toBe(
    true,
  );
  await post(request, 'context-pins', { nodeIds: [card.id] });
  await post(request, 'ax/presence', { source: 'api', agentId: 'pin-race-agent', attached: false });
  const receipt = page.getByTestId('session-receipt');
  const unpin = receipt.getByRole('button', { name: 'Unpin', exact: true });
  await expect(unpin).toBeEnabled();
  pause = true;
  await intercepted;
  try {
    await post(request, 'boards/open', { id: b.id });
    await post(request, 'context-pins', { nodeIds: [card.id] });
    const readPins = async () =>
      (
        await request.get('/api/canvas/pinned-context', {
          headers: { 'x-pmx-proxied-read': '1' },
        })
      ).json();
    const before = await readPins();
    expect(before.nodeIds).toEqual([card.id]);
    await expect(page.getByRole('button', { name: /^Board: Pin race A/ })).toBeVisible();
    const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/canvas/context-pins'));
    await unpin.click();
    const response = await responsePromise;
    expect(response.request().postDataJSON()).toEqual({ nodeIds: [card.id], mode: 'remove', expectedBoardId: a.id });
    expect(response.status()).toBe(409);
    expect(await readPins()).toEqual(before);
  } finally {
    pause = false;
    release();
  }
  await expect(page.getByRole('button', { name: /^Board: Pin race B/ })).toBeVisible();
  await expect(page.locator(`[data-node-id="${card.id}"]`)).toHaveClass(/context-pinned/);
  await expect(unpin).toBeDisabled();
});

test('a created-only receipt reopens its snapshot board before comparing', async ({ page, request }) => {
  await setWorkspaceFeatures(request, { agentSessions: true });
  const { board } = await (await post(request, 'boards', { name: 'Original board' })).json();
  await post(request, 'boards/open', { id: board.id });
  await post(request, 'node', { type: 'markdown', title: 'Baseline', content: 'Keep this', x: 100, y: 100 });
  await page.goto('/workbench');
  const presence = (attached: boolean) =>
    post(request, 'ax/presence', { source: 'api', agentId: 'created-only', label: 'Codex', attached });
  await presence(true);
  expect(
    (await request.post('/api/canvas/node', { data: { type: 'markdown', title: 'New finding', x: 450, y: 100 } })).ok(),
  ).toBe(true);
  await presence(false);
  const receipt = page.getByTestId('session-receipt');
  await expect(receipt).toContainText('New finding');
  await expect(receipt.getByRole('button', { name: 'See change' })).toHaveCount(0);
  const { board: other } = await (await post(request, 'boards', { name: 'Another board' })).json();
  await post(request, 'boards/open', { id: other.id });
  await expect(receipt.getByRole('button', { name: 'View diff', exact: true })).toHaveCount(0);
  await receipt.getByRole('button', { name: 'Open Original board to compare' }).click();
  await expect(page.getByRole('button', { name: /^Board: Original board/ })).toBeVisible();
  await receipt.getByRole('button', { name: 'View diff', exact: true }).click();
  await expect(receipt.getByTestId('session-receipt-diff')).toHaveText(
    'This session: 1 added · 0 removed · 0 modified',
  );
});
