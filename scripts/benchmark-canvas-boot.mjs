import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// DISPLAY=:99 node scripts/benchmark-canvas-boot.mjs <disposable-server-url> <baseline-index.js>
// Build dist/canvas first. The supplied server must serve this checkout's assets.
// Same disposable board, CSS, server, CPU rate and fresh cache per sample.
const [base, baseline] = process.argv.slice(2);
if (!base || !baseline) throw new Error('Expected disposable server URL and baseline bundle path.');
const workbench = await (await fetch(base + '/workbench')).text();
const token = workbench.match(/window\.__PMX_WORKBENCH_TOKEN = ("[^"]+")/);
if (!token) throw new Error('Expected disposable workbench token for board cleanup.');
const headers = {
  'content-type': 'application/json',
  'x-pmx-workbench': '1',
  'x-pmx-workbench-token': JSON.parse(token[1]),
};
async function api(path, data, method = data ? 'POST' : 'GET') {
  const response = await fetch(base + path, { method, headers, body: data ? JSON.stringify(data) : undefined });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}
const previous = (await api('/api/canvas/boards')).activeBoardId;
const { board } = await api('/api/canvas/boards', { name: 'UI cold boot measurement' });
await api('/api/canvas/boards/open', { id: board.id });
for (let i = 0; i < 6; i++)
  await api('/api/canvas/node', {
    type: 'markdown',
    title: `Measurement ${i}`,
    content: `Visible workload ${i}`,
    x: 60 + (i % 3) * 340,
    y: 80 + Math.floor(i / 3) * 250,
    width: 300,
    height: 200,
  });
await api('/api/canvas/viewport', { x: 0, y: 0, scale: 1 });
const variants = {
  baseline: await readFile(baseline, 'utf8'),
  candidate: await readFile('dist/canvas/index.js', 'utf8'),
};
const browser = await chromium.launch({ headless: false });
const results = [];
try {
  for (let i = 0; i < 10; i++) {
    const name = i % 2 ? 'candidate' : 'baseline';
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    try {
      const page = await context.newPage();
      const scripts = [];
      page.on('requestfinished', (request) => {
        if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname);
      });
      await page.route('**/canvas/index.js*', (route) =>
        route.fulfill({ contentType: 'text/javascript', body: variants[name] }),
      );
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await cdp.send('Performance.enable');
      await page.addInitScript(() => {
        const observer = new MutationObserver(() => {
          const cards = document.querySelectorAll('.canvas-node');
          if (cards.length !== 6 || ![...cards].every((card) => card.textContent.includes('Visible workload'))) return;
          observer.disconnect();
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              window.firstCardsPainted = performance.now();
            }),
          );
        });
        observer.observe(document, { childList: true, subtree: true });
      });
      await page.goto(base + '/workbench?transport=sse');
      await page.waitForFunction(() => window.firstCardsPainted);
      const paintedMs = await page.evaluate(() => window.firstCardsPainted);
      const { metrics } = await cdp.send('Performance.getMetrics');
      const measured = Object.fromEntries(
        metrics
          .filter((entry) => ['ScriptDuration', 'TaskDuration', 'LayoutDuration'].includes(entry.name))
          .map((entry) => [entry.name, entry.value * 1000]),
      );
      results.push({ name, paintedMs, ...measured, scripts });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  if (previous) await api('/api/canvas/boards/open', { id: previous });
  await api(`/api/canvas/boards/${board.id}`, undefined, 'DELETE');
}
const output = {
  conditions:
    'Headed Chromium, 4x CPU, fresh context/cache disabled, six Markdown cards plus two animation frames, local response interception (no bandwidth cost), alternating five runs each',
  browser: browser.version(),
  bytes: Object.fromEntries(Object.entries(variants).map(([name, code]) => [name, Buffer.byteLength(code)])),
  results,
};
console.log(JSON.stringify(output, null, 2));
