import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

// Use a disposable server only. --seed replaces its board with 200 cards and
// 150 labelled edges. Compare the same board/bundle, with no other browser/build
// running. This measures navigation, not initial viewer loading.
// DISPLAY=:99 node scripts/benchmark-edge-navigation.mjs URL OUTDIR [--seed]
const [base, output, seed] = process.argv.slice(2);
if (!base || !output) throw new Error('Expected URL OUTDIR [--seed]');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: false });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const api = async (path, body) => {
    const response = await context.request.post(`${base}${path}`, {
      headers: { 'x-pmx-workbench': '1' }, data: body,
    });
    if (!response.ok()) throw new Error(`${path}: ${await response.text()}`);
    return response.json();
  };
  if (seed === '--seed') {
    await api('/api/canvas/clear', {});
    const ids = [];
    for (let i = 0; i < 200; i++) {
      const { id } = await api('/api/canvas/node', {
        type: 'markdown', title: `Card ${i}`, content: 'Navigation workload',
        x: (i % 10) * 400, y: Math.floor(i / 10) * 340, width: 280, height: 180, strictSize: true,
      });
      ids.push(id);
    }
    for (let i = 0; i < 150; i++) {
      await api('/api/canvas/edge', { type: 'relation', from: ids[i], to: ids[i + 10], label: `Related evidence ${i}` });
    }
  }
  const page = await context.newPage();
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.measureText;
    window.edgeMeasurements = 0;
    CanvasRenderingContext2D.prototype.measureText = function (...args) {
      window.edgeMeasurements++;
      return original.apply(this, args);
    };
  });
  await page.goto(`${base}/workbench?capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.pmxCapture?.ready());
  await page.evaluate(() => document.fonts.ready);
  const before = await (await context.request.get(`${base}/api/canvas/state`)).json();
  if (before.nodes.length !== 200 || before.edges.length !== 150) throw new Error('Wrong benchmark board');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  const bundle = await (await context.request.get(`${base}/canvas/index.js`)).body();
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const kind of ['pan', 'zoom']) {
      await page.evaluate(() => window.pmxCapture.frame({ x: 40, y: 80, scale: 0.6 }));
      await page.mouse.move(1300, 700);
      await page.evaluate(() => { window.edgeMeasurements = 0; });
      const start = await cdp.send('Performance.getMetrics');
      await cdp.send('Profiler.start');
      const frames = await page.evaluate(async (kind) => {
        const frames = [];
        for (let i = 0; i < 60; i++) {
          const start = performance.now();
          const scale = kind === 'zoom' ? 0.6 - 0.2 * Math.sin(i / 59 * Math.PI) : 0.6;
          await window.pmxCapture.frame({ x: 40 - i * 4, y: 80 - i * 2, scale });
          frames.push(performance.now() - start);
        }
        return frames;
      }, kind);
      const { profile } = await cdp.send('Profiler.stop');
      const end = await cdp.send('Performance.getMetrics');
      const metrics = Object.fromEntries(end.metrics.filter(m => m.name.endsWith('Duration')).map(m =>
        [m.name, m.value - start.metrics.find(s => s.name === m.name).value]));
      const measured = await page.evaluate(() => ({
        textMeasurements: window.edgeMeasurements,
        cards: document.querySelectorAll('.canvas-node').length,
        pills: document.querySelectorAll('.edge-pill').length,
        paint: [...document.querySelectorAll('.edge-pill')].map(p => [p.dataset.edgeId, p.getAttribute('transform'), p.textContent]),
      }));
      const sorted = [...frames].sort((a, b) => a - b);
      const result = { kind, repeat, browser: browser.version(), bundle: createHash('sha256').update(bundle).digest('hex'),
        metrics, frameMedian: sorted[30], frameP95: sorted[57], frames, ...measured };
      writeFileSync(`${output}/${kind}-${repeat}.json`, JSON.stringify(result, null, 2));
      writeFileSync(`${output}/${kind}-${repeat}.cpuprofile`, JSON.stringify(profile));
      console.log(JSON.stringify({ ...result, frames: undefined, paint: undefined }));
    }
  }
  const after = await (await context.request.get(`${base}/api/canvas/state`)).json();
  for (const key of ['nodes', 'edges', 'viewport', 'tour']) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) throw new Error(`Saved ${key} changed`);
  }
} finally {
  await browser.close();
}
