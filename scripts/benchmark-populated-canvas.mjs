import { chromium, webkit } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { loadavg, freemem, totalmem } from 'node:os';

// Read-only: point at disposable servers seeded with the SAME 70-card demo,
// viewport and theme. No builds/tests/other browsers should run during sampling.
// DISPLAY=:99 node scripts/benchmark-populated-canvas.mjs chromium label=url ...
// Each fresh context is a cold browser cache; its reload is warm. Server and OS
// caches are warm in both cases. Timings include instrumentation, not native-host paint.
const [engine = 'chromium', ...targets] = process.argv.slice(2);
if (!targets.length) throw new Error('Expected engine and label=url targets');
const browser = await ({ chromium, webkit }[engine]).launch({ headless: false });
const results = [];
try {
  for (let repeat = 0; repeat < Number(process.env.REPEATS || 3); repeat++) {
    for (const target of repeat % 2 ? [...targets].reverse() : targets) {
      const split = target.indexOf('=');
      const label = target.slice(0, split);
      const base = target.slice(split + 1).replace(/\/$/, '');
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
      try {
        const page = await context.newPage();
        await page.addInitScript(() => {
          if (window !== top) {
            let sent = false;
            const check = () => {
              const body = document.body;
              if (sent || !body || !body.innerText.trim() || body.innerText.trim() === 'Waiting for UI spec...') return;
              const root = document.getElementById('root');
              if (root && !root.childElementCount) return;
              sent = true;
              observer.disconnect();
              requestAnimationFrame(() => requestAnimationFrame(() => parent.postMessage({ benchmark: 'content-ready' }, '*')));
            };
            const observer = new MutationObserver(check);
            observer.observe(document, { childList: true, subtree: true, characterData: true });
            addEventListener('DOMContentLoaded', check);
            return;
          }
          const m = window.populatedLoad = { board: null, ready: {}, visibleReady: {}, loads: [], runtime: [], longTasks: [] };
          const reveal = () => {
            for (const id of Object.keys(m.ready)) {
              const card = document.querySelector(`[data-node-id="${id}"]`);
              if (card && !card.querySelector('.viewer-fallback') && !m.visibleReady[id]) m.visibleReady[id] = performance.now();
            }
          };
          new MutationObserver(reveal).observe(document, { childList: true, subtree: true });
          const nodeFor = source => [...document.querySelectorAll('iframe')].find(f => f.contentWindow === source)?.closest('[data-node-id]')?.dataset.nodeId;
          addEventListener('message', e => {
            const id = nodeFor(e.source);
            if (!id) return;
            if (e.data?.benchmark === 'content-ready' && !m.ready[id]) m.ready[id] = performance.now();
            if (['mounted', 'ready'].includes(e.data?.type)) m.runtime.push({ id, type: e.data.type, at: performance.now() });
            reveal();
          });
          document.addEventListener('load', e => {
            if (e.target instanceof HTMLIFrameElement) m.loads.push({ id: e.target.closest('[data-node-id]')?.dataset.nodeId, at: performance.now() });
          }, true);
          if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => {
            m.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })));
          }).observe({ type: 'longtask', buffered: true });
          const observer = new MutationObserver(() => {
            if (document.querySelectorAll('.canvas-node').length !== 70) return;
            observer.disconnect();
            requestAnimationFrame(() => requestAnimationFrame(() => { m.board = performance.now(); }));
          });
          observer.observe(document, { childList: true, subtree: true });
        });
        for (const cache of ['cold', 'warm']) {
          const failures = [];
          const errors = [];
          const requests = new Set();
          const started = r => requests.add(r);
          const failed = r => {
            if (requests.has(r)) failures.push({ url: new URL(r.url()).pathname, error: r.failure()?.errorText });
          };
          const error = e => errors.push(e.message);
          page.on('request', started);
          page.on('requestfailed', failed);
          page.on('pageerror', error);
          const host = { load: loadavg(), freeMB: freemem() / 1048576, totalMB: totalmem() / 1048576 };
          // The orb workload limit is smaller than the VM's reported RAM.
          const cgroup = '/sys/fs/cgroup/amp.slice/amp-workload.slice';
          if (existsSync(cgroup)) host.cgroup = Object.fromEntries(
            ['memory.current', 'memory.max', 'memory.events', 'cpu.stat'].map(name =>
              [name, readFileSync(`${cgroup}/${name}`, 'utf8').trim()]),
          );
          const mode = process.env.IFRAME_MODE;
          const query = `transport=sse${mode ? `&iframe-mode=${encodeURIComponent(mode)}` : ''}`;
          if (cache === 'cold') await page.goto(`${base}/workbench?${query}`, { waitUntil: 'domcontentloaded' });
          else await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => window.populatedLoad.board, null, { timeout: 30000 });
          const visible = await page.locator('.canvas-node').evaluateAll(nodes => nodes.filter(n => {
            const r = n.getBoundingClientRect();
            return ['graph', 'json-render', 'html', 'mcp-app'].includes(n.dataset.nodeType) && r.bottom > 44 && r.top < innerHeight && r.right > 48 && r.left < innerWidth;
          }).map(n => n.dataset.nodeId));
          let timedOut = false;
          try {
            await page.waitForFunction(ids => ids.every(id => window.populatedLoad.visibleReady[id]), visible, { timeout: 30000 });
          } catch { timedOut = true; }
          const measurement = await page.evaluate(ids => {
            const m = window.populatedLoad;
            const times = ids.map(id => m.visibleReady[id]).filter(Boolean);
            return {
              ...m, visible: ids, firstViewer: times.length ? Math.min(...times) : null, allVisible: times.length && times.length === ids.length ? Math.max(...times) : null,
              missing: ids.filter(id => !m.visibleReady[id]), frames: document.querySelectorAll('iframe').length,
              srcdocFrames: document.querySelectorAll('iframe[srcdoc]').length,
              fallback: [...document.querySelectorAll('.viewer-fallback')].map(e => ({ id: e.closest('[data-node-id]')?.dataset.nodeId, text: e.textContent })),
              navigation: performance.getEntriesByType('navigation').map(e => e.toJSON()),
              resources: performance.getEntriesByType('resource').map(e => ({ name: new URL(e.name).pathname, start: e.startTime, end: e.responseEnd, bytes: e.transferSize, decoded: e.decodedBodySize })),
              world: getComputedStyle(document.querySelector('.canvas-world')).transform,
            };
          }, visible);
          // Parent entries omit subframe resources. srcdoc preparation appears
          // in the parent instead, so parent-only byte totals are not comparable.
          const frameResources = await Promise.all(page.frames().filter(f => f !== page.mainFrame()).map(f => f.evaluate(() => ({
            navigation: performance.getEntriesByType('navigation').map(e => ({ start: e.startTime, end: e.responseEnd, decoded: e.decodedBodySize })),
            resources: performance.getEntriesByType('resource').map(e => ({ name: new URL(e.name).pathname, bytes: e.transferSize, decoded: e.decodedBodySize })),
          }))));
          const bundle = await page.request.get(`${base}/canvas/index.js`);
          const sample = { label, repeat, cache, engine, browser: browser.version(), bundle: createHash('sha256').update(await bundle.body()).digest('hex'), host, timedOut, failures, errors, frameResources, ...measurement };
          results.push(sample);
          console.log(JSON.stringify(sample));
          page.off('request', started);
          page.off('requestfailed', failed);
          page.off('pageerror', error);
        }
      } finally { await context.close(); }
    }
  }
} finally { await browser.close(); }
