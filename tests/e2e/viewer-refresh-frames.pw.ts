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

for (const { theme, os, dark } of cases) {
  test(`workboard refresh paints no blank or white frame (${theme}, OS ${os})`, async ({ browser, request }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: os });
    const page = await context.newPage();
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
      await expect(node.locator('iframe:visible').contentFrame().getByText(`Seed ${theme} ${os}`)).toBeVisible();
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
      await expect(node.locator('iframe')).toHaveCount(1);
      await page.waitForTimeout(300);
      await cdp.send('Page.stopScreencast');
      await expect(node.locator('iframe:visible').contentFrame().getByText(`Task 4 ${theme} ${os}`)).toBeVisible();

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
    } finally {
      for (const itemId of items) await request.delete(`/api/canvas/ax/work/${itemId}`);
      await request.delete(`/api/canvas/node/${id}`);
      await context.close();
    }
  });
}
