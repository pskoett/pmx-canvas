import { test, expect, chromium, type TestInfo } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function recordingChrome(testInfo: TestInfo): Promise<string> {
  if (process.platform !== 'linux') return chromium.executablePath();
  // Bun launches Chrome directly, without Playwright's default --no-sandbox.
  // Ubuntu CI restricts user namespaces for downloaded browser binaries. Keep
  // this test-only launch policy out of the product's secure Chrome defaults.
  const wrapper = testInfo.outputPath('recording-chrome.sh');
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(
    wrapper,
    `#!/bin/sh\nexec ${quote(chromium.executablePath())} --no-sandbox "$@" 2>${quote(testInfo.outputPath('recording-chrome.log'))}\n`,
    { mode: 0o755 },
  );
  return wrapper;
}

test('realtime recording sees concurrent edits and finalizes on SIGTERM', async ({ request }, testInfo) => {
  test.setTimeout(60_000);
  const headers = { 'x-pmx-workbench': '1' };
  await request.post('/api/canvas/clear', { headers });
  await request.post('/api/canvas/tour', { headers, data: { tour: { stops: [] } } });
  await request.post('/api/canvas/viewport', { headers, data: { x: 0, y: 0, scale: 1 } });
  const frames = testInfo.outputPath('live');
  const child = spawn(
    'bun',
    [
      'run',
      'src/cli/index.ts',
      'record',
      '--port',
      process.env.PMX_PLAYWRIGHT_PORT ?? '4517',
      '--stop-on-signal',
      '--present',
      '--resolution',
      '640x360',
      '--fps',
      '5',
      '--output',
      frames,
      '--chrome-path',
      await recordingChrome(testInfo),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  child.stdout.on('data', (chunk) => {
    log += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    log += String(chunk);
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on('exit', resolve);
    child.on('error', reject);
  });
  try {
    await expect
      .poll(
        async () => {
          if (child.exitCode !== null) throw new Error(`Recording exited ${child.exitCode}: ${log}`);
          return (await readdir(frames).catch(() => [])).filter((n) => n.endsWith('.png')).length;
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(1);
    const before = await readFile(join(frames, 'frame-000000.png'));
    expect(
      (
        await request.post('/api/canvas/node', {
          headers,
          data: {
            type: 'markdown',
            title: 'Arrived during recording',
            content: '# LIVE UPDATE\n\nThis node was added after recording started.',
            x: 50,
            y: 50,
            width: 500,
            height: 250,
          },
        })
      ).ok(),
    ).toBe(true);
    // Orb pages may use polling rather than SSE. Wait for the recorded
    // visible change AND the frame budget asserted below before stopping.
    // Fast SSE hosts can show the edit in frame 3; SIGTERM then correctly
    // finalizes with only 3 frames, unlike the slower polling path.
    await expect
      .poll(
        async () => {
          const names = (await readdir(frames)).filter((n) => n.endsWith('.png')).sort();
          return names.length > 3 && !(await readFile(join(frames, names.at(-1)!))).equals(before);
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    child.kill('SIGTERM');
    expect(await exited, log).toBe(0);
    const names = (await readdir(frames)).filter((n) => n.endsWith('.png')).sort();
    expect(names.length).toBeGreaterThan(3);
    expect((await readFile(join(frames, names.at(-1)!))).equals(before)).toBe(false);
    const metadata = JSON.parse(await readFile(join(frames, 'recording.json'), 'utf8'));
    expect(metadata.frames).toBe(names.length);
    await testInfo.attach('live-final-frame', { path: join(frames, names.at(-1)!), contentType: 'image/png' });
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
});

test('presentation right-drag interrupts the tour locally and exposes an exit button', async ({ page, request }) => {
  const headers = { 'x-pmx-workbench': '1' };
  await request.post('/api/canvas/clear', { headers });
  await request.post('/api/canvas/viewport', { headers, data: { x: 0, y: 0, scale: 1 } });
  await request.post('/api/canvas/node', {
    headers,
    data: { type: 'markdown', title: 'Pan this presentation', content: 'Read-only card', x: 200, y: 150 },
  });
  await request.post('/api/canvas/tour', {
    headers,
    data: {
      tour: {
        stops: [
          { target: { viewport: { x: -300, y: -200, scale: 1 } }, duration: 3 },
          { target: { viewport: { x: 80, y: 60, scale: 1 } }, duration: 0 },
        ],
      },
    },
  });
  const savedViewport = (await (await request.get('/api/canvas/state')).json()).viewport;
  await page.goto('/workbench?present=1');
  await page.waitForFunction(() => window.pmxCapture?.ready());
  await page.waitForTimeout(300);
  const card = page.locator('.canvas-node').filter({ hasText: 'Pan this presentation' });
  await page.mouse.move(600, 400);
  await page.mouse.down({ button: 'right' });
  const before = await card.boundingBox();
  await page.mouse.move(740, 480, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  const after = await card.boundingBox();
  expect(after!.x - before!.x).toBeCloseTo(140, 0);
  expect(after!.y - before!.y).toBeCloseTo(80, 0);
  // A still-running tour must not pull the camera back after the gesture.
  await page.waitForTimeout(3200);
  expect((await card.boundingBox())!.x).toBeCloseTo(after!.x, 0);
  expect((await (await request.get('/api/canvas/state')).json()).viewport).toEqual(savedViewport);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await card.boundingBox())!.x).toBe(280);
  await page.mouse.move(320, 225);
  await page.mouse.down();
  await page.mouse.move(430, 295, { steps: 5 });
  await page.mouse.up();
  expect((await card.boundingBox())!.x).toBe(280);
  const exit = page.getByRole('button', { name: 'Exit presentation', exact: true });
  await expect(exit).toBeVisible();
  await exit.click();
  await expect(page.locator('.top-bar')).toBeVisible();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await exit.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.top-bar')).toBeVisible();
});

test('tour framing, keyboard exit, painted frames and CLI recording', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const headers = { 'x-pmx-workbench': '1' };
  await request.post('/api/canvas/clear', { headers });
  const a = (await (
    await request.post('/api/canvas/node', {
      headers,
      data: {
        type: 'markdown',
        title: 'Tour opening',
        content: '# A board worth showing\n\nPresentation keeps the camera local while board content stays live.',
        x: -1300,
        y: 200,
        width: 500,
        height: 300,
      },
    })
  ).json()) as { id: string };
  const b = (await (
    await request.post('/api/canvas/node', {
      headers,
      data: {
        type: 'markdown',
        title: 'Tour conclusion',
        content: '# Precise camera frames\n\nEvery frame waits for the renderer before capture.',
        x: 1700,
        y: -900,
        width: 600,
        height: 400,
      },
    })
  ).json()) as { id: string };
  const tour = {
    stops: [
      { target: { nodeId: a.id }, duration: 0.2, padding: 70 },
      { target: { nodeId: b.id }, duration: 0.4, padding: 50, pullback: 0.5 },
    ],
  };
  expect((await request.post('/api/canvas/tour', { headers, data: { tour } })).ok()).toBe(true);
  expect((await (await request.get('/api/canvas/tour')).json()).tour).toEqual(tour);
  expect(
    (await request.post('/api/canvas/tour', { headers, data: { tour: { stops: [{ target: {} }] } } })).status(),
  ).toBe(400);
  await page.goto('/workbench?present=1');
  await expect(page.locator('.app-shell')).toHaveClass(/is-presenting/);
  await expect(page.locator('.tool-rail')).toBeHidden();
  await expect(page.locator('.top-bar')).toBeHidden();
  await expect(page.locator('.minimap')).toBeHidden();
  const first = page.locator('.canvas-node').filter({ hasText: 'Tour opening' });
  const last = page.locator('.canvas-node').filter({ hasText: 'Tour conclusion' });
  await page.waitForTimeout(500);
  const firstBox = await first.boundingBox();
  expect(firstBox!.x).toBeGreaterThanOrEqual(69);
  expect(firstBox!.x + firstBox!.width).toBeLessThanOrEqual(1371);
  await page.keyboard.press('Space');
  await page.waitForTimeout(600);
  const lastBox = await last.boundingBox();
  expect(lastBox!.y).toBeCloseTo(50, 0);
  expect(lastBox!.x + lastBox!.width).toBeLessThan(1440);
  await page.screenshot({ path: testInfo.outputPath('presentation.png') });
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  expect((await first.boundingBox())!.x).toBeCloseTo(firstBox!.x, 0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.tool-rail')).toBeVisible();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(page.locator('.tool-rail')).toBeHidden();
  // The capture acknowledgement is followed by a DOM-level matrix check, not
  // just an assertion on the model's tuple.
  const camera = { x: 140, y: 80, scale: 0.5 };
  await page.goto('/workbench?present=1&capture=1');
  await page.waitForFunction(() => window.pmxCapture?.ready());
  await expect(page.getByRole('button', { name: 'Exit presentation', exact: true })).toBeHidden();
  await page.evaluate((camera) => window.pmxCapture!.frame(camera), camera);
  expect(await page.locator('.canvas-world').evaluate((el) => getComputedStyle(el).transform)).toBe(
    'matrix(0.5, 0, 0, 0.5, 140, 80)',
  );
  await request.post('/api/canvas/viewport', { headers, data: { x: -500, y: -500, scale: 2 } });
  await page.waitForTimeout(100);
  expect(await page.locator('.canvas-world').evaluate((el) => getComputedStyle(el).transform)).toBe(
    'matrix(0.5, 0, 0, 0.5, 140, 80)',
  );

  const frames = testInfo.outputPath('frames');
  const args = [
    'run',
    'src/cli/index.ts',
    'record',
    '--port',
    process.env.PMX_PLAYWRIGHT_PORT ?? '4517',
    '--mode',
    'deterministic',
    '--present',
    '--resolution',
    '640x360',
    '--fps',
    '5',
    '--output',
    frames,
    '--chrome-path',
    await recordingChrome(testInfo),
  ];
  const child = spawn('bun', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (chunk) => {
    log += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    log += String(chunk);
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('exit', resolve);
    child.on('error', reject);
  });
  expect(code, log).toBe(0);
  expect((await readdir(frames)).filter((name) => name.endsWith('.png'))).toHaveLength(3);
  expect(JSON.parse(await readFile(join(frames, 'recording.json'), 'utf8')).frames).toBe(3);
  const png = await readFile(join(frames, 'frame-000002.png'));
  expect(png.readUInt32BE(16)).toBe(640);
  expect(png.readUInt32BE(20)).toBe(360);
  await testInfo.attach('recorded-final-frame', { path: join(frames, 'frame-000002.png'), contentType: 'image/png' });
});

test('unsaved tours derive group order and missing saved targets remain escapable', async ({ page, request }) => {
  const headers = { 'x-pmx-workbench': '1' };
  await request.post('/api/canvas/clear', { headers });
  const ids: string[] = [];
  for (const [title, x, y] of [
    ['Later group', 800, 1000],
    ['Opening group', -1800, -300],
  ] as const) {
    const result = (await (
      await request.post('/api/canvas/node', {
        headers,
        data: {
          type: 'group',
          title,
          x,
          y,
          width: 600,
          height: 400,
        },
      })
    ).json()) as { id: string };
    ids.push(result.id);
  }
  const derived = await (await request.get('/api/canvas/tour')).json();
  expect(derived.derived).toBe(true);
  expect(derived.tour.stops.map((stop: { target: { nodeId: string } }) => stop.target.nodeId)).toEqual(ids.reverse());
  await page.goto('/workbench?present=1');
  await page.waitForFunction(() => window.pmxCapture?.ready());
  await page.waitForTimeout(1200);
  const group = page.locator('[data-node-id]').filter({ hasText: 'Opening group' }).first();
  const box = await group.boundingBox();
  expect(box!.x).toBeGreaterThan(0);
  expect(box!.y).toBeGreaterThan(0);
  expect(box!.x + box!.width).toBeLessThan(1440);
  await request.post('/api/canvas/tour', {
    headers,
    data: { tour: { stops: [{ target: { nodeId: 'missing-target' } }] } },
  });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Tour target not found');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Present', exact: true })).toBeVisible();
});

test('an agent drives the tour and eases the camera without undo entries; reduced motion jumps', async ({
  page,
  request,
}) => {
  const headers = { 'x-pmx-workbench': '1' };
  await request.post('/api/canvas/clear', { headers });
  const add = async (title: string, x: number, y: number) =>
    (
      (await (
        await request.post('/api/canvas/node', {
          headers,
          data: { type: 'markdown', title, content: title, x, y, width: 500, height: 300 },
        })
      ).json()) as { id: string }
    ).id;
  const a = await add('Agent stop one', -1300, 200);
  const b = await add('Agent stop two', 1700, -900);
  await request.post('/api/canvas/tour', {
    headers,
    data: {
      tour: {
        stops: [
          { target: { nodeId: a }, duration: 0.2 },
          { target: { nodeId: b }, duration: 1.2, pullback: 1 },
        ],
      },
    },
  });
  await page.goto('/workbench');
  await page.waitForFunction(() => window.pmxCapture?.ready());
  await expect(page.locator('.top-bar')).toBeVisible();
  const world = page.locator('.canvas-world');
  const scaleNow = () => world.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  const inView = async (title: string) => {
    const box = (await page.locator('.canvas-node').filter({ hasText: title }).boundingBox())!;
    return box.x >= 0 && box.y >= 0 && box.x + box.width <= 1440 && box.y + box.height <= 900;
  };

  // Agent call (no workbench marker): the idle workbench starts presenting.
  await request.post('/api/canvas/tour/go', { data: { stop: 0 } });
  await expect(page.locator('.app-shell')).toHaveClass(/is-presenting/);
  await expect.poll(() => inView('Agent stop one')).toBe(true);
  const startScale = await scaleNow();

  // Sample every painted frame of the eased move: many distinct scales, and
  // the pull-back dips below both endpoint zooms mid-move.
  const samples = page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const world = document.querySelector('.canvas-world')!;
        const out: number[] = [];
        const end = performance.now() + 1500;
        const tick = () => {
          out.push(new DOMMatrix(getComputedStyle(world).transform).a);
          if (performance.now() < end) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
  );
  expect((await request.post('/api/canvas/tour/go', { data: { step: 'next' } })).ok()).toBe(true);
  const scales = await samples;
  const endScale = await scaleNow();
  expect(new Set(scales.map((s) => s.toFixed(4))).size).toBeGreaterThan(10);
  expect(Math.min(...scales)).toBeLessThan(Math.min(startScale, endScale) * 0.8);
  expect(await inView('Agent stop two')).toBe(true);

  // The human's key moves the SHARED cursor, so the agent's next follows it.
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => inView('Agent stop one')).toBe(true);
  const next = await (await request.post('/api/canvas/tour/go', { data: { step: 'next', present: false } })).json();
  expect(next).toMatchObject({ index: 1, total: 2 });

  await request.post('/api/canvas/tour/exit', { data: {} });
  await expect(page.locator('.top-bar')).toBeVisible();

  // Outside a presentation the move lands as the board viewport, unrecorded.
  const history = async () => (await (await request.get('/api/canvas/history')).json()).entries;
  const before = await history();
  await request.post('/api/canvas/camera/move', { data: { nodeId: a, duration: 0.3 } });
  await expect.poll(() => inView('Agent stop one')).toBe(true);
  // Once the move ends, the board viewport the server holds IS the painted camera.
  await expect
    .poll(async () => {
      const saved = (await (await request.get('/api/canvas/state')).json()).viewport;
      const painted = await world.evaluate((el) => {
        const m = new DOMMatrix(getComputedStyle(el).transform);
        return { x: m.e, y: m.f, scale: m.a };
      });
      return ['x', 'y', 'scale'].every((k) => Math.abs(saved[k] - painted[k as 'x']) < 0.01);
    })
    .toBe(true);
  expect(await history()).toEqual(before);

  // Reduced motion: a 3 s move lands on the next frame.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await request.post('/api/canvas/camera/move', {
    data: { rect: { x: 1700, y: -900, width: 500, height: 300 }, duration: 3 },
  });
  await expect.poll(() => inView('Agent stop two'), { timeout: 500 }).toBe(true);
});
