import { type Page, expect, test } from '@playwright/test';

// Frame-level guard for iframe viewer refreshes. A DOM assertion can only see the
// settled state; a white or blank flash lives for one or two composited frames, so
// this records a CDP screencast of the live workboard while work items change and
// inspects every frame's pixels inside the node body.

type FrameStats = { white: number; spread: number };

async function frameStats(decoder: Page, frames: string[], rect: DOMRect): Promise<FrameStats[]> {
  return decoder.evaluate(
    async ({ frames, rect }) => {
      const stats: FrameStats[] = [];
      for (const data of frames) {
        const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        const pixels = ctx.getImageData(
          Math.round(rect.x),
          Math.round(rect.y),
          Math.round(rect.width),
          Math.round(rect.height),
        ).data;
        let white = 0;
        let min = 255;
        let max = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const luma = 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
          if (pixels[i]! > 235 && pixels[i + 1]! > 235 && pixels[i + 2]! > 235) white++;
          min = Math.min(min, luma);
          max = Math.max(max, luma);
        }
        stats.push({ white: white / (pixels.length / 4), spread: max - min });
      }
      return stats;
    },
    { frames, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } as DOMRect },
  );
}

// Canvas theme × OS colour scheme. Each case was checked against a control that
// reloads the painted iframe in place (the 0.6.4 behaviour): it showed white frames
// in harbor and blank frames in all three. Daylight under a light OS is omitted —
// there an in-place reload is indistinguishable from the board's own white fill.
const cases = [
  { theme: 'harbor', os: 'dark', dark: true },
  { theme: 'harbor', os: 'light', dark: true },
  { theme: 'daylight', os: 'dark', dark: false },
] as const;

test.beforeEach(async ({ request }) => {
  // Clear canvas-bound work as well as nodes; work items have no DELETE route.
  expect((await request.post('/api/canvas/clear')).ok()).toBe(true);
});

for (const { theme, os, dark } of cases) {
  test(`workboard refresh paints no blank or white frame (${theme}, OS ${os})`, async ({
    browser,
    request,
  }, testInfo) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: os });
    const page = await context.newPage();
    // Document load is not viewer readiness: force the runtime-state handoff
    // to arrive later than the parent's two animation frames.
    await page.addInitScript(() => {
      if (window === window.parent) return;
      let delayed = false;
      window.addEventListener('message', (event: MessageEvent) => {
        if (
          delayed ||
          event.source !== window.parent ||
          event.data?.source !== 'pmx-canvas-json-state' ||
          event.data?.type !== 'restore'
        )
          return;
        delayed = true;
        event.stopImmediatePropagation();
        setTimeout(() => {
          window.dispatchEvent(new MessageEvent('message', { data: event.data, source: event.source }));
        }, 250);
      });
    });
    const created = await request.post('/api/canvas/workboard', { data: { x: 40, y: 40 } });
    expect(created.ok()).toBe(true);
    const { id } = (await created.json()) as { id: string };
    const items: string[] = [];
    const addItem = async (title: string) => {
      const response = await request.post('/api/canvas/ax/work', { data: { title, status: 'todo' } });
      expect(response.ok()).toBe(true);
      items.push(((await response.json()) as { workItem?: { id: string }; id?: string }).workItem?.id ?? '');
    };
    try {
      await addItem(`Seed ${theme} ${os}`);
      await request.post('/api/canvas/viewport', { data: { x: 0, y: 0, scale: 1 } });
      await page.goto(`/workbench?theme=${theme}`);
      const node = page.locator(`.canvas-node[data-node-id="${id}"]`);
      const painted = node.locator('iframe:not([inert])').contentFrame();
      await expect(painted.getByText(`Seed ${theme} ${os}`)).toBeVisible();
      const rect = (await node.locator('.mcp-app-frame-stack').boundingBox()) as DOMRect;
      expect(rect).not.toBeNull();

      const cdp = await context.newCDPSession(page);
      const frames: string[] = [];
      cdp.on('Page.screencastFrame', (frame) => {
        frames.push(frame.data);
        void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
      });
      await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
      for (let round = 1; round <= 4; round++) {
        await addItem(`Task ${round} ${theme} ${os}`);
        await page.waitForTimeout(350);
        const itemId = items[items.length - 1];
        expect((await request.patch(`/api/canvas/ax/work/${itemId}`, { data: { status: 'done' } })).ok()).toBe(true);
        await page.waitForTimeout(350);
      }
      // A poll can start the last replacement after the loop has completed.
      // Keep capturing until the final content is actually in the foreground.
      await expect(painted.getByText(`Task 4 ${theme} ${os}`)).toBeVisible();
      await expect(painted.getByText('Done (4)', { exact: true })).toBeVisible();
      await expect(node.locator('iframe')).toHaveCount(1);
      await page.waitForTimeout(300);
      await cdp.send('Page.stopScreencast');

      const decoder = await context.newPage();
      const stats = await frameStats(decoder, frames, rect);
      expect(stats.length).toBeGreaterThan(10);
      // A painted board has cards, headings and text: a wide luminance spread.
      // A blank viewer is one flat fill.
      const blank = stats.filter((frame) => frame.spread < 40);
      expect(blank, `blank frames ${JSON.stringify(blank)}`).toHaveLength(0);
      if (dark) {
        const white = stats.filter((frame) => frame.white > 0.05);
        expect(white, `white frames ${JSON.stringify(white)}`).toHaveLength(0);
      }
      await page.screenshot({ path: testInfo.outputPath('workboard-refresh.png') });
    } finally {
      await request.post('/api/canvas/clear');
      await context.close();
    }
  });
}

for (const mode of ['src', 'srcdoc']) {
  test(`graph data and spec patches refresh the painted viewer (${mode})`, async ({ page, request }) => {
    const { id } = await (
      await request.post('/api/canvas/graph', {
        data: {
          title: 'Initial graph',
          graphType: 'bar',
          data: [
            { category: 'A', value: 7 },
            { category: 'B', value: 23 },
          ],
          xKey: 'category',
          yKey: 'value',
          x: 100,
          y: 100,
        },
      })
    ).json();
    await request.post('/api/canvas/viewport', { data: { x: 0, y: 0, scale: 1 } });
    await page.goto(`/workbench?iframe-mode=${mode}`);
    const painted = page.locator(`[data-node-id="${id}"]`).frameLocator('iframe:not([inert])');
    await expect(painted.getByText('Initial graph', { exact: true })).toBeVisible();
    expect(
      (
        await request.patch(`/api/canvas/node/${id}`, {
          data: {
            title: 'Changed graph',
            data: [
              { category: 'C', value: 3 },
              { category: 'D', value: 41 },
            ],
          },
        })
      ).ok(),
    ).toBe(true);
    await expect(painted.getByText('Changed graph', { exact: true })).toBeVisible();
    await expect(painted.getByText('C', { exact: true })).toBeVisible();
    expect(
      (
        await request.patch(`/api/canvas/node/${id}`, {
          data: { spec: { root: 'text', elements: { text: { type: 'Text', props: { text: 'Replacement spec' } } } } },
        })
      ).ok(),
    ).toBe(true);
    await expect(painted.getByText('Replacement spec', { exact: true })).toBeVisible();
  });

  test(`failed HTML refresh retries once, keeps painted content, and recovers (${mode})`, async ({ page, request }) => {
    test.setTimeout(60_000);
    const html = (text: string) => `<main><h1>${text}</h1></main>`;
    const response = await request.post('/api/canvas/node', {
      data: {
        type: 'html',
        title: 'HTML recovery',
        html: html('Last healthy HTML'),
        x: 100,
        y: 100,
        width: 500,
        height: 300,
      },
    });
    expect(response.ok()).toBe(true);
    const { id } = await response.json();
    await request.post('/api/canvas/viewport', { data: { x: 0, y: 0, scale: 1 } });
    let failures = 0;
    let failReplacement = false;
    await page.route(`**/api/canvas/surface/${id}?**`, async (route) => {
      if (!failReplacement) return route.continue();
      failures++;
      await route.fulfill({ status: 503, contentType: 'text/html', body: '<p>Temporary HTML failure</p>' });
    });
    await page.goto(`/workbench?iframe-mode=${mode}`);
    const node = page.locator(`[data-node-id="${id}"]`);
    const painted = node.frameLocator('iframe:not([inert])');
    await expect(painted.getByText('Last healthy HTML', { exact: true })).toBeVisible();
    failReplacement = true;
    expect((await request.patch(`/api/canvas/node/${id}`, { data: { html: html('Unavailable HTML') } })).ok()).toBe(
      true,
    );
    await expect(page.locator('.attention-toast')).toContainText('Keeping the last view. Reload to retry.', {
      timeout: 30_000,
    });
    await expect(node.locator('iframe')).toHaveCount(1);
    await expect(painted.getByText('Last healthy HTML', { exact: true })).toBeVisible();
    expect(failures).toBe(mode === 'srcdoc' ? 3 : 2);
    failReplacement = false;
    expect((await request.patch(`/api/canvas/node/${id}`, { data: { html: html('Recovered HTML') } })).ok()).toBe(true);
    await expect(painted.getByText('Recovered HTML', { exact: true })).toBeVisible();
    await expect(node.locator('iframe')).toHaveCount(1);
  });

  test(`healthy offscreen viewers keep their replacement until painted (${mode})`, async ({ page, request }) => {
    test.setTimeout(60_000);
    const spec = (text: string) => ({
      root: 'text',
      elements: { text: { type: 'Text', props: { text } } },
    });
    const response = await request.post('/api/canvas/json-render', {
      data: { title: 'Offscreen refresh', x: 100, y: 100, spec: spec('Version one') },
    });
    expect(response.ok()).toBe(true);
    const { id } = await response.json();
    // This second viewer stays outside the viewport from the outset. Srcdoc
    // loads immediately; src may stay lazy. Neither is a paint failure.
    const initial = await request.post('/api/canvas/json-render', {
      data: { title: 'Initially offscreen', x: 4500, y: 100, spec: spec('Initial healthy content') },
    });
    expect(initial.ok()).toBe(true);
    const { id: initialId } = await initial.json();
    await request.post('/api/canvas/viewport', { data: { x: 0, y: 0, scale: 1 } });
    await page.goto(`/workbench?iframe-mode=${mode}`);
    const node = page.locator(`.canvas-node[data-node-id="${id}"]`);
    const painted = node.frameLocator('iframe:not([inert])');
    await expect(painted.getByText('Version one', { exact: true })).toBeVisible();
    await request.post('/api/canvas/viewport', { data: { x: -1700, y: 0, scale: 1 } });
    await expect(node).not.toBeInViewport();
    expect((await request.patch(`/api/canvas/node/${id}`, { data: { spec: spec('Version two') } })).ok()).toBe(true);
    // Force both 10-second deadlines to elapse before returning. A polled
    // assertion could pass early and never observe the destructive retry.
    const toasts: string[] = [];
    for (let second = 0; second < 25; second++) {
      await page.waitForTimeout(1000);
      toasts.push(...(await page.locator('.attention-toast').allTextContents()));
    }
    expect(toasts.join('\n')).not.toContain('Viewer could not load');
    await request.post('/api/canvas/viewport', { data: { x: 0, y: 0, scale: 1 } });
    await expect(painted.getByText('Version two', { exact: true })).toBeVisible();
    await expect(node.locator('iframe')).toHaveCount(1);
    await request.post('/api/canvas/viewport', { data: { x: -4400, y: 0, scale: 1 } });
    const initialNode = page.locator(`.canvas-node[data-node-id="${initialId}"]`);
    await expect(initialNode.frameLocator('iframe:not([inert])').getByText('Initial healthy content')).toBeVisible();
    await expect(page.locator('.attention-toast').filter({ hasText: 'Viewer could not load' })).toHaveCount(0);
  });

  test(`failed viewer refresh retries once, keeps painted content, and recovers (${mode})`, async ({
    page,
    request,
  }, info) => {
    test.setTimeout(60_000);
    if (mode === 'srcdoc') {
      // Visible content can precede the runtime's ready acknowledgement. Hold
      // that acknowledgement so an update deterministically cancels the handoff.
      await page.addInitScript(() => {
        if (window !== window.parent) return;
        window.addEventListener('message', (event) => {
          if (
            event.data?.source === 'pmx-canvas-json-state' &&
            event.data?.type === 'ready' &&
            !document.documentElement.dataset.readyHeld
          ) {
            event.stopImmediatePropagation();
            document.documentElement.dataset.readyHeld = 'true';
          }
        });
      });
    }
    const spec = (text: string) => ({
      root: 'text',
      elements: { text: { type: 'Text', props: { text } } },
    });
    const response = await request.post('/api/canvas/json-render', {
      data: { title: 'Viewer recovery', x: 100, y: 100, spec: spec('Last healthy view') },
    });
    expect(response.ok()).toBe(true);
    const { id } = await response.json();
    await request.post('/api/canvas/viewport', { data: { x: 0, y: 0, scale: 1 } });
    let failures = 0;
    let failReplacement = false;
    let replacementStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      replacementStarted = resolve;
    });
    let releaseReplacement!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseReplacement = resolve;
    });
    await page.route('**/api/canvas/json-render/view?**', async (route) => {
      if (!failReplacement || new URL(route.request().url()).searchParams.get('nodeId') !== id) return route.continue();
      if (mode === 'srcdoc' && route.request().url().includes('inline-assets=1')) {
        replacementStarted();
        await released;
      }
      failures++;
      await route.fulfill({ status: 503, contentType: 'text/html', body: '<p>Temporary viewer failure</p>' });
    });
    await page.goto(`/workbench?iframe-mode=${mode}`);
    const node = page.locator(`.canvas-node[data-node-id="${id}"]`);
    const painted = node.frameLocator('iframe:not([inert])');
    await expect(painted.getByText('Last healthy view', { exact: true })).toBeVisible();
    const original = await node.locator('iframe:not([inert])').elementHandle();
    if (mode === 'srcdoc') await expect(page.locator('html')).toHaveAttribute('data-ready-held', 'true');
    failReplacement = true;
    expect((await request.patch(`/api/canvas/node/${id}`, { data: { spec: spec('Unavailable update') } })).ok()).toBe(
      true,
    );
    if (mode === 'srcdoc') {
      try {
        await started;
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
        );
        // Cancellation is not a failed load: even before the replacement
        // responds, the original painted document must remain connected.
        expect(await original!.evaluate((frame) => frame.isConnected)).toBe(true);
        await expect(painted.getByText('Last healthy view', { exact: true })).toBeVisible();
      } finally {
        releaseReplacement();
      }
    }
    await expect(page.locator('.attention-toast')).toContainText('Viewer could not load', { timeout: 30_000 });
    await expect(page.locator('.attention-toast')).toContainText('Keeping the last view. Reload to retry.');
    await expect(node.locator('iframe')).toHaveCount(1);
    await expect(painted.getByText('Last healthy view', { exact: true })).toBeVisible();
    // Srcdoc first fetches the failed document, then falls back to src. The
    // replacement itself retries exactly once, never promotes the error page.
    expect(failures).toBe(mode === 'srcdoc' ? 3 : 2);
    await page.screenshot({ path: info.outputPath(`viewer-failed-${mode}.png`) });
    failReplacement = false;
    expect(
      (await request.patch(`/api/canvas/node/${id}`, { data: { spec: spec('Recovered healthy view') } })).ok(),
    ).toBe(true);
    await expect(painted.getByText('Recovered healthy view', { exact: true })).toBeVisible();
    await expect(node.locator('iframe')).toHaveCount(1);
    await page.screenshot({ path: info.outputPath(`viewer-recovered-${mode}.png`) });
  });
}
