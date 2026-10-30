import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { Marked } from 'marked';
import { canvasState } from '../src/server/canvas-state.js';
import { serializeCanvasLayout } from '../src/server/canvas-serialization.js';
import { startCanvasServer, stopCanvasServer } from '../src/server/server.js';
import { workbenchToken } from '../src/server/workbench-auth.js';
import { wikiLinksFromData } from '../src/shared/memory-graph.js';

// bun run scripts/benchmark-markdown-load.ts [--browser] [--expect-no-reference-lex]
// --browser requires agent-browser and a built dist/canvas (bun run build).
// A disposable workspace/port is used; no existing board is read or changed.
// HTTP timings exclude fixture creation, assertions and lexer instrumentation.
// Browser runs count real POSTs, not a model of which cards ought to mount.
const root = mkdtempSync(join(tmpdir(), 'pmx-markdown-benchmark-'));
const browser = process.argv.includes('--browser');
const session = `wi01-${process.pid}`;
const warmup = 3;
const repeats = 9;
const bytes = (value: string) => Buffer.byteLength(value);
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const summary = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1), samples };
};

// Deterministic, decodable 400x300 RGB PNG, not invalid bytes posing as an image.
function picture(): Buffer {
  const chunk = (name: string, data: Buffer) => {
    const tagged = Buffer.concat([Buffer.from(name), data]);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(Bun.hash.crc32(tagged));
    return Buffer.concat([size, tagged, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(400, 0);
  header.writeUInt32BE(300, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc(300 * 1201);
  let seed = 19;
  for (let i = 0; i < pixels.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[i] = i % 1201 === 0 ? 0 : seed >>> 24;
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function agent(...args: string[]): Promise<string> {
  const child = Bun.spawn(['agent-browser', '--session', session, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(status, 0, stderr || stdout);
  return stdout;
}

try {
  // An inherited DB override must never redirect this synthetic workload into user data.
  process.env.PMX_CANVAS_DB_PATH = join(root, '.pmx-canvas', 'canvas.db');
  delete process.env.PMX_CANVAS_STATE_FILE;
  const base = startCanvasServer({ workspaceRoot: root, port: 0, autoOpenBrowser: false, allowExternalMcp: false });
  assert.ok(base);
  assert.equal(canvasState.databasePath, process.env.PMX_CANVAS_DB_PATH);
  const target = canvasState.createBoard('Atlas')!;
  const board = canvasState.createBoard('Synthetic field notes')!;
  canvasState.switchBoard(board.id);
  const png = picture();
  const image = `data:image/png;base64,${png.toString('base64')}`;
  const docs = Array.from({ length: 12 }, (_, i) => ({
    id: `note-${i}`,
    markdown: [
      `# Field note ${i}`,
      '[[Atlas|Research]] [[Later]] [[Never]]',
      '## Observations',
      'A synthetic observation with **evidence**, a [source](https://example.com), and a decision.\n'.repeat(48),
      '- [ ] Verify the observation\n- [x] Record the source',
      '| Topic | Result |\n| --- | --- |\n| Example | Measured |',
      '`[[not a link]]`\n\n```md\n[[not a link either]]\n```',
      ...(i < 5 ? [`![Synthetic figure](${image} "Preserved inline PNG")`] : []),
    ].join('\n\n'),
  }));
  for (const [i, doc] of docs.entries()) {
    canvasState.addNode({
      id: doc.id,
      type: 'markdown',
      position: { x: (i % 4) * 650, y: Math.floor(i / 4) * 650 },
      size: { width: 500, height: 450 },
      zIndex: i,
      collapsed: false,
      pinned: false,
      data: { title: `Field note ${i}`, content: doc.markdown },
    });
  }
  canvasState.setViewport({ x: 20, y: 20, scale: 1 });
  canvasState.updateBoard(target.id, { name: 'Archived atlas' });
  canvasState.createBoard('Atlas');
  const later = canvasState.createBoard('Later')!;
  canvasState.flushToDisk();
  const headers = {
    'Content-Type': 'application/json',
    'x-pmx-workbench': '1',
    'x-pmx-workbench-token': workbenchToken,
  };
  async function render(doc: (typeof docs)[number], suffix = ''): Promise<string> {
    const response = await fetch(`${base}/api/render`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ nodeId: doc.id, markdown: doc.markdown + suffix, expectedBoardId: board.id }),
    });
    assert.equal(response.status, 200);
    return ((await response.json()) as { html: string }).html;
  }
  const hashes: string[] = [];
  for (const [i, doc] of docs.entries()) {
    const html = await render(doc);
    assert.ok(html.includes(`data-wiki-board="${target.id}"`), 'Saved identity survives rename/replacement');
    assert.ok(html.includes('data-wiki-ref="Later"'), 'Saved unresolved binding must not resolve on read');
    assert.ok(!html.includes(`data-wiki-board="${later.id}"`));
    if (i < 5) assert.ok(html.includes(`src="${image}"`), 'Inline image bytes must be unchanged');
    hashes.push(sha256(html.replaceAll(target.id, 'TARGET')));
  }
  assert.ok((await render(docs[0], '\nDraft')).includes(`data-wiki-board="${later.id}"`));
  const elapsed: number[] = [];
  for (let round = -warmup; round < repeats; round++) {
    const start = performance.now();
    for (const doc of docs) await render(doc);
    if (round >= 0) elapsed.push(performance.now() - start);
  }

  // Measure only explicit reference-lex passes. Marked.parse's internal rendering
  // does not call this instance method. Instrumentation is outside HTTP timings.
  const originalLexer = Marked.prototype.lexer;
  let lexCalls = 0;
  let lexSourceBytes = 0;
  let lexMs = 0;
  const lexRounds: number[] = [];
  Marked.prototype.lexer = function (source, options) {
    const start = performance.now();
    const result = originalLexer.call(this, source, options);
    lexMs += performance.now() - start;
    lexCalls++;
    lexSourceBytes += bytes(source);
    return result;
  };
  try {
    for (let round = -warmup; round < repeats; round++) {
      lexCalls = 0;
      lexSourceBytes = 0;
      lexMs = 0;
      for (const doc of docs) await render(doc);
      if (round >= 0) lexRounds.push(lexMs);
    }
  } finally {
    Marked.prototype.lexer = originalLexer;
  }
  const stateResponse = await fetch(`${base}/api/canvas/state`);
  const stateBody = await stateResponse.text();
  const serialized = serializeCanvasLayout(canvasState.getLayout());
  const withoutAlias = { ...serialized, nodes: serialized.nodes.map(({ content: _content, ...node }) => node) };
  assert.ok(serialized.nodes.every((node) => node.content === node.data.content));

  // Read the actual SSE wire, first the connect layout, then the edit's layout.
  const stream = await fetch(`${base}/api/workbench/events`, { signal: AbortSignal.timeout(10_000) });
  const reader = stream.body!.getReader();
  let pending = '';
  const decoder = new TextDecoder();
  async function layoutFrame() {
    for (;;) {
      const end = pending.indexOf('\n\n');
      if (end >= 0) {
        const frame = pending.slice(0, end + 2);
        pending = pending.slice(end + 2);
        if (frame.includes('event: canvas-layout-update\n')) {
          const data = frame
            .split('\n')
            .find((line) => line.startsWith('data: '))!
            .slice(6);
          return { frameBytes: bytes(frame), dataBytes: bytes(data), payload: JSON.parse(data) };
        }
      } else {
        const chunk = await reader.read();
        assert.ok(!chunk.done);
        pending += decoder.decode(chunk.value, { stream: true });
      }
    }
  }
  await layoutFrame();
  const savedBindings = wikiLinksFromData(canvasState.getNode(docs[11].id)!.data);
  const edit = await fetch(`${base}/api/canvas/node/${docs[11].id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ content: docs[11].markdown + '!', expectedBoardId: board.id }),
  });
  assert.equal(edit.status, 200);
  await edit.text();
  const frame = await layoutFrame();
  await reader.cancel();
  assert.equal(frame.payload.layout.nodes.length, docs.length);
  assert.equal(
    frame.payload.layout.nodes.find((node: { id: string }) => node.id === docs[11].id).data.content,
    docs[11].markdown + '!',
  );
  // Restore the identical board before browser measurements (outside timing).
  canvasState.updateNode(
    docs[11].id,
    { data: { ...canvasState.getNode(docs[11].id)!.data, content: docs[11].markdown } },
    savedBindings,
  );

  const browserRuns: unknown[] = [];
  if (browser) {
    const init = join(root, 'measure.js');
    writeFileSync(
      init,
      `(() => {
      window.markdownPosts = [];
      const original = window.fetch;
      window.fetch = function(input, options) {
        if (String(input).endsWith('/api/render') && options?.method === 'POST') {
          const body = JSON.parse(options.body);
          window.markdownPosts.push({ nodeId: body.nodeId, sourceBytes: new TextEncoder().encode(body.markdown).length, bodyBytes: new TextEncoder().encode(options.body).length });
        }
        return original.apply(this, arguments);
      };
    })();`,
    );
    await agent('--headed', 'open', '--init-script', init, 'about:blank');
    await agent('set', 'viewport', '1440', '900', '2');
    for (let round = -1; round < 3; round++) {
      await agent('open', `${base}/workbench`);
      await agent(
        'wait',
        '--fn',
        `document.querySelectorAll('.md-card-content .wiki-link').length === 36 && [...document.querySelectorAll('.md-card-content img')].filter(i => i.complete && i.naturalWidth === 400 && i.naturalHeight === 300).length === 5`,
      );
      const raw = await agent(
        'eval',
        '--json',
        `(() => {
        const nodes = [...document.querySelectorAll('.canvas-node[data-node-id]')];
        const offscreen = new Set(nodes.filter(n => { const r = n.getBoundingClientRect(); return r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight; }).map(n => n.dataset.nodeId));
        const posts = window.markdownPosts;
        return { mounted: nodes.length, offscreen: offscreen.size, posts: posts.length, sourceBytes: posts.reduce((n,p) => n+p.sourceBytes,0), bodyBytes: posts.reduce((n,p) => n+p.bodyBytes,0), offscreenPosts: posts.filter(p => offscreen.has(p.nodeId)).length, offscreenSourceBytes: posts.filter(p => offscreen.has(p.nodeId)).reduce((n,p) => n+p.sourceBytes,0), decodedImages: document.querySelectorAll('.md-card-content img').length };
      })()`,
      );
      if (round >= 0) browserRuns.push(JSON.parse(raw).data.result);
    }
  }
  console.log(
    JSON.stringify(
      {
        workload: {
          cards: docs.length,
          inlineImages: 5,
          sourceBytes: docs.reduce((n, doc) => n + bytes(doc.markdown), 0),
          pngBytes: png.length,
          pngSha256: sha256(png),
          warmup,
          repeats,
          bun: Bun.version,
          browserWarmup: browser ? 1 : 0,
          browserRepeats: browser ? 3 : 0,
        },
        correctness: {
          savedIdentity: true,
          savedUnresolved: true,
          draftResolves: true,
          imageBytesPreserved: true,
          normalizedHtmlHashes: hashes,
        },
        serialization: {
          httpStateBytes: bytes(stateBody),
          serializedLayoutBytes: bytes(JSON.stringify(serialized)),
          withoutTopLevelContentBytes: bytes(JSON.stringify(withoutAlias)),
          duplicateAliasBytes: bytes(JSON.stringify(serialized)) - bytes(JSON.stringify(withoutAlias)),
        },
        persistedRender: {
          boardHttpMs: summary(elapsed),
          referenceLexCalls: lexCalls,
          referenceLexSourceBytes: lexSourceBytes,
          referenceLexMsPerBoard: summary(lexRounds),
        },
        editSse: {
          changedSourceBytes: 1,
          layoutEventsObserved: 1,
          nodesInLayout: frame.payload.layout.nodes.length,
          frameBytes: frame.frameBytes,
          payloadBytes: frame.dataBytes,
        },
        browserRuns,
        limits:
          'Local warm-process sequential HTTP; no end-to-end load latency claim. Reference lexer instrumented separately. Serialized alias removal is a byte-only counterfactual, not a contract change. Browser geometry uses viewport intersection; browser run waits for all wiki links and decoded images. SSE reports the first full-layout frame for one edit, not all event traffic.',
      },
      null,
      2,
    ),
  );
  if (process.argv.includes('--expect-no-reference-lex')) assert.equal(lexCalls, 0);
} finally {
  try {
    if (browser) await agent('close');
  } finally {
    stopCanvasServer();
    rmSync(root, { recursive: true, force: true });
  }
}
