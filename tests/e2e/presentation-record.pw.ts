import { test, expect, chromium, type Page, type TestInfo } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderedCamera } from './workspace-fixture.js';

// Orb HTML defaults to 2 s polling for the portal proxy. Keep direct-server
// animation tests explicit; the same suite can also exercise portal polling.
const transport = process.env.PMX_PRESENTATION_TRANSPORT ?? 'sse';
const workbench = `/workbench?transport=${transport}`;

function delivered(page: Page, event = 'canvas-tour-step'): Promise<unknown> {
  if (transport !== 'poll') return Promise.resolve();
  return page.waitForResponse(async (response) => {
    if (!response.url().includes('/api/workbench/poll')) return false;
    const body = (await response.json()) as { events: { event: string }[] };
    return body.events.some((entry) => entry.event === event);
  });
}

async function recordingChrome(testInfo: TestInfo): Promise<string> {
  if (process.platform !== 'linux') return chromium.executablePath();
  // Bun launches Chrome directly, without Playwright's default --no-sandbox.
  // Ubuntu CI restricts user namespaces for downloaded browser binaries. Keep
  // this test-only launch policy out of the product's secure Chrome defaults.
  const wrapper = testInfo.outputPath('recording-chrome.sh');
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  // --headed also applies to this separately launched recorder. This tests a
  // visible capture path, not the product CLI's normal hardcoded headless path.
  const headedArgs =
    testInfo.project.use.headless === false
      ? `for arg do
  shift
  case "$arg" in
    --headless|--headless=*) ;;
    *) set -- "$@" "$arg" ;;
  esac
done
`
      : '';
  await writeFile(
    wrapper,
    `#!/bin/sh\n${headedArgs}exec ${quote(chromium.executablePath())} --no-sandbox "$@" 2>${quote(testInfo.outputPath('recording-chrome.log'))}\n`,
    { mode: 0o755 },
  );
  return wrapper;
}

for (const interruption of ['ctrl-c', 'browser-loss'] as const) {
  test(`foreground PTY recording handles ${interruption} without hiding capture failure`, async ({
    request,
  }, testInfo) => {
    test.skip(process.platform !== 'linux', 'Requires Linux controlling-PTY and process inspection');
    test.setTimeout(60_000);
    const headers = { 'x-pmx-workbench': '1' };
    expect((await request.post('/api/canvas/clear', { headers })).ok()).toBe(true);
    expect((await request.post('/api/canvas/tour', { headers, data: { tour: { stops: [] } } })).ok()).toBe(true);
    const video = testInfo.outputPath('terminal.mp4');
    const args = [
      'bun',
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
      // A short frame interval exercises stopScreencast while Chrome is
      // detaching after PTY Ctrl+C, not only after it is already closed.
      '120',
      '--output',
      video,
      '--chrome-path',
      await recordingChrome(testInfo),
    ];
    // pty.fork creates a controlling terminal with the recorder as foreground
    // process-group leader. ETX reaches Chrome too: kill(recorder, SIGINT) does not.
    const harness = spawn(
      'python3',
      [
        '-c',
        String.raw`
import os, pty, select, time, json, pathlib, subprocess, signal, sys
command=json.loads(sys.argv[1]); target=pathlib.Path(sys.argv[2]); mode=sys.argv[3]
pid,fd=pty.fork()
if pid==0: os.execvp(command[0],command)
log=bytearray(); sent=False; status=None; deadline=time.monotonic()+45
try:
 while time.monotonic()<deadline:
  frames=list(pathlib.Path(str(target)+'.frames').glob('frame-*.png'))
  if len(frames)>=3 and not sent:
   assert os.tcgetpgrp(fd)==pid
   rows=subprocess.check_output(['ps','-o','pid,ppid,pgid,args','-g',str(pid)],text=True)
   rows='\n'.join(rows.splitlines()[1:])
   log.extend(rows.encode())
   if mode=='ctrl-c': os.write(fd,b'\x03')
   else:
    browsers=[int(row.split()[0]) for row in rows.splitlines() if int(row.split()[1])==pid and 'chrome' in row]
    assert browsers, 'No recorder-owned Chrome child'
    os.kill(browsers[0],signal.SIGKILL)
    deadline=time.monotonic()+5
   sent=True
  if select.select([fd],[],[],0.05)[0]:
   try: log.extend(os.read(fd,65536))
   except OSError: pass
  done,code=os.waitpid(pid,os.WNOHANG)
  if done: status=os.waitstatus_to_exitcode(code); break
finally:
 if status is None:
  os.killpg(pid,signal.SIGKILL); os.waitpid(pid,0)
 os.close(fd)
 target.with_suffix('.pty.log').write_bytes(log)
print(json.dumps({'sent':sent,'exitCode':status}))
`,
        JSON.stringify(args),
        video,
        interruption,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    harness.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    harness.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      harness.on('exit', resolve);
      harness.on('error', reject);
    });
    expect(code, stderr).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.sent).toBe(true);
    const log = await readFile(testInfo.outputPath('terminal.pty.log'), 'utf8');
    expect(result.exitCode, log).not.toBeNull();
    if (interruption === 'browser-loss') {
      expect(result.exitCode, log).not.toBe(0);
      expect(log).toMatch(/closed|disconnected|terminated/i);
      expect(await readdir(`${video}.frames`)).not.toContain('recording.json');
      expect(await readdir(testInfo.outputPath())).not.toContain('terminal.mp4');
      return;
    }
    expect(result.exitCode, log).toBe(0);
    const frames = `${video}.frames`;
    const names = (await readdir(frames)).filter((name) => name.endsWith('.png'));
    const metadata = JSON.parse(await readFile(join(frames, 'recording.json'), 'utf8'));
    expect(metadata.frames).toBe(names.length);
    expect(metadata.frames).toBeGreaterThanOrEqual(3);
    const probe = spawn('ffprobe', [
      '-v',
      'error',
      '-count_frames',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=nb_read_frames,width,height',
      '-of',
      'json',
      video,
    ]);
    let decoded = '';
    probe.stdout.on('data', (chunk) => {
      decoded += String(chunk);
    });
    expect(
      await new Promise((resolve, reject) => {
        probe.on('exit', resolve);
        probe.on('error', reject);
      }),
    ).toBe(0);
    const stream = JSON.parse(decoded).streams[0];
    expect(Number(stream.nb_read_frames)).toBe(names.length);
    expect([stream.width, stream.height]).toEqual([640, 360]);
  });
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
  const opening = delivered(page);
  await page.goto(`${workbench}&present=1`);
  await page.waitForFunction(() => window.pmxCapture?.ready());
  await opening;
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

test('a superseded startup explains the stopped request before the new catalog arrives', async ({
  page,
  request,
}, info) => {
  const created = await (await request.post('/api/canvas/boards', { data: { name: 'Presentation ownership' } })).json();
  const id = created.board.id;
  await request.post('/api/canvas/boards/open', { data: { id } });
  await request.post('/api/canvas/tour', {
    data: { tour: { stops: [{ target: { viewport: { x: 0, y: 0, scale: 1 } }, duration: 0 }] } },
  });
  let holdCatalog = false;
  await page.route('**/api/workbench/poll**', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (holdCatalog) body.events = body.events.filter((entry: { event: string }) => entry.event !== 'boards-changed');
    await route.fulfill({ response, json: body });
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route('**/api/canvas/tour/go', async (route) => {
    requested = true;
    await held;
    await route.fulfill({ response: await route.fetch() });
  });
  try {
    await page.goto('/workbench?transport=poll&present=1');
    await expect.poll(() => requested).toBe(true);
    holdCatalog = true;
    await request.post('/api/canvas/boards/open', { data: { id } });
    release();
    await expect(page.getByRole('alert')).toContainText('superseded');
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath('superseded-start.png') });
    await page.getByRole('button', { name: 'Exit presentation', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    release();
    holdCatalog = false;
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('a remote tour starts while the separate initial catalog request is held', async ({ page, request }) => {
  const headers = { 'x-pmx-workbench': '1' };
  await request.post('/api/canvas/clear', { headers });
  const response = await request.post('/api/canvas/node', {
    headers,
    data: { type: 'markdown', title: 'Early tour target', content: 'Visible stop', x: 1900, y: 800 },
  });
  const { id } = await response.json();
  await request.post('/api/canvas/tour', {
    headers,
    data: { tour: { stops: [{ target: { nodeId: id }, duration: 0 }] } },
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let catalogRequested = false;
  let tourDelivered = false;
  await page.route('**/api/canvas/boards', async (route) => {
    const response = await route.fetch();
    catalogRequested = true;
    await held;
    await route.fulfill({ response });
  });
  await page.route('**/api/workbench/poll*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response });
    if (body.events.some((entry: { event: string }) => entry.event === 'canvas-tour-step')) tourDelivered = true;
  });
  try {
    await page.goto('/workbench?transport=poll');
    await expect.poll(() => catalogRequested).toBe(true);
    expect((await request.post('/api/canvas/tour/go', { data: { stop: 0, present: true } })).ok()).toBe(true);
    await expect.poll(() => tourDelivered).toBe(true);
    release();
    const exit = page.getByRole('button', { name: 'Exit presentation', exact: true });
    await expect(exit).toBeVisible();
    const target = page.locator(`.canvas-node[data-node-id="${id}"]`);
    await expect(target).toBeInViewport({ ratio: 1 });
    await exit.click();
    await expect(exit).toHaveCount(0);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

for (const size of [
  { width: 1440, height: 900 },
  { width: 600, height: 700 },
  { width: 360, height: 300 },
  { width: 600, height: 700, dropTourEvents: true },
]) {
  test(`presentation buttons share the cursor and keep content clear at ${size.width}x${size.height}${size.dropTourEvents ? ' without tour echoes' : ''}`, async ({
    page,
    request,
  }) => {
    let dropTourEvents = !!size.dropTourEvents;
    type TourEvent = { event: string; payload: Record<string, unknown> };
    const delayed: TourEvent[] = [];
    const replay: TourEvent[] = [];
    let replayed = 0;
    const echo = async (event: TourEvent) => {
      const count = replayed + 1;
      replay.push(event);
      await expect.poll(() => replayed).toBe(count);
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      );
    };
    if (size.dropTourEvents) {
      await page.route('**/api/workbench/poll*', async (route) => {
        const response = await route.fetch({
          url: route
            .request()
            .url()
            .replace(/waitMs=\d+/, 'waitMs=0'),
        });
        const body = await response.json();
        if (dropTourEvents)
          body.events = body.events.filter((entry: TourEvent) => {
            if (!['canvas-tour-step', 'canvas-tour-exit'].includes(entry.event)) return true;
            delayed.push(entry);
            return false;
          });
        const injected = replay.splice(0);
        body.events.push(...injected);
        await route.fulfill({ response, json: body });
        replayed += injected.length;
      });
    }
    const url = size.dropTourEvents ? '/workbench?transport=poll' : workbench;
    const headers = { 'x-pmx-workbench': '1' };
    await request.post('/api/canvas/clear', { headers });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const node = await request.post('/api/canvas/node', {
        headers,
        data: {
          type: 'markdown',
          title: `Stop ${i + 1}`,
          content: 'Whole card stays visible',
          x: i * 1000,
          y: i * 300,
          width: 440,
          height: 300,
        },
      });
      ids.push((await node.json()).id);
    }
    const tour = { stops: ids.map((nodeId) => ({ target: { nodeId }, duration: 0, padding: 8 })) };
    await request.post('/api/canvas/tour', { headers, data: { tour } });
    const before = await (await request.get('/api/canvas/state')).json();
    await page.setViewportSize(size);
    await page.goto(`${url}&present=1`);
    const back = page.getByRole('button', { name: 'Back', exact: true });
    const next = page.getByRole('button', { name: 'Next', exact: true });
    const exit = page.getByRole('button', { name: 'Exit presentation', exact: true });
    const at = async (index: number) => {
      await expect.poll(async () => (await (await request.get('/api/canvas/tour')).json()).position).toBe(index);
      await expect
        .poll(async () =>
          page.evaluate((id) => {
            const card = document.querySelector(`.canvas-node[data-node-id="${id}"]`)?.getBoundingClientRect();
            const controls = document.querySelector('.presentation-controls')?.getBoundingClientRect();
            if (!card || !controls) return false;
            return (
              card.left >= 0 &&
              card.right <= innerWidth &&
              card.top >= controls.bottom + 11 &&
              card.bottom <= innerHeight &&
              controls.left >= 0 &&
              controls.right <= innerWidth
            );
          }, ids[index]),
        )
        .toBe(true);
    };
    await expect(next).toBeEnabled();
    await expect(back).toBeDisabled();
    await at(0);
    await expect(page.locator('.presentation-guidance')).toHaveCount(0);
    for (const [button, id, shortcut] of [
      [back, 'presentation-back-hint', '← / ↑'],
      [next, 'presentation-next-hint', '→ / ↓ / Space'],
      [exit, 'presentation-exit-hint', 'Esc'],
    ] as const) {
      await expect(button).toHaveAttribute('aria-describedby', id);
      await button.hover({ force: true });
      await expect(page.locator(`#${id}`)).toHaveCSS('opacity', '1');
      await page.mouse.move(2, size.height - 2);
      await page.keyboard.press('Tab');
      await button.focus();
      const tip = page.locator(`#${id}`);
      await expect(tip).toHaveCSS('opacity', '1');
      await expect(tip).toContainText(shortcut);
      const box = (await tip.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
      await page.keyboard.press('Tab');
      await expect(tip).toHaveCSS('opacity', '0');
    }
    await next.click();
    await at(1);
    await back.click();
    await at(0);
    await next.focus();
    await page.keyboard.press('Enter');
    await at(1);
    // Background focus exercises Space as navigation, not native button activation.
    await page.locator('.presentation-navigation').click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('Space');
    await at(2);
    await expect(next).toBeDisabled();
    if (size.dropTourEvents) {
      await expect.poll(() => delayed.some((entry) => entry.payload.index === 2)).toBe(true);
      const camera = await renderedCamera(page);
      // Deliver old echoes separately, not a batch that could hide a rewind.
      for (const event of [...delayed]) {
        await echo(event);
        expect(await renderedCamera(page)).toEqual(camera);
        await expect(next).toBeDisabled();
      }
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/api/canvas/tour/go', async (route) => {
        const response = await route.fetch();
        await held;
        await route.fulfill({ response });
      });
      await back.click();
      await expect.poll(async () => (await (await request.get('/api/canvas/tour')).json()).position).toBe(1);
      await echo(delayed.find((entry) => entry.payload.index === 2)!);
      expect(await renderedCamera(page)).toEqual(camera);
      release();
      await at(1);
      await page.unroute('**/api/canvas/tour/go');
      await next.click();
      await at(2);
    }
    await page.keyboard.press('ArrowLeft');
    await at(1);
    dropTourEvents = false;
    await request.post('/api/canvas/tour/go', { data: { stop: 0 } });
    await at(0);
    await expect(back).toBeDisabled();
    if (size.dropTourEvents) {
      // A late HTTP acknowledgement must not undo a newer shared agent step.
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/api/canvas/tour/go', async (route) => {
        const response = await route.fetch();
        await held;
        await route.fulfill({ response });
      });
      await next.click();
      await at(1);
      await request.post('/api/canvas/tour/go', { data: { stop: 2 } });
      await at(2);
      const acknowledged = page.waitForResponse('**/api/canvas/tour/go');
      release();
      await acknowledged;
      await page.unroute('**/api/canvas/tour/go');
      await expect(next).toBeDisabled();
      await at(2);
      dropTourEvents = true;
      await page.keyboard.press('Escape');
      await expect(exit).toHaveCount(0);
      await expect.poll(() => delayed.some((entry) => entry.event === 'canvas-tour-exit')).toBe(true);
      const oldExit = delayed.find((entry) => entry.event === 'canvas-tour-exit')!;
      let releaseRestart!: () => void;
      const restarted = new Promise<void>((resolve) => {
        releaseRestart = resolve;
      });
      await page.route('**/api/canvas/tour/go', async (route) => {
        const response = await route.fetch();
        await restarted;
        await route.fulfill({ response });
      });
      await page.goto(`${url}&present=1`);
      await expect.poll(async () => (await (await request.get('/api/canvas/tour')).json()).position).toBe(0);
      await echo(oldExit);
      await expect(exit).toHaveCount(0);
      const restartEcho = () =>
        delayed.find(
          (entry) =>
            entry.event === 'canvas-tour-step' && Number(entry.payload.sequence) > Number(oldExit.payload.sequence),
        );
      await expect.poll(restartEcho).toBeDefined();
      await echo(restartEcho()!);
      await expect(exit).toHaveCount(0);
      releaseRestart();
      await expect(exit).toBeVisible();
      await at(0);
      await page.unroute('**/api/canvas/tour/go');
      await echo(oldExit);
      await expect(exit).toBeVisible();
      await at(0);
      await request.post('/api/canvas/tour/exit', { data: {} });
      await expect.poll(() => delayed.filter((entry) => entry.event === 'canvas-tour-exit').length).toBe(2);
      await echo(delayed.filter((entry) => entry.event === 'canvas-tour-exit')[1]);
      await expect(exit).toHaveCount(0);
    }
    if (size.width === 1440) {
      let releaseExit!: () => void;
      let exitResult: unknown;
      const heldExit = new Promise<void>((resolve) => {
        releaseExit = resolve;
      });
      await page.route('**/api/canvas/tour/exit', async (route) => {
        await heldExit;
        const response = await route.fetch();
        exitResult = await response.json();
        await route.fulfill({ response });
      });
      try {
        await exit.click();
        const restarted = page.waitForResponse('**/api/canvas/tour/go');
        await page.getByRole('button', { name: 'Present', exact: true }).click();
        // The restart must complete even if the old exit never gets a response.
        await restarted;
        await at(0);
        const retired = page.waitForResponse('**/api/canvas/tour/exit');
        releaseExit();
        await retired;
        expect(exitResult).toEqual({ ok: true, superseded: true });
        await at(0);
        await expect(exit).toBeVisible();
        await expect(back).toBeDisabled();
        await next.click();
        await at(1);
      } finally {
        releaseExit();
        await page.unroute('**/api/canvas/tour/exit');
      }
    }
    await page.keyboard.press('Escape');
    await expect(exit).toHaveCount(0);
    const after = await (await request.get('/api/canvas/state')).json();
    expect(after.nodes).toEqual(before.nodes);
    expect(after.edges).toEqual(before.edges);
    expect(after.viewport).toEqual(before.viewport);
    expect(after.tour).toEqual(tour);
    await request.post('/api/canvas/tour', { headers, data: { tour: { stops: [] } } });
    await page.goto(`${url}&present=1`);
    await expect(page.locator('.presentation-error')).toContainText('no tour stops');
    await expect(back).toBeDisabled();
    await expect(next).toBeDisabled();
    await exit.click();
    await expect(exit).toHaveCount(0);
    await page.unrouteAll({ behavior: 'wait' });
  });
}

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
  const opening = delivered(page);
  await page.goto(`${workbench}&present=1`);
  await expect(page.locator('.app-shell')).toHaveClass(/is-presenting/);
  await expect(page.locator('.tool-rail')).toBeHidden();
  await expect(page.locator('.top-bar')).toBeHidden();
  await expect(page.locator('.minimap')).toBeHidden();
  const first = page.locator('.canvas-node').filter({ hasText: 'Tour opening' });
  const last = page.locator('.canvas-node').filter({ hasText: 'Tour conclusion' });
  await opening;
  await page.waitForTimeout(500);
  const firstBox = await first.boundingBox();
  expect(firstBox!.x).toBeGreaterThanOrEqual(69);
  expect(firstBox!.x + firstBox!.width).toBeLessThanOrEqual(1371);
  const forward = delivered(page);
  await page.keyboard.press('Space');
  await forward;
  await page.waitForTimeout(600);
  const lastBox = await last.boundingBox();
  expect(lastBox!.y).toBeGreaterThanOrEqual(
    (await page.locator('.presentation-controls').boundingBox())!.y +
      (await page.locator('.presentation-controls').boundingBox())!.height +
      11,
  );
  expect(lastBox!.x + lastBox!.width).toBeLessThan(1440);
  await page.screenshot({ path: testInfo.outputPath('presentation.png') });
  const backward = delivered(page);
  await page.keyboard.press('ArrowLeft');
  await backward;
  await page.waitForTimeout(400);
  expect((await first.boundingBox())!.x).toBeCloseTo(firstBox!.x, 0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.tool-rail')).toBeVisible();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(page.locator('.tool-rail')).toBeHidden();
  // The capture acknowledgement is followed by a rendered camera check, not
  // just an assertion on the model's tuple.
  const camera = { x: 140, y: 80, scale: 0.5 };
  await page.goto(`${workbench}&present=1&capture=1`);
  await page.waitForFunction(() => window.pmxCapture?.ready());
  await expect(page.getByRole('button', { name: 'Exit presentation', exact: true })).toBeHidden();
  await page.evaluate((camera) => window.pmxCapture!.frame(camera), camera);
  expect(await renderedCamera(page)).toEqual(camera);
  const viewportUpdate = delivered(page, 'canvas-viewport-update');
  await request.post('/api/canvas/viewport', { headers, data: { x: -500, y: -500, scale: 2 } });
  await viewportUpdate;
  await page.waitForTimeout(100);
  expect(await renderedCamera(page)).toEqual(camera);

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
  const opening = delivered(page);
  await page.goto(`${workbench}&present=1`);
  await page.waitForFunction(() => window.pmxCapture?.ready());
  await opening;
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
  await page.goto(workbench);
  await page.waitForFunction(() => window.pmxCapture?.ready());
  await expect(page.locator('.top-bar')).toBeVisible();
  const layoutWrites: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/canvas/update')
      layoutWrites.push(request.postData() ?? '');
  });
  const scaleNow = async () => (await renderedCamera(page)).scale;
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
        // Include a poll interval when testing polling; still sample EVERY
        // painted frame and require the same distinct scales and pull-back.
        const end = performance.now() + (location.search.includes('transport=poll') ? 4000 : 1500);
        const tick = () => {
          out.push(new DOMMatrixReadOnly(getComputedStyle(world).transform).a);
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
      const painted = await renderedCamera(page);
      return ['x', 'y', 'scale'].every((k) => Math.abs(saved[k] - painted[k as 'x']) < 0.05);
    })
    .toBe(true);
  expect(await history()).toEqual(before);

  // Reduced motion: a 3 s move lands on the next frame.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const move = delivered(page, 'canvas-camera-move');
  await request.post('/api/canvas/camera/move', {
    data: { rect: { x: 1700, y: -900, width: 500, height: 300 }, duration: 3 },
  });
  await move;
  await expect.poll(() => inView('Agent stop two'), { timeout: 500 }).toBe(true);
  // Include delayed layout persistence after the final camera has painted.
  await page.waitForTimeout(600);
  expect(layoutWrites, 'Navigation must not rewrite any card geometry').toEqual([]);
});
