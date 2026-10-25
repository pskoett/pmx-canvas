import { expect, test, type Locator } from '@playwright/test';

test.use({ deviceScaleFactor: 2 });

test.beforeEach(async ({ request }) => {
  const headers = { 'x-pmx-workbench': '1' };
  expect((await request.post('/api/canvas/ax/policy', { headers, data: { scope: null } })).ok()).toBe(true);
  expect((await request.post('/api/canvas/clear', { headers })).ok()).toBe(true);
  expect((await request.post('/api/canvas/viewport', { headers, data: { x: 0, y: 0, scale: 1 } })).ok()).toBe(true);
});

const fourLevels = `---
config:
  flowchart:
    rankSpacing: 300
---
flowchart TD
  A[Level 1: Receive request] -->|validate| B[Level 2: Plan work]
  B -->|execute| C[Level 3: Review result]
  C -->|publish| D[Level 4: Delivered]`;

async function geometry(svg: Locator) {
  return svg.evaluate((element) => {
    const svg = element as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const container = svg.closest('.mermaid-viewer');
    const bounds = container?.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      right: rect.right - (bounds?.left ?? 0),
      bottom: rect.bottom - (bounds?.top ?? 0),
      naturalWidth: svg.viewBox.baseVal.width,
      naturalHeight: svg.viewBox.baseVal.height,
      viewportWidth: bounds?.width ?? document.documentElement.clientWidth,
      viewportHeight: bounds?.height ?? document.documentElement.clientHeight,
      scrollWidth: container?.scrollWidth ?? document.documentElement.scrollWidth,
      scrollHeight: container?.scrollHeight ?? document.documentElement.scrollHeight,
    };
  });
}

test('Mermaid contains four levels in a strict 920x870 node, follows themes and resizing, and offers 100%', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const response = await request.post('/api/canvas/node', {
    data: {
      type: 'mermaid',
      title: 'Four-level fit',
      content: fourLevels,
      x: 100,
      y: 80,
      width: 920,
      height: 870,
      strictSize: true,
    },
  });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  await page.goto('/workbench');
  const card = page.locator(`.canvas-node[data-node-id="${id}"]`);
  const svg = card.locator('.mermaid-diagram > svg');
  await expect(svg).toBeVisible();

  for (const theme of ['harbor', 'daylight', 'ember']) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('menu', { name: 'Settings' }).getByRole('menuitem').filter({ hasText: 'Theme' }).click();
    await page
      .locator('.toolbar-menu')
      .getByRole('menuitemradio', { name: new RegExp(`^${theme}$`, 'i') })
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(svg).toBeVisible();
    const fill = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.background = 'var(--c-panel-soft)';
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    await expect(svg.locator('.node rect').first()).toHaveCSS('fill', fill);
    const sitePage = await page.context().newPage();
    try {
      await sitePage.goto(`/api/canvas/surface/${id}?theme=${theme}`);
      await expect(sitePage.locator('.mermaid-diagram .node rect').first()).toHaveCSS('fill', fill);
      await expect(sitePage.getByText('Level 4: Delivered', { exact: true })).toBeVisible();
    } finally {
      await sitePage.close();
    }
    const bounds = await geometry(svg);
    expect(bounds.naturalHeight).toBeGreaterThan(870);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight + 1);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth + 1);
    expect(bounds.scrollHeight).toBeLessThanOrEqual(bounds.viewportHeight + 1);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.viewportWidth + 1);
    expect(bounds.width / bounds.height).toBeCloseTo(bounds.naturalWidth / bounds.naturalHeight, 3);
    await expect(svg.locator('.node')).toHaveCount(4);
    await expect(svg.locator('.flowchart-link')).toHaveCount(3);
    for (const label of ['Level 1: Receive request', 'Level 4: Delivered', 'publish']) {
      await expect(svg.getByText(label, { exact: true })).toBeVisible();
    }
    const state = await (await request.get(`/api/canvas/node/${id}`)).json();
    expect(state.size).toEqual({ width: 920, height: 870 });
    if (process.env.PMX_MERMAID_SCREENSHOTS) {
      await card.screenshot({ path: `${process.env.PMX_MERMAID_SCREENSHOTS}/mermaid-${theme}.png` });
    }
  }

  // Updating only data.fit must resize the painted diagram in place, not
  // re-render it: a replaced SVG is briefly detached and measures 0px.
  await svg.evaluate((element) => element.setAttribute('data-before-fit', ''));
  await request.patch(`/api/canvas/node/${id}`, { data: { data: { fit: 'none' } } });
  await expect(card.locator('.mermaid-viewer')).toHaveAttribute('data-fit', 'none');
  await expect(svg).toHaveAttribute('data-before-fit', '');
  const natural = await geometry(svg);
  expect(natural.height).toBeCloseTo(natural.naturalHeight, 1);
  expect(natural.scrollHeight).toBeGreaterThan(natural.viewportHeight);
  await svg.evaluate((element) => {
    const viewer = element.closest('.mermaid-viewer')!;
    viewer.scrollTop = viewer.scrollHeight;
  });
  const bottomLabel = await svg.getByText('Level 4: Delivered', { exact: true }).evaluate((label) => {
    const viewer = label.closest('.mermaid-viewer')!.getBoundingClientRect();
    return {
      top: label.getBoundingClientRect().top - viewer.top,
      bottom: label.getBoundingClientRect().bottom - viewer.top,
      viewport: viewer.height,
    };
  });
  expect(bottomLabel.top).toBeGreaterThanOrEqual(0);
  expect(bottomLabel.bottom).toBeLessThanOrEqual(bottomLabel.viewport);
  await expect(svg).toHaveAttribute('data-before-fit', '');
  if (process.env.PMX_MERMAID_SCREENSHOTS) {
    await card.screenshot({ path: `${process.env.PMX_MERMAID_SCREENSHOTS}/mermaid-none.png` });
  }

  await request.patch(`/api/canvas/node/${id}`, {
    data: { data: { fit: 'contain' }, size: { width: 360, height: 240 } },
  });
  await expect(card.locator('.mermaid-viewer')).toHaveAttribute('data-fit', 'contain');
  await expect.poll(async () => (await geometry(svg)).viewportHeight).toBeLessThan(240);
  // The node shrinks over its height transition; wait for the diagram to refit
  // the settled frame rather than sampling one intermediate frame.
  await expect
    .poll(async () => {
      const small = await geometry(svg);
      return small.bottom - small.viewportHeight;
    })
    .toBeLessThanOrEqual(1);
  const small = await geometry(svg);

  await request.patch(`/api/canvas/node/${id}`, { data: { size: { width: 600, height: 480 } } });
  await expect.poll(async () => (await geometry(svg)).viewportHeight).toBeGreaterThan(240);
  // The frame can grow before its resize event refits the SVG.
  await expect.poll(async () => (await geometry(svg)).height).toBeGreaterThan(small.height);
  const resized = await geometry(svg);
  expect(resized.height).toBeGreaterThan(small.height);
  expect(resized.bottom).toBeLessThanOrEqual(resized.viewportHeight + 1);
  await card.getByLabel('Expand (focus mode)').click();
  const expanded = page.locator('.expanded-overlay-panel .mermaid-diagram > svg');
  await expect(expanded).toBeVisible();
  const larger = await geometry(expanded);
  expect(larger.height).toBeGreaterThan(resized.height);
  expect(larger.bottom).toBeLessThanOrEqual(larger.viewportHeight + 1);
  if (process.env.PMX_MERMAID_SCREENSHOTS) {
    await page
      .locator('.expanded-overlay-panel')
      .screenshot({ path: `${process.env.PMX_MERMAID_SCREENSHOTS}/mermaid-expanded.png` });
  }
  await page.keyboard.press('Escape');

  // The same URL opened top-level is the existing Open as site 100% route.
  await page.goto(`/api/canvas/surface/${id}?theme=daylight`);
  const standalone = page.locator('.mermaid-diagram > svg');
  await expect(standalone).toBeVisible();
  const site = await geometry(standalone);
  expect(site.height).toBeCloseTo(site.naturalHeight, 1);
  await request.delete(`/api/canvas/node/${id}`);
});

test('Mermaid small diagrams stay at 100% in srcdoc embeds', async ({ page, request }) => {
  const response = await request.post('/api/canvas/node', {
    data: { type: 'mermaid', content: 'flowchart LR; A-->B' },
  });
  const { id } = await response.json();
  const html = await (await request.get(`/api/canvas/surface/${id}?inline-assets=1&frameToken=test-frame`)).text();
  await page.goto('/workbench');
  await page.evaluate((srcdoc) => {
    document.body.innerHTML = '';
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.style.cssText = 'width:920px;height:870px;border:0';
    frame.srcdoc = srcdoc;
    document.body.append(frame);
  }, html);
  const svg = page.locator('iframe').contentFrame().locator('.mermaid-diagram > svg');
  await expect(svg).toBeVisible();
  const bounds = await geometry(svg);
  expect(bounds.width).toBeCloseTo(bounds.naturalWidth, 1);
  expect(bounds.height).toBeCloseTo(bounds.naturalHeight, 1);
  await request.patch(`/api/canvas/node/${id}`, {
    data: { content: fourLevels.replace('flowchart TD', 'flowchart LR') },
  });
  const wideHtml = await (await request.get(`/api/canvas/surface/${id}?inline-assets=1&frameToken=test-frame`)).text();
  await page.locator('iframe').evaluate((frame: HTMLIFrameElement, srcdoc) => {
    frame.srcdoc = srcdoc;
  }, wideHtml);
  await expect(svg.getByText('Level 4: Delivered', { exact: true })).toBeVisible();
  const wide = await geometry(svg);
  expect(wide.naturalWidth).toBeGreaterThan(920);
  expect(wide.width).toBeCloseTo(920, 1);
  expect(wide.height).toBeCloseTo((wide.width * wide.naturalHeight) / wide.naturalWidth, 1);
  // Standalone site embedded by a host browser pane is still a 100% view.
  const siteHtml = await (await request.get(`/api/canvas/surface/${id}?inline-assets=1`)).text();
  await page.locator('iframe').evaluate((frame: HTMLIFrameElement, srcdoc) => {
    frame.srcdoc = srcdoc;
  }, siteHtml);
  await expect(svg.getByText('Level 4: Delivered', { exact: true })).toBeVisible();
  const site = await geometry(svg);
  expect(site.width).toBeCloseTo(site.naturalWidth, 1);
  await request.delete(`/api/canvas/node/${id}`);
});

test('Mermaid reports natural height so non-strict cards still grow', async ({ page, request }) => {
  const response = await request.post('/api/canvas/node', {
    data: { type: 'mermaid', content: fourLevels, width: 920, height: 300 },
  });
  const { id } = await response.json();
  await page.goto('/workbench');
  const svg = page.locator(`.canvas-node[data-node-id="${id}"] .mermaid-diagram > svg`);
  await expect(svg).toBeVisible();
  // Three 300px rank gaps must fit without clipping after growth. The label
  // font follows the canvas and must not pin this to Mermaid's old 16px default.
  await expect.poll(async () => (await geometry(svg)).viewportHeight).toBeGreaterThan(900);
  await expect(svg.getByText('Level 4: Delivered', { exact: true })).toBeVisible();
  const grown = await geometry(svg);
  // Subpixel width rounding is amplified by this tall aspect ratio. Keep the
  // rendered error below half a CSS pixel rather than requiring 0.05px precision.
  expect(Math.abs(grown.height - (grown.width * grown.naturalHeight) / grown.naturalWidth)).toBeLessThanOrEqual(0.5);
  expect(grown.bottom).toBeLessThanOrEqual(grown.viewportHeight + 1);
  await request.delete(`/api/canvas/node/${id}`);
});
