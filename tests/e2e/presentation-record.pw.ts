import { test, expect, chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

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
      chromium.executablePath(),
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
      .poll(async () => (await readdir(frames).catch(() => [])).filter((n) => n.endsWith('.png')).length)
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
    // visible change, not a delay shorter than the poll interval.
    await expect
      .poll(
        async () => {
          const names = (await readdir(frames)).filter((n) => n.endsWith('.png')).sort();
          return (await readFile(join(frames, names.at(-1)!))).equals(before);
        },
        { timeout: 10_000 },
      )
      .toBe(false);
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
    chromium.executablePath(),
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
