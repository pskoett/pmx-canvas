#!/usr/bin/env bun
/**
 * Generator for `src/server/demo-state.json` — the board seeded by `--demo`
 * and `bun run dev:demo`.
 *
 * DO NOT hand-edit `src/server/demo-state.json`. It is generated: every node,
 * edge, context pin and annotation below is created through the REAL HTTP API
 * against a throwaway canvas server in a temp workspace, so node data shapes,
 * generated HTML-primitive surfaces, graph configs and validated json-render
 * specs are correct by construction. The resulting canvas state is exported
 * into the fixture shape `src/server/demo.ts` reads.
 *
 * Re-run after editing the board:
 *
 *   bun run scripts/generate-demo-board.ts
 *
 * Then verify:
 *
 *   bun run typecheck
 *   PMX_CANVAS_DISABLE_BROWSER_OPEN=1 bun test tests/unit/demo.test.ts
 *
 * Design rules this script enforces (and asserts before writing):
 *  - The board must render OFFLINE: no live MCP session, no workspace file path
 *    that has to exist, no network fetch at render time.
 *  - Nodes never overlap, and the single group frame contains its children with
 *    a >= 40px inset on every side.
 *  - Every node is created with `strictSize` so the browser's auto-fit cannot
 *    reflow the deliberate band layout (and silently persist a different board
 *    the first time someone opens it).
 *  - Server ids are time-based, so the export rewrites them to stable `demo-*`
 *    ids — the committed fixture then diffs cleanly between regenerations.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listHtmlPrimitiveDescriptors } from '../src/server/html-primitives.js';

// ── layout constants ──────────────────────────────────────────

/** Gap between related nodes inside a band. */
const GAP = 48;
/** Gap between bands. */
const BAND_GAP = 200;
const LABEL_SIZE = { width: 1240, height: 144 };
/** Gap between a band's label node and its first content row. */
const LABEL_GAP = 56;
/** Frozen stamp for fields the server fills from the wall clock. */
const FIXTURE_TIMESTAMP = '2026-08-01T09:00:00.000Z';
/** Super-column origins. The widest left-column band is ③ at 3032px. */
const LEFT_COLUMN_X = 0;
const RIGHT_COLUMN_X = 3272;
/** ⑥ Grouping shares the right column's top row with ⑤ Structured UI. */
const GROUPING_ROW_OFFSET = 2436;

// ── tiny HTTP client ──────────────────────────────────────────

const PORT = Number(process.env.PMX_DEMO_GEN_PORT ?? 4899);
const BASE = `http://127.0.0.1:${PORT}`;

async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} -> HTTP ${response.status}: ${text.slice(0, 600)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** serverId -> stable demo id, filled in as nodes/edges are created. */
const stableIds = new Map<string, string>();
/** stable demo id -> serverId, so later calls can reference earlier nodes. */
const serverIds = new Map<string, string>();

function serverId(key: string): string {
  const id = serverIds.get(key);
  if (!id) throw new Error(`Unknown demo node key "${key}".`);
  return id;
}

async function create(key: string, path: string, body: Record<string, unknown>): Promise<string> {
  const result = await api<{ id?: string; node?: { id?: string } }>('POST', path, body);
  const id = result.id ?? result.node?.id;
  if (typeof id !== 'string') {
    throw new Error(`No id returned creating "${key}": ${JSON.stringify(result).slice(0, 300)}`);
  }
  stableIds.set(id, key);
  serverIds.set(key, id);
  return id;
}

async function node(key: string, body: Record<string, unknown>): Promise<string> {
  return create(key, '/api/canvas/node', { strictSize: true, ...body });
}

async function patchById(nodeId: string, body: Record<string, unknown>): Promise<void> {
  await api('PATCH', `/api/canvas/node/${nodeId}`, body);
}

async function patch(key: string, body: Record<string, unknown>): Promise<void> {
  await patchById(serverId(key), body);
}

/**
 * The id `withStableIds` will rewrite `liveId` into, given everything registered
 * so far. Server-generated ids that DERIVE from an already-registered id (the
 * `ax.flow.materialize` step nodes and edges are `axflow-<sourceNodeId>-…`) are
 * already stable once that pass runs — this projects the result so the export
 * allowlist can be told about it without a second, conflicting rewrite rule.
 */
function projectStableId(liveId: string): string {
  let out = liveId;
  for (const [server, stable] of stableIds) out = out.replaceAll(server, stable);
  return out;
}

/** Register a server-generated id whose stable form the existing rewrites produce. */
function registerDerivedId(liveId: string): string {
  const stable = projectStableId(liveId);
  if (stable === liveId) throw new Error(`"${liveId}" does not derive from any registered id.`);
  stableIds.set(liveId, stable);
  return stable;
}

async function edge(
  key: string,
  from: string,
  to: string,
  body: { type: string; label?: string; style?: string; animated?: boolean },
): Promise<void> {
  const result = await api<{ id?: string }>('POST', '/api/canvas/edge', {
    from: serverId(from),
    to: serverId(to),
    ...body,
  });
  if (typeof result.id !== 'string') throw new Error(`No id returned creating edge "${key}".`);
  stableIds.set(result.id, key);
}

// ── band cursor ───────────────────────────────────────────────

/**
 * Bands stack downward inside a super-column. A single column would make the
 * board ~1:2.3 and unreadable when fitted, so the board runs two columns:
 * bands ①–④ and ⑧ down the left, ⑤–⑦ down the right.
 */
let bandTop = 0;
let bandLeft = 0;

/** Translate a band-relative x into board coordinates. */
function cx(offset: number): number {
  return bandLeft + offset;
}

function startColumn(left: number): void {
  bandLeft = left;
  bandTop = 0;
}

/** Place a band's section-label node and return the y its content starts at. */
async function bandLabel(key: string, title: string, blurb: string): Promise<number> {
  await node(key, {
    type: 'markdown',
    title,
    content: blurb,
    x: cx(0),
    y: bandTop,
    width: LABEL_SIZE.width,
    height: LABEL_SIZE.height,
  });
  return bandTop + LABEL_SIZE.height + LABEL_GAP;
}

function endBand(contentTop: number, contentHeight: number): void {
  bandTop = contentTop + contentHeight + BAND_GAP;
}

// ── board content ─────────────────────────────────────────────

async function buildBoard(): Promise<void> {
  // A fresh workspace seeds the docked HUD widgets (status-main / context-main).
  // They belong to every canvas, not to the demo board — clearing first means
  // the export is exactly what this script created.
  await api('POST', '/api/canvas/clear', {});
  // Left column: the narrative half — read it top to bottom.
  startColumn(LEFT_COLUMN_X);
  await bandOne();
  await bandFiles();
  await bandDiagrams();
  await bandCharts();
  const belowCharts = bandTop;

  // Right column: ⑤ and ⑥ share the top row, then ⑦ (the big catalogue) below.
  startColumn(RIGHT_COLUMN_X);
  await bandStructuredUi();
  const belowStructuredUi = bandTop;
  startColumn(RIGHT_COLUMN_X + GROUPING_ROW_OFFSET);
  await bandGrouping();
  bandLeft = RIGHT_COLUMN_X;
  bandTop = Math.max(belowStructuredUi, bandTop);
  await bandPrimitives();

  // ⑧ closes the LEFT column (which is ~2000px shorter than the right, so the
  // board's bounding box — and therefore its fit scale — does not change). It
  // runs last because it materializes from the ⑦ ax-flow panel.
  bandLeft = LEFT_COLUMN_X;
  bandTop = belowCharts;
  await bandAgentAtWork();

  await buildEdges();
  await buildPinsAndAnnotations();
}

async function bandOne(): Promise<void> {
  const top = await bandLabel(
    'label-start',
    '① Start here',
    'What the agent is doing, what context it holds, what it decided, and the tool calls behind it.',
  );

  await node('intro', {
    type: 'markdown',
    title: 'PMX Canvas — guided tour',
    content: [
      '# PMX Canvas',
      '',
      'An infinite spatial canvas that agents drive over **MCP**, **HTTP** or the **Bun SDK** — and that humans steer by pinning nodes.',
      '',
      'This board is a live catalogue. Bands ① to ④ and ⑧ run down the left, ⑤ to ⑦ down the right.',
      '',
      '| Band | Shows |',
      '| --- | --- |',
      '| ① Start here | status · context · ledger · trace |',
      '| ② Files & review | file · CSV table · diff · image · webpage |',
      '| ③ Diagrams & surfaces | mermaid · raw HTML · MCP app |',
      '| ④ Charts | all 12 graph types |',
      '| ⑤ Structured UI | json-render specs |',
      '| ⑥ Grouping | one group frame |',
      '| ⑦ HTML primitives | all 21 generated surfaces |',
      '| ⑧ Agent at work | a live AX flow, mid-task |',
      '',
      '> Pin a node in the browser and the agent reads it back from `canvas://pinned-context`. That is the whole collaboration loop.',
    ].join('\n'),
    x: cx(0),
    y: top,
    width: 760,
    height: 550,
  });

  await node('status', {
    type: 'status',
    title: 'Agent',
    x: cx(808),
    y: top,
    width: 380,
    height: 190,
    data: {
      phase: 'tooling',
      detail: 'Rebuilding the release checklist',
      message: '3 of 5 gates green',
      level: 'ok',
      activeTool: 'canvas_render',
      subagent: { state: 'running', name: 'release-auditor' },
    },
  });

  await node('trace-plan', {
    type: 'trace',
    title: 'canvas_query',
    toolName: 'canvas_query · search',
    category: 'mcp',
    status: 'success',
    duration: '38ms',
    resultSummary: '7 nodes matched "release"',
    x: cx(808),
    y: top + 238,
    width: 380,
    height: 96,
  });

  await node('trace-apply', {
    type: 'trace',
    title: 'edit_file',
    toolName: 'edit_file · CHANGELOG.md',
    category: 'file',
    status: 'running',
    duration: '1.2s',
    resultSummary: 'Writing 0.4.7 highlights',
    x: cx(808),
    y: top + 382,
    width: 380,
    height: 96,
  });

  await node('context', {
    type: 'context',
    title: 'Working context',
    x: cx(1236),
    y: top,
    width: 470,
    height: 550,
    data: {
      currentTokens: 48200,
      tokenLimit: 200000,
      utilization: 0.241,
      messagesLength: 34,
      cards: [
        {
          key: 'release-runbook',
          title: 'Release runbook',
          summary: 'Pre-flight gates, tag → publish, smoke checklist.',
          pathDisplay: 'docs/RELEASE.md',
          category: 'planning',
          sourceKind: 'workspace',
          state: 'loaded',
          required: true,
        },
        {
          key: 'node-types',
          title: 'Node type reference',
          summary: 'The 15 public node types and the fields each one accepts.',
          pathDisplay: 'docs/node-types.md',
          category: 'reference',
          sourceKind: 'workspace',
          state: 'loaded',
        },
        {
          key: 'house-style',
          title: 'Changelog house style',
          summary: 'Plain user-facing sentences; no nested bullets.',
          pathDisplay: '~/.config/pmx/style.md',
          category: 'profile',
          sourceKind: 'global',
          state: 'stale',
        },
      ],
    },
  });

  await node('ledger', {
    type: 'ledger',
    title: 'Decision ledger',
    x: cx(1786),
    y: top,
    width: 430,
    height: 550,
    content: [
      '09:12  Ship 0.4.7 behind the existing smoke gate',
      '09:26  Keep demo board offline-only — no live sessions',
      '10:03  strictSize on every demo node so layout is stable',
      '10:41  Drop the OKR board; catalogue every node type instead',
      '11:15  Charts band shows all 12 graph types, Tufte row last',
      '11:48  Pin the intro, the context card and the diff under review',
      '13:20  Bands get section labels; only one group frame survives',
    ].join('\n'),
    data: {
      owner: 'release-auditor',
      cycle: '0.4.7',
      reviewers: 'client · server',
      openQuestions: 2,
    },
  });

  endBand(top, 550);
}

const TS_FILE_CONTENT = [
  "import { canvasState } from './canvas-state.js';",
  "import { nodeMinSize } from '../shared/node-sizes.js';",
  '',
  '/** Clamp an agent-supplied frame up to the per-type readability floor. */',
  'export function clampNodeFrame(type: string, width: number, height: number) {',
  '  const min = nodeMinSize(type);',
  '  if (!min) return { width, height };',
  '  return {',
  '    width: Math.max(width, min.width),',
  '    height: Math.max(height, min.height),',
  '  };',
  '}',
  '',
  'export function nodeCountByType(): Record<string, number> {',
  '  const counts: Record<string, number> = {};',
  '  for (const node of canvasState.getLayout().nodes) {',
  '    counts[node.type] = (counts[node.type] ?? 0) + 1;',
  '  }',
  '  return counts;',
  '}',
].join('\n');

const CSV_FILE_CONTENT = [
  'week,merged_prs,review_hours,p95_ci_minutes,flaky_reruns',
  '2026-W23,41,18.5,11.2,6',
  '2026-W24,38,21.0,12.8,9',
  '2026-W25,52,16.4,10.1,4',
  '2026-W26,47,15.2,9.6,3',
  '2026-W27,55,14.8,9.1,2',
  '2026-W28,61,13.9,8.4,2',
].join('\n');

const DIFF_CONTENT = [
  'diff --git a/src/shared/node-sizes.ts b/src/shared/node-sizes.ts',
  '--- a/src/shared/node-sizes.ts',
  '+++ b/src/shared/node-sizes.ts',
  '@@ -20,6 +20,8 @@ export const NODE_MIN_SIZES: Record<string, { width: number; height: number }> =',
  '   markdown: { width: 360, height: 180 },',
  '   context: { width: 360, height: 180 },',
  '   file: { width: 360, height: 200 },',
  '+  diff: { width: 420, height: 240 },',
  '+  mermaid: { width: 360, height: 240 },',
  '   status: { width: 280, height: 120 },',
  '',
  'diff --git a/src/client/canvas/auto-fit.ts b/src/client/canvas/auto-fit.ts',
  '--- a/src/client/canvas/auto-fit.ts',
  '+++ b/src/client/canvas/auto-fit.ts',
  '@@ -63,7 +63,8 @@ export function computeAutoFitHeight(node: CanvasNodeState, contentHeight: numbe',
  '   const fitted = Math.min(contentHeight + AUTO_FIT_TITLEBAR_HEIGHT, AUTO_FIT_MAX_HEIGHT);',
  '-  return fitted;',
  '+  const min = nodeMinSize(node.type);',
  '+  return min ? Math.max(fitted, min.height) : fitted;',
  ' }',
].join('\n');

const ARCHITECTURE_SVG = [
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 480 300' width='480' height='300'>",
  "<rect width='480' height='300' rx='16' fill='#0f1420'/>",
  "<text x='24' y='40' fill='#e6ecff' font-family='ui-sans-serif,system-ui' font-size='17' font-weight='600'>Canvas data flow</text>",
  "<rect x='24' y='70' width='128' height='62' rx='10' fill='#16203a' stroke='#4a9eff'/>",
  "<text x='88' y='106' fill='#9ec5ff' font-family='ui-sans-serif,system-ui' font-size='13' text-anchor='middle'>Agent (MCP)</text>",
  "<rect x='176' y='70' width='128' height='62' rx='10' fill='#16203a' stroke='#7c5cff'/>",
  "<text x='240' y='100' fill='#c3b4ff' font-family='ui-sans-serif,system-ui' font-size='13' text-anchor='middle'>Canvas state</text>",
  "<text x='240' y='118' fill='#7b86a8' font-family='ui-sans-serif,system-ui' font-size='11' text-anchor='middle'>single source of truth</text>",
  "<rect x='328' y='70' width='128' height='62' rx='10' fill='#16203a' stroke='#22c55e'/>",
  "<text x='392' y='106' fill='#8ee5ad' font-family='ui-sans-serif,system-ui' font-size='13' text-anchor='middle'>Browser</text>",
  "<path d='M152 101 L172 101' stroke='#4a9eff' stroke-width='2'/>",
  "<path d='M304 101 L324 101' stroke='#22c55e' stroke-width='2'/>",
  "<path d='M392 140 L392 196 L88 196 L88 140' fill='none' stroke='#eab308' stroke-width='2' stroke-dasharray='5 5'/>",
  "<text x='240' y='188' fill='#eab308' font-family='ui-sans-serif,system-ui' font-size='12' text-anchor='middle'>human pins nodes -&gt; canvas://pinned-context</text>",
  "<rect x='24' y='222' width='432' height='52' rx='10' fill='#111827' stroke='#243049'/>",
  "<text x='240' y='253' fill='#7b86a8' font-family='ui-monospace,monospace' font-size='12' text-anchor='middle'>state survives refresh · SQLite at .pmx-canvas/canvas.db</text>",
  '</svg>',
].join('');

async function bandFiles(): Promise<void> {
  const top = await bandLabel(
    'label-files',
    '② Files & review',
    'Inline file text, delimited data as a table, unified diffs, images, and cached webpage snapshots.',
  );

  await node('file-ts', {
    type: 'file',
    title: 'node-sizes.ts',
    content: TS_FILE_CONTENT,
    x: cx(0),
    y: top,
    width: 560,
    height: 420,
  });

  await node('diff', {
    type: 'diff',
    title: 'Readability floor — 2 files',
    content: DIFF_CONTENT,
    x: cx(608),
    y: top,
    width: 640,
    height: 420,
  });

  await node('file-csv', {
    type: 'file',
    title: 'weekly-throughput.csv',
    content: CSV_FILE_CONTENT,
    x: cx(1296),
    y: top,
    width: 520,
    height: 420,
  });
  // Delimited-table rendering keys off the file NAME, and the node was created
  // inline (title + multi-line content) so nothing is ever read from disk. The
  // path is a synthetic absolute path: it never exists, so no watcher is
  // registered and the cached `fileContent` is what renders.
  await patch('file-csv', { data: { path: '/workspace/reports/weekly-throughput.csv' } });

  await node('image', {
    type: 'image',
    title: 'Canvas data flow',
    content: `data:image/svg+xml;utf8,${encodeURIComponent(ARCHITECTURE_SVG)}`,
    x: cx(1864),
    y: top,
    width: 420,
    height: 420,
    data: { caption: 'Inline SVG data URI — no asset files, no network.' },
  });

  await node('webpage', {
    type: 'webpage',
    title: 'Model Context Protocol — Resources',
    url: 'https://modelcontextprotocol.io/docs/concepts/resources',
    x: cx(2332),
    y: top,
    width: 480,
    height: 420,
  });
  // Overwrite every field the create-time fetch could have set — including the
  // url, which a redirect rewrites — so the fixture is identical whether or not
  // the generator ran with network access. The node renders entirely from this
  // cached snapshot; the live iframe preview only appears in the expanded
  // overlay, behind an explicit click.
  await patch('webpage', {
    data: {
      url: 'https://modelcontextprotocol.io/docs/concepts/resources',
      pageTitle: 'Resources - Model Context Protocol',
      titleSource: 'user',
      description:
        'Resources let a server expose data an MCP client can read — files, database records, or, in PMX Canvas, the pinned context a human curated on the board.',
      excerpt:
        'Resources are one of the core primitives of the Model Context Protocol. A server advertises resources by URI; clients list them, read them, and subscribe to updates. PMX Canvas exposes canvas://pinned-context, canvas://layout and canvas://spatial-context this way, and emits notifications/resources/updated whenever the board changes.',
      content: '',
      imageUrl: '',
      fetchedAt: FIXTURE_TIMESTAMP,
      status: 'ready',
      statusCode: 200,
      contentType: 'text/html; charset=utf-8',
      frameBlocked: false,
      frameBlockedReason: '',
      error: '',
    },
  });

  endBand(top, 420);
}

const HTML_PANEL = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  :root { color-scheme: dark; }
  body { margin:0; font:14px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif; background:transparent; color:#e6ecff; padding:18px; }
  h1 { margin:0 0 4px; font-size:16px; letter-spacing:-0.01em; }
  p.sub { margin:0 0 16px; font-size:12px; color:#8994b3; }
  ul { list-style:none; margin:0; padding:0; display:grid; gap:8px; }
  li { display:flex; align-items:center; gap:10px; padding:9px 12px; border:1px solid #243049; border-radius:9px; background:#131a2b; }
  .dot { width:8px; height:8px; border-radius:99px; flex:0 0 auto; }
  .ok .dot { background:#22c55e; } .warn .dot { background:#eab308; } .run .dot { background:#4a9eff; }
  .name { flex:1; } .val { font:12px ui-monospace,monospace; color:#8994b3; }
</style></head><body>
  <h1>Release gates — 0.4.7</h1>
  <p class="sub">Raw HTML in a sandboxed iframe. No scripts, no network, no build step.</p>
  <ul>
    <li class="ok"><span class="dot"></span><span class="name">typecheck</span><span class="val">passing</span></li>
    <li class="ok"><span class="dot"></span><span class="name">unit tests</span><span class="val">612 passed</span></li>
    <li class="run"><span class="dot"></span><span class="name">web-canvas e2e</span><span class="val">running</span></li>
    <li class="warn"><span class="dot"></span><span class="name">bundle size</span><span class="val">+4.1% vs 0.4.6</span></li>
    <li class="ok"><span class="dot"></span><span class="name">pack dry-run</span><span class="val">clean</span></li>
  </ul>
</body></html>`;

const MCP_APP_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  :root { color-scheme: dark; }
  body { margin:0; font:14px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif; background:#0d1220; color:#e6ecff; }
  header { padding:14px 18px; border-bottom:1px solid #1e2740; display:flex; align-items:center; gap:10px; }
  .badge { font:11px ui-monospace,monospace; color:#9ec5ff; background:#16203a; border:1px solid #2b3a5e; padding:2px 7px; border-radius:6px; }
  h1 { margin:0; font-size:14px; font-weight:600; }
  main { padding:18px; display:grid; gap:14px; }
  .row { display:grid; grid-template-columns:1fr auto; align-items:center; gap:12px; padding:11px 13px; border:1px solid #243049; border-radius:10px; background:#131a2b; }
  .row b { font-weight:600; font-size:13px; } .row small { display:block; color:#8994b3; font-size:11.5px; }
  .pill { font:11px ui-monospace,monospace; padding:3px 9px; border-radius:99px; background:#16203a; color:#9ec5ff; border:1px solid #2b3a5e; }
  footer { padding:12px 18px; border-top:1px solid #1e2740; color:#6f7a99; font-size:11.5px; }
</style></head><body>
  <header><span class="badge">ext-app</span><h1>Board inspector</h1></header>
  <main>
    <div class="row"><span><b>Nodes on board</b><small>across 8 spatial bands</small></span><span class="pill">69</span></div>
    <div class="row"><span><b>Edges</b><small>flow · depends-on · relation · references</small></span><span class="pill">6</span></div>
    <div class="row"><span><b>Context pins</b><small>read via canvas://pinned-context</small></span><span class="pill">3</span></div>
    <div class="row"><span><b>Groups</b><small>one example frame</small></span><span class="pill">1</span></div>
  </main>
  <footer>An MCP App surface rendered through the app bridge from inline HTML — no live server session required.</footer>
</body></html>`;

async function bandDiagrams(): Promise<void> {
  const top = await bandLabel(
    'label-diagrams',
    '③ Diagrams & surfaces',
    'Mermaid renders from plain text; HTML and MCP App nodes are sandboxed iframes the agent authors.',
  );

  await node('mermaid-flow', {
    type: 'mermaid',
    title: 'Flowchart — request path',
    content: [
      'flowchart LR',
      '  A[Agent] -->|MCP tool call| B(Canvas server)',
      '  B --> C{{SSE stream}}',
      '  C --> D[Browser canvas]',
      '  D -->|human pins a node| B',
      '  B --> E[(canvas.db)]',
    ].join('\n'),
    x: cx(0),
    y: top,
    width: 560,
    height: 500,
  });

  await node('mermaid-sequence', {
    type: 'mermaid',
    title: 'Sequence — the pin loop',
    content: [
      'sequenceDiagram',
      '  participant H as Human',
      '  participant C as Canvas',
      '  participant A as Agent',
      '  H->>C: pin 3 nodes',
      '  C-->>A: resources/updated',
      '  A->>C: read canvas://pinned-context',
      '  A->>C: canvas_node add (summary)',
      '  C-->>H: SSE layout update',
    ].join('\n'),
    x: cx(608),
    y: top,
    width: 560,
    height: 500,
  });

  await node('mermaid-state', {
    type: 'mermaid',
    title: 'State — approval gate',
    content: [
      'stateDiagram-v2',
      '  [*] --> pending',
      '  pending --> approved: human approves',
      '  pending --> rejected: human rejects',
      '  pending --> expired: timeout',
      '  approved --> [*]',
      '  rejected --> [*]',
      '  expired --> [*]',
    ].join('\n'),
    x: cx(1216),
    y: top,
    width: 520,
    height: 500,
  });

  await node('html-panel', {
    type: 'html',
    title: 'Release gates',
    html: HTML_PANEL,
    summary: 'Five release gates with pass/running/warning status for 0.4.7.',
    x: cx(1784),
    y: top,
    width: 560,
    height: 500,
  });

  await node('mcp-app', {
    type: 'mcp-app',
    title: 'Board inspector',
    x: cx(2392),
    y: top,
    width: 640,
    height: 500,
    data: {
      mode: 'ext-app',
      html: MCP_APP_HTML,
      serverName: 'pmx-demo',
      toolName: 'inspect_board',
    },
  });

  endBand(top, 500);
}

// ── charts ────────────────────────────────────────────────────

interface ChartSpec {
  key: string;
  graphType: string;
  title: string;
  data: Array<Record<string, unknown>>;
  keys: Record<string, unknown>;
}

const CANONICAL_CHARTS: ChartSpec[] = [
  {
    key: 'graph-line',
    graphType: 'line',
    title: 'line — p95 latency',
    data: [
      { week: 'W23', ms: 142 },
      { week: 'W24', ms: 151 },
      { week: 'W25', ms: 128 },
      { week: 'W26', ms: 119 },
      { week: 'W27', ms: 112 },
      { week: 'W28', ms: 104 },
    ],
    keys: { xKey: 'week', yKey: 'ms' },
  },
  {
    key: 'graph-bar',
    graphType: 'bar',
    title: 'bar — merged PRs per week',
    data: [
      { week: 'W23', prs: 41 },
      { week: 'W24', prs: 38 },
      { week: 'W25', prs: 52 },
      { week: 'W26', prs: 47 },
      { week: 'W27', prs: 55 },
      { week: 'W28', prs: 61 },
    ],
    keys: { xKey: 'week', yKey: 'prs', colorBy: 'series', highlight: 'max' },
  },
  {
    key: 'graph-area',
    graphType: 'area',
    title: 'area — canvas nodes created',
    data: [
      { day: 'Mon', nodes: 18 },
      { day: 'Tue', nodes: 34 },
      { day: 'Wed', nodes: 29 },
      { day: 'Thu', nodes: 46 },
      { day: 'Fri', nodes: 58 },
    ],
    keys: { xKey: 'day', yKey: 'nodes' },
  },
  {
    key: 'graph-pie',
    graphType: 'pie',
    title: 'pie — node types on real boards',
    data: [
      { type: 'markdown', count: 41 },
      { type: 'graph', count: 18 },
      { type: 'file', count: 15 },
      { type: 'html', count: 14 },
    ],
    keys: { nameKey: 'type', valueKey: 'count' },
  },
  {
    key: 'graph-stacked-bar',
    graphType: 'stacked-bar',
    title: 'stacked-bar — CI minutes by stage',
    data: [
      { week: 'W25', build: 4.1, test: 5.2, e2e: 3.4 },
      { week: 'W26', build: 3.8, test: 4.9, e2e: 3.1 },
      { week: 'W27', build: 3.5, test: 4.4, e2e: 2.8 },
      { week: 'W28', build: 3.2, test: 4.1, e2e: 2.4 },
    ],
    keys: { xKey: 'week', series: ['build', 'test', 'e2e'] },
  },
  {
    key: 'graph-composed',
    graphType: 'composed',
    title: 'composed — throughput vs review load',
    data: [
      { week: 'W25', prs: 52, hours: 16.4 },
      { week: 'W26', prs: 47, hours: 15.2 },
      { week: 'W27', prs: 55, hours: 14.8 },
      { week: 'W28', prs: 61, hours: 13.9 },
    ],
    keys: { xKey: 'week', barKey: 'prs', lineKey: 'hours' },
  },
  {
    key: 'graph-scatter',
    graphType: 'scatter',
    title: 'scatter — PR size vs review time',
    data: [
      { changed: 42, hours: 1.1, files: 3 },
      { changed: 180, hours: 2.6, files: 9 },
      { changed: 310, hours: 4.2, files: 14 },
      { changed: 95, hours: 1.8, files: 5 },
      { changed: 620, hours: 7.9, files: 26 },
      { changed: 240, hours: 3.1, files: 11 },
    ],
    keys: { xKey: 'changed', yKey: 'hours', zKey: 'files' },
  },
  {
    key: 'graph-radar',
    graphType: 'radar',
    title: 'radar — surface coverage',
    data: [
      { surface: 'MCP', v047: 92, v046: 78 },
      { surface: 'HTTP', v047: 88, v046: 84 },
      { surface: 'CLI', v047: 74, v046: 61 },
      { surface: 'SDK', v047: 81, v046: 70 },
      { surface: 'Client', v047: 66, v046: 58 },
    ],
    keys: { axisKey: 'surface', metrics: ['v047', 'v046'] },
  },
];

const TUFTE_CHARTS: ChartSpec[] = [
  {
    key: 'graph-sparkline',
    graphType: 'sparkline',
    title: 'sparkline — build time',
    data: [
      { run: 1, sec: 96 },
      { run: 2, sec: 104 },
      { run: 3, sec: 89 },
      { run: 4, sec: 112 },
      { run: 5, sec: 84 },
      { run: 6, sec: 78 },
      { run: 7, sec: 81 },
      { run: 8, sec: 72 },
    ],
    keys: { valueKey: 'sec', fill: true, showEndDot: true, showMinMax: true, showValue: true },
  },
  {
    key: 'graph-dot-plot',
    graphType: 'dot-plot',
    title: 'dot-plot — test time by suite',
    data: [
      { suite: 'unit', seconds: 31 },
      { suite: 'client', seconds: 12 },
      { suite: 'web-canvas', seconds: 88 },
      { suite: 'cli-e2e', seconds: 46 },
    ],
    keys: { labelKey: 'suite', valueKey: 'seconds', sort: 'desc' },
  },
  {
    key: 'graph-bullet',
    graphType: 'bullet',
    title: 'bullet — release KPIs vs target',
    data: [
      { label: 'Coverage %', value: 62, target: 70, ranges: [50, 65, 80] },
      { label: 'Docs pages', value: 24, target: 20, ranges: [10, 18, 26] },
      { label: 'Open bugs', value: 7, target: 5, ranges: [4, 8, 14] },
    ],
    keys: { labelKey: 'label', valueKey: 'value', targetKey: 'target', rangesKey: 'ranges' },
  },
  {
    key: 'graph-slopegraph',
    graphType: 'slopegraph',
    title: 'slopegraph — coverage 0.4.6 → 0.4.7',
    data: [
      { module: 'server', before: 64, after: 71 },
      { module: 'client', before: 52, after: 58 },
      { module: 'mcp', before: 70, after: 68 },
      { module: 'cli', before: 45, after: 59 },
    ],
    keys: {
      labelKey: 'module',
      beforeKey: 'before',
      afterKey: 'after',
      beforeLabel: '0.4.6',
      afterLabel: '0.4.7',
      colorByDirection: true,
    },
  },
];

async function bandCharts(): Promise<void> {
  const top = await bandLabel(
    'label-charts',
    '④ Charts',
    'Every canonical graph type, then the Tufte primitives in the compact bottom row.',
  );

  const cellWidth = 520;
  const colStep = cellWidth + GAP;
  const tallRow = 460;
  const shortRow = 380;
  const rowGap = 60;

  for (const [index, chart] of CANONICAL_CHARTS.entries()) {
    const column = index % 4;
    const row = Math.floor(index / 4);
    await create(chart.key, '/api/canvas/graph', {
      title: chart.title,
      graphType: chart.graphType,
      data: chart.data,
      ...chart.keys,
      x: cx(column * colStep),
      y: top + row * (tallRow + rowGap),
      width: cellWidth,
      nodeHeight: tallRow,
      // Chart CONTENT height, distinct from the node frame: sized so the plot
      // plus its title fits without an inner scrollbar inside the fixed frame.
      height: 245,
      strictSize: true,
    });
  }

  const tufteTop = top + 2 * (tallRow + rowGap);
  for (const [index, chart] of TUFTE_CHARTS.entries()) {
    await create(chart.key, '/api/canvas/graph', {
      title: chart.title,
      graphType: chart.graphType,
      data: chart.data,
      ...chart.keys,
      x: cx(index * colStep),
      y: tufteTop,
      width: cellWidth,
      nodeHeight: shortRow,
      height: 160,
      strictSize: true,
    });
  }

  endBand(top, 2 * (tallRow + rowGap) + shortRow);
}

// ── structured UI ─────────────────────────────────────────────

const DASHBOARD_SPEC = {
  root: 'page',
  elements: {
    page: { type: 'Stack', props: { direction: 'vertical', gap: 'md' }, children: ['head', 'kpis', 'table'] },
    head: { type: 'Heading', props: { level: 'h3', text: 'Release 0.4.7 — readiness' }, children: [] },
    kpis: { type: 'Grid', props: { columns: 3, gap: 'md' }, children: ['kpi-gates', 'kpi-bugs', 'kpi-cov'] },
    'kpi-gates': {
      type: 'Card',
      props: { title: 'Gates', description: '4 of 5 green' },
      children: ['kpi-gates-bar', 'kpi-gates-badge'],
    },
    'kpi-gates-bar': { type: 'Progress', props: { value: 80, max: 100, label: 'Gate progress' }, children: [] },
    'kpi-gates-badge': { type: 'Badge', props: { text: 'e2e running', variant: 'info' }, children: [] },
    'kpi-bugs': { type: 'Card', props: { title: 'Open bugs', description: '7 open · 2 blocking' }, children: ['kpi-bugs-badge'] },
    'kpi-bugs-badge': { type: 'Badge', props: { text: 'above target', variant: 'warning' }, children: [] },
    'kpi-cov': { type: 'Card', props: { title: 'Coverage', description: '71% lines · floor 60%' }, children: ['kpi-cov-badge'] },
    'kpi-cov-badge': { type: 'Badge', props: { text: 'passing', variant: 'success' }, children: [] },
    table: {
      type: 'Table',
      props: {
        caption: 'Gate detail',
        columns: ['Gate', 'Owner', 'Duration', 'Result'],
        rows: [
          ['typecheck', 'ci', '18s', 'pass'],
          ['unit', 'ci', '31s', 'pass'],
          ['client', 'ci', '12s', 'pass'],
          ['web-canvas e2e', 'ci', '88s', 'running'],
          ['pack dry-run', 'release', '4s', 'pass'],
        ],
      },
      children: [],
    },
  },
};

const FORM_SPEC = {
  root: 'form',
  elements: {
    form: {
      type: 'Card',
      props: { title: 'File a release blocker', description: 'Routed to the on-call maintainer.' },
      children: ['fields'],
    },
    fields: {
      type: 'Stack',
      props: { direction: 'vertical', gap: 'md' },
      children: ['summary', 'area', 'severity', 'detail', 'regression', 'divider', 'actions'],
    },
    summary: {
      type: 'Input',
      props: { label: 'Summary', name: 'summary', type: 'text', placeholder: 'One line, user-facing' },
      children: [],
    },
    area: { type: 'Select', props: { label: 'Area', name: 'area', options: ['server', 'client', 'mcp', 'cli', 'docs'] }, children: [] },
    severity: { type: 'Radio', props: { label: 'Severity', name: 'severity', options: ['blocker', 'major', 'minor'], value: 'major' }, children: [] },
    detail: {
      type: 'Textarea',
      props: { label: 'Reproduction', name: 'detail', rows: 4, placeholder: 'Steps, expected, actual' },
      children: [],
    },
    regression: { type: 'Checkbox', props: { label: 'Regression since 0.4.6', name: 'regression', checked: true }, children: [] },
    divider: { type: 'Separator', props: { orientation: 'horizontal' }, children: [] },
    actions: { type: 'Stack', props: { direction: 'horizontal', gap: 'sm' }, children: ['submit', 'cancel'] },
    submit: { type: 'Button', props: { label: 'File blocker', variant: 'primary' }, children: [] },
    cancel: { type: 'Button', props: { label: 'Discard', variant: 'outline' }, children: [] },
  },
};

const CHART_SPEC = {
  root: 'panel',
  elements: {
    panel: { type: 'Stack', props: { direction: 'vertical', gap: 'md' }, children: ['title', 'note', 'bars', 'spark', 'alert'] },
    title: { type: 'Heading', props: { level: 'h3', text: 'Canvas usage this cycle' }, children: [] },
    note: {
      type: 'Text',
      props: { text: 'Charts are catalogue components, so a single spec can mix prose, metrics and plots.', variant: 'muted' },
      children: [],
    },
    bars: {
      type: 'BarChart',
      props: {
        title: 'Nodes created by type',
        data: [
          { type: 'markdown', n: 128 },
          { type: 'graph', n: 74 },
          { type: 'html', n: 61 },
          { type: 'file', n: 52 },
          { type: 'mermaid', n: 33 },
        ],
        xKey: 'type',
        yKey: 'n',
        height: 190,
        colorBy: 'series',
        highlight: 'max',
      },
      children: [],
    },
    spark: {
      type: 'Sparkline',
      props: {
        title: 'Daily active boards',
        data: [{ d: 1, v: 12 }, { d: 2, v: 15 }, { d: 3, v: 14 }, { d: 4, v: 19 }, { d: 5, v: 23 }, { d: 6, v: 27 }],
        valueKey: 'v',
        fill: true,
        showEndDot: true,
        showValue: true,
        height: 70,
      },
      children: [],
    },
    alert: {
      type: 'Alert',
      props: { title: 'Specs are validated', message: 'Every spec passes normalizeAndValidateJsonRenderSpec before it is stored.', type: 'info' },
      children: [],
    },
  },
};

async function bandStructuredUi(): Promise<void> {
  const top = await bandLabel(
    'label-json-render',
    '⑤ Structured UI',
    'json-render nodes: an agent posts a validated component spec and the canvas renders real UI.',
  );

  await create('json-dashboard', '/api/canvas/json-render', {
    title: 'Release dashboard',
    spec: DASHBOARD_SPEC,
    x: cx(0),
    y: top,
    width: 840,
    height: 720,
    strictSize: true,
  });

  await create('json-form', '/api/canvas/json-render', {
    title: 'Blocker intake form',
    spec: FORM_SPEC,
    x: cx(888),
    y: top,
    width: 560,
    height: 720,
    strictSize: true,
  });

  await create('json-charts', '/api/canvas/json-render', {
    title: 'Usage panel',
    spec: CHART_SPEC,
    x: cx(1496),
    y: top,
    width: 700,
    height: 720,
    strictSize: true,
  });

  endBand(top, 720);
}

// ── html primitives ───────────────────────────────────────────

/** Realistic data for every kind in HTML_PRIMITIVE_KINDS, keyed by kind. */
const PRIMITIVE_DATA: Record<string, { title: string; data: Record<string, unknown> }> = {
  'choice-grid': {
    title: 'How should the demo board be generated?',
    data: {
      items: [
        {
          title: 'Hand-written fixture',
          summary: 'Edit demo-state.json directly.',
          tradeoff: 'Fastest to start, impossible to keep correct.',
          pros: ['No tooling', 'Full control of every byte'],
          cons: ['Data shapes drift from the server', 'Generated HTML surfaces cannot be authored by hand'],
          code: '// 1100 lines of JSON nobody dares touch',
        },
        {
          title: 'Generate through the HTTP API',
          summary: 'A committed script replays the real create path.',
          tradeoff: 'Needs a throwaway server during generation.',
          pros: ['Shapes correct by construction', 'Regenerates after schema changes', 'Asserts its own invariants'],
          cons: ['One more script to maintain'],
          code: 'await api("POST", "/api/canvas/node", { type: "mermaid", ... })',
        },
        {
          title: 'Snapshot a live board',
          summary: 'Curate by hand in the browser, then export.',
          tradeoff: 'Pleasant to author, unreproducible.',
          pros: ['Visual authoring', 'No layout maths'],
          cons: ['Not reviewable in a diff', 'Cannot be regenerated'],
        },
      ],
    },
  },
  'plan-timeline': {
    title: 'Demo board rebuild',
    data: {
      milestones: [
        { title: 'Inventory the surfaces', detail: 'Every node type, graph type and primitive kind.', status: 'done' },
        { title: 'Write the generator', detail: 'Create everything through the real HTTP API.', status: 'done' },
        { title: 'Lay out the bands', detail: 'Spatial bands with section labels, generous gutters.', status: 'active' },
        { title: 'Rewrite the fixture test', detail: 'Keep the structural invariants, add coverage assertions.', status: 'todo' },
        { title: 'Visual pass', detail: 'Screenshot each band and fix anything blank or clipped.', status: 'todo' },
      ],
      flow: [
        { from: 'generator', to: 'temp server', label: 'HTTP create' },
        { from: 'temp server', to: 'demo-state.json', label: 'export + stable ids' },
        { from: 'demo-state.json', to: 'seedDemoCanvas', label: '--demo' },
      ],
      risks: [
        { risk: 'Browser auto-fit reflows the board on first open', mitigation: 'Create every node with strictSize.' },
        { risk: 'Fixture depends on files or network at render time', mitigation: 'Inline file text, data-URI image, cached webpage snapshot.' },
        { risk: 'Server ids churn on every regeneration', mitigation: 'Rewrite ids to stable demo-* keys during export.' },
      ],
      snippets: [
        { label: 'Regenerate', code: 'bun run scripts/generate-demo-board.ts' },
        { label: 'Verify', code: 'bun test tests/unit/demo.test.ts' },
      ],
    },
  },
  'review-sheet': {
    title: 'Review — auto-fit floor',
    data: {
      findings: [
        {
          severity: 'warning',
          title: 'Auto-fit undid the creation clamp',
          file: 'src/client/canvas/auto-fit.ts',
          line: 63,
          detail: 'The server clamped 200x100 up to 360x180, then the DOM measure persisted 360x132.',
        },
        {
          severity: 'info',
          title: 'Floor now lives in shared/',
          file: 'src/shared/node-sizes.ts',
          line: 20,
          detail: 'Both sides import the same table — a floor only one side knows about is not a floor.',
        },
        {
          severity: 'ok',
          title: 'strictSize is still the escape hatch',
          file: 'src/shared/node-sizes.ts',
          line: 48,
          detail: 'Deliberately small fixed frames opt out of both the clamp and the auto-fit floor.',
        },
      ],
      files: [
        { path: 'src/shared/node-sizes.ts', why: 'Owns the per-type readability floor.' },
        { path: 'src/client/canvas/auto-fit.ts', why: 'Applies the floor to the measured height.' },
      ],
      diff: '-  return fitted;\n+  const min = nodeMinSize(node.type);\n+  return min ? Math.max(fitted, min.height) : fitted;',
    },
  },
  'pr-writeup': {
    title: 'PR — replace the demo board',
    data: {
      summary: 'Replaces the OKR demo board with a generated catalogue of every public canvas surface.',
      why: 'The old board used three node types and was dominated by group frames, so it showed almost nothing the product does.',
      before: ['19 nodes', '3 node types', '3 large group frames', 'hand-edited JSON'],
      after: ['69 nodes across 8 labelled bands', 'all 15 public node types', 'all 12 graph types and all 21 HTML primitives', 'generated by a committed script'],
      files: [
        { path: 'scripts/generate-demo-board.ts', why: 'The generator, and the only place the board is authored.', focus: 'Band layout and offline-safety rules.' },
        { path: 'src/server/demo-state.json', why: 'Generated output — never hand-edited.', focus: 'Stable demo-* ids.' },
        { path: 'tests/unit/demo.test.ts', why: 'Structural invariants plus coverage assertions.', focus: 'Type/graph/primitive coverage checks.' },
      ],
      reviewFocus: ['No node overlaps', 'Group containment inset', 'Nothing that needs disk or network at render time'],
      tests: ['bun test tests/unit/demo.test.ts', 'bun run typecheck', 'Visual pass over each band at overview zoom'],
      rollout: ['No migration — the fixture is replaced wholesale', '--demo still refuses to clobber a non-empty canvas'],
    },
  },
  'system-map': {
    title: 'Canvas server map',
    data: {
      modules: [
        { id: 'mcp', title: 'MCP server', detail: 'stdio transport, 22 tools and 14 resources.', role: 'entry' },
        { id: 'http', title: 'HTTP API', detail: 'REST + SSE on Bun.serve.', role: 'entry' },
        { id: 'ops', title: 'Operation registry', detail: 'One definition drives HTTP, MCP and the SDK.', role: 'core' },
        { id: 'state', title: 'CanvasStateManager', detail: 'Singleton source of truth; every mutation goes through it.', role: 'core' },
        { id: 'db', title: 'SQLite', detail: '.pmx-canvas/canvas.db — nodes, pins, snapshots, blobs.', role: 'store' },
        { id: 'client', title: 'Preact client', detail: 'Renders layout; state survives refresh.', role: 'view' },
      ],
      edges: [
        { from: 'mcp', to: 'ops', label: 'tool call' },
        { from: 'http', to: 'ops', label: 'route' },
        { from: 'ops', to: 'state', label: 'mutate' },
        { from: 'state', to: 'db', label: 'debounced save' },
        { from: 'state', to: 'client', label: 'SSE' },
      ],
      entryPoints: ['src/mcp/server.ts', 'src/server/server.ts', 'src/cli/index.ts'],
    },
  },
  'code-walkthrough': {
    title: 'Walkthrough — creating a node',
    data: {
      summary: 'One POST becomes a validated, clamped, persisted node and an SSE frame, through a single shared operation.',
      modules: [
        { id: 'route', title: 'Bun.serve fetch', detail: 'Matches the operation path.', role: 'entry' },
        { id: 'op', title: 'node.add', detail: 'Zod-validates the body, resolves geometry.', role: 'core' },
        { id: 'build', title: 'createBasicCanvasNode', detail: 'Per-type data builders and the size clamp.', role: 'core' },
        { id: 'state', title: 'canvasState.addNode', detail: 'Stores, schedules a save, records undo.', role: 'store' },
      ],
      edges: [
        { from: 'route', to: 'op', label: 'dispatch' },
        { from: 'op', to: 'build', label: 'normalize' },
        { from: 'build', to: 'state', label: 'add' },
      ],
      steps: [
        { title: 'Resolve the type', file: 'src/server/operations/ops/nodes.ts', detail: 'A missing or unknown type is a 400, never a silent markdown node.', code: "if (!NODE_TYPE_SET.has(type)) throw new OperationError(...)" },
        { title: 'Build per-type data', file: 'src/server/canvas-operations.ts', detail: 'file / image / webpage / trace each get a dedicated builder.', code: 'if (input.type === "file") return buildFileNodeData(input);' },
        { title: 'Clamp the frame', file: 'src/shared/node-sizes.ts', detail: 'An undersized explicit size is raised to the readability floor.', code: 'clampCreateNodeSize(type, width, height, strictSize)' },
        { title: 'Store and broadcast', file: 'src/server/canvas-state.ts', detail: 'addNode persists and notifies; the browser is only a renderer.' },
      ],
      keyFiles: [
        { path: 'src/server/operations/ops/nodes.ts', description: 'node.add / update / remove and the shared node payloads.' },
        { path: 'src/server/canvas-state.ts', description: 'The singleton store, undo ring buffer and persistence.' },
      ],
      gotchas: [
        'A new node type must also be added to isCanvasNodeType in the SSE bridge, or it renders as nothing.',
        'Rebuild the client bundle after touching src/client — the dist bundle is not auto-built.',
      ],
    },
  },
  'design-sheet': {
    title: 'Board typography directions',
    data: {
      directions: [
        {
          title: 'Instrument',
          tone: 'dense, technical, high contrast',
          palette: ['#0d1220', '#131a2b', '#4a9eff', '#e6ecff'],
          rationale: 'Reads like a console. Good for status, trace and ledger nodes where density beats warmth.',
        },
        {
          title: 'Editorial',
          tone: 'calm, generous leading',
          palette: ['#f8f1e7', '#16120f', '#d65a31', '#6b5f55'],
          rationale: 'Better for long markdown and explainers; loses signal on dashboards.',
        },
        {
          title: 'Blueprint',
          tone: 'cool, structural, muted',
          palette: ['#101826', '#1b2740', '#7c5cff', '#8ee5ad'],
          rationale: 'Diagram-first. Chart ink stays readable against the panel at low zoom.',
        },
      ],
      tokens: [
        { name: '--c-bg', value: '#0d1220' },
        { name: '--c-panel', value: '#131a2b' },
        { name: '--c-line', value: '#243049' },
        { name: '--c-accent', value: '#4a9eff' },
        { name: '--c-ok', value: '#22c55e' },
        { name: '--c-warn', value: '#eab308' },
      ],
    },
  },
  'component-gallery': {
    title: 'Node titlebar states',
    data: {
      component: 'Node titlebar',
      variants: [
        { label: 'Default', state: 'rest', intent: 'idle node', example: 'markdown · Release notes', note: 'Type chip, title, collapse and expand affordances.' },
        { label: 'Pinned', state: 'context-pinned', intent: 'included in agent context', example: '📌 markdown · Release notes', note: 'Accent ring; appears in canvas://pinned-context.' },
        { label: 'Search match', state: 'match', intent: 'result of canvas_query search', example: 'file · node-sizes.ts', note: 'Non-matches dim rather than hide.' },
        { label: 'Running trace', state: 'running', intent: 'tool call in flight', example: 'trace · edit_file', note: 'Pulsing status dot, no layout shift on completion.' },
        { label: 'Attention', state: 'focus', intent: 'agent asked for the human’s eyes', example: 'diff · Readability floor', note: 'Pulse decays; never steals the viewport.' },
      ],
    },
  },
  'interaction-prototype': {
    title: 'Node expand transition',
    data: {
      scenario: 'Tune the expand-to-overlay transition before wiring it into CanvasNode.',
      controls: [
        { key: 'duration', label: 'Duration', value: 240, min: 80, max: 700, unit: 'ms' },
        { key: 'overshoot', label: 'Overshoot', value: 6, min: 0, max: 24, unit: '%' },
        { key: 'dim', label: 'Backdrop dim', value: 62, min: 0, max: 100, unit: '%' },
      ],
      screens: [
        { title: 'Rest', detail: 'Node sits in the band at canvas scale.' },
        { title: 'Lift', detail: 'Node scales toward the overlay frame; siblings dim.' },
        { title: 'Overlay', detail: 'Full-size surface with the same renderer, expanded props.' },
      ],
      annotations: [
        { title: 'Same renderer', detail: 'The overlay must not fork the node component, or surfaces drift.' },
        { title: 'No viewport jump', detail: 'Expanding never moves the underlying canvas.' },
      ],
      questions: ['Does overshoot help or just feel noisy at 0.4 zoom?', 'Should the backdrop dim scale with node count?'],
      snippet: 'transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1);',
    },
  },
  flowchart: {
    title: 'Release pipeline',
    data: {
      steps: [
        { title: 'Pre-flight', detail: 'typecheck, lint, unit and client suites.', status: 'ok', duration: '61s' },
        { title: 'Build', detail: 'Client bundle, json-render bundle, types.', status: 'ok', duration: '44s' },
        { title: 'Version bump', detail: 'package.json and CHANGELOG entry.', status: 'ok', duration: '8s' },
        { title: 'Tag and publish', detail: 'npm publish from the tagged commit.', status: 'active', duration: '—' },
        { title: 'Smoke', detail: 'Install the published tarball in a clean temp consumer.', status: 'todo', duration: '—' },
      ],
      failurePaths: [
        { from: 'Smoke', label: 'missing file in package', detail: 'Add it to the files array and publish a patch.' },
        { from: 'Tag and publish', label: 'registry 403', detail: 'Re-auth, then republish the same tag.' },
      ],
    },
  },
  deck: {
    title: 'Why a spatial canvas',
    data: {
      slides: [
        {
          title: 'Chat is a queue, work is a graph',
          kicker: '01',
          bullets: ['A transcript only remembers order', 'Real work has neighbours, not turns', 'Space is free context'],
          note: 'Open on the problem, not the product.',
        },
        {
          title: 'The canvas is the agent’s working memory',
          kicker: '02',
          bullets: ['Nodes persist across sessions', 'Position carries meaning', 'The agent can read its own board back'],
        },
        {
          title: 'Pinning is the steering wheel',
          kicker: '03',
          bullets: ['Human pins what matters', 'Agent reads canvas://pinned-context', 'No prompt engineering required'],
          note: 'Demo the pin loop live if there is time.',
        },
      ],
    },
  },
  presentation: {
    title: 'PMX Canvas 0.4.7 briefing',
    data: {
      subtitle: 'What shipped, what it costs, and what we do next.',
      theme: 'midnight',
      slides: [
        {
          title: 'Where we are',
          kicker: '01',
          body: 'The canvas is the shared surface between the agent and the human.',
          bullets: ['15 node types', '22 MCP tools', '14 MCP resources'],
          metrics: [
            { label: 'Node types', value: '15', detail: 'all catalogued on the demo board' },
            { label: 'Graph types', value: '12', detail: 'canonical plus Tufte primitives' },
            { label: 'HTML primitives', value: '21', detail: 'generated, self-contained surfaces' },
          ],
          note: 'Lead with the surface count — it is the clearest proxy for reach.',
        },
        {
          title: 'What changed in 0.4.7',
          kicker: '02',
          bullets: [
            'The demo board is now a generated catalogue',
            'Readability floors are shared by server and client',
            'Delimited files render as tables',
          ],
          note: 'Keep this slide to three lines; detail lives in the changelog.',
        },
        {
          title: 'Next',
          kicker: '03',
          body: 'Make the board the first thing a new user sees, not the last.',
          bullets: ['Ship --demo in the quickstart', 'Record a 60-second tour', 'Add a per-band deep link'],
        },
      ],
    },
  },
  'illustration-set': {
    title: 'Figures — the collaboration loop',
    data: {
      figures: [
        {
          title: 'The pin loop',
          caption: 'The human curates space; the agent reads that curation as context.',
          shapes: [
            { type: 'rect', x: 40, y: 60, width: 150, height: 70, text: 'Human', color: '#22c55e' },
            { type: 'arrow', x1: 196, y1: 95, x2: 300, y2: 95, color: '#eab308' },
            { type: 'rect', x: 306, y: 60, width: 150, height: 70, text: 'Canvas', color: '#7c5cff' },
            { type: 'arrow', x1: 381, y1: 136, x2: 381, y2: 186, color: '#4a9eff' },
            { type: 'circle', cx: 381, cy: 214, r: 30, text: 'Agent', color: '#4a9eff' },
            { type: 'text', x: 40, y: 214, text: 'pins → canvas://pinned-context', color: '#8994b3' },
          ],
        },
        {
          title: 'One state, many surfaces',
          caption: 'MCP, HTTP and the SDK are three doors into the same operation registry.',
          shapes: [
            { type: 'rect', x: 30, y: 40, width: 120, height: 52, text: 'MCP', color: '#4a9eff' },
            { type: 'rect', x: 30, y: 108, width: 120, height: 52, text: 'HTTP', color: '#7c5cff' },
            { type: 'rect', x: 30, y: 176, width: 120, height: 52, text: 'SDK', color: '#22c55e' },
            { type: 'arrow', x1: 156, y1: 66, x2: 280, y2: 130, color: '#8994b3' },
            { type: 'arrow', x1: 156, y1: 134, x2: 280, y2: 134, color: '#8994b3' },
            { type: 'arrow', x1: 156, y1: 202, x2: 280, y2: 138, color: '#8994b3' },
            { type: 'rect', x: 286, y: 104, width: 200, height: 60, text: 'Operation registry', color: '#eab308' },
          ],
        },
      ],
    },
  },
  explainer: {
    title: 'How context pins work',
    data: {
      summary:
        'A pin is a small, durable statement of relevance. The human makes it with a click; the agent reads it as a resource and gets the neighbourhood around it for free.',
      steps: [
        { title: 'The human pins a node', detail: 'Clicking the pin affordance adds the node id to the canvas pin set (capped at 20).' },
        { title: 'The server notifies', detail: 'Pin changes emit notifications/resources/updated for canvas://pinned-context.' },
        { title: 'The agent reads the resource', detail: 'It receives the pinned nodes plus, for each, the nearby unpinned nodes — the implicit context.' },
        { title: 'Spatial neighbours come along', detail: 'Proximity clustering means the human never has to pin everything, only the anchors.' },
      ],
      snippets: [
        { label: 'Pin from an agent', code: 'canvas_pin_nodes({ nodeIds: ["node-a", "node-b"], mode: "add" })', note: 'mode defaults to "set", which replaces the whole list.' },
        { label: 'Read it back', code: 'resources/read canvas://pinned-context', note: 'Includes the neighbourhood for each pin.' },
      ],
      faq: [
        { q: 'Does pinning move or lock the node?', a: 'No. Context pins are separate from arrange-locking; a pinned node still moves.' },
        { q: 'What happens when a pinned node is deleted?', a: 'The pin is dropped with it — pins always resolve to live nodes.' },
        { q: 'Is there a limit?', a: 'Twenty pins. Past that, curation stops being curation.' },
      ],
      glossary: [
        { term: 'Context pin', definition: 'A human-curated marker that puts a node into the agent’s context.' },
        { term: 'Neighbourhood', definition: 'The unpinned nodes spatially near a pin, surfaced alongside it.' },
        { term: 'Reading order', definition: 'Nodes sorted top-left to bottom-right, the way a human scans a board.' },
      ],
    },
  },
  'status-report': {
    title: 'Weekly canvas status',
    data: {
      metrics: [
        { label: 'Gates', value: '4/5 green', tone: 'warn' },
        { label: 'Unit tests', value: '612 passing', tone: 'ok' },
        { label: 'Coverage', value: '71% lines', tone: 'ok' },
        { label: 'Open bugs', value: '7', tone: 'warn' },
        { label: 'Bundle', value: '+4.1%', tone: 'warn' },
      ],
      shipped: [
        'Delimited files render as tables instead of raw text',
        'Shared readability floor between server and client',
        'Generated demo board covering every public surface',
      ],
      slipped: ['Per-band deep links', 'Snapshot diff in the browser'],
      risks: ['Bundle growth is trending up three weeks running', 'e2e suite is the slowest gate and the flakiest'],
      next: ['Cut the bundle back under the 0.4.5 baseline', 'Record the 60-second tour off the new demo board'],
    },
  },
  'incident-report': {
    title: 'Blank ext-app tiles on WebKit',
    data: {
      severity: 'SEV-3',
      status: 'resolved',
      duration: '3h 12m',
      summary:
        'Several MCP App nodes rendered as black tiles after a cold reload in WebKit hosts. Content was present in the DOM but never composited.',
      impact: [
        { label: 'Affected hosts', value: 'Safari + WKWebView', tone: 'warn' },
        { label: 'Boards affected', value: '4', tone: 'warn' },
        { label: 'Data loss', value: 'none', tone: 'ok' },
      ],
      timeline: [
        { time: '09:41', event: 'Report filed', detail: 'Screenshot shows four black tiles after reload.', tone: 'warn' },
        { time: '10:05', event: 'Reproduced', detail: 'Only when several apps hydrate in the same frame.', tone: 'warn' },
        { time: '10:52', event: 'Root cause found', detail: 'Burst hydration overwhelms the WebKit compositor.', tone: 'info' },
        { time: '12:10', event: 'Fix landed', detail: 'Serialized, boot-aware remount queue; one app at a time.', tone: 'ok' },
        { time: '12:53', event: 'Verified', detail: 'Ten consecutive cold reloads, no black tiles.', tone: 'ok' },
      ],
      rootCause:
        'A fixed-stagger remount was not boot-aware: each recovery remount reboots the app, so staggered remounts overlapped into a fresh burst and the per-node one-shot flag was already spent.',
      logs: '[extapp] remount nodeId=mcp-app-1 reason=paint-probe-timeout\n[extapp] boot-wait nodeId=mcp-app-1 elapsed=1840ms\n[extapp] settled nodeId=mcp-app-1',
      actions: [
        { done: true, owner: 'client', description: 'Serialize remounts behind a boot-aware queue', due: '0.4.6' },
        { done: true, owner: 'client', description: 'Mirror the recovery trail to the daemon for hosts without devtools', due: '0.4.6' },
        { done: false, owner: 'qa', description: 'Add a cold-reload burst case to the e2e suite', due: '0.4.8' },
      ],
    },
  },
  'triage-board': {
    title: 'Post-0.4.7 triage',
    data: {
      columns: ['Now', 'Next', 'Later', 'Cut'],
      items: [
        { title: 'Bundle back under baseline', detail: 'Client bundle is +4.1% over 0.4.6.', column: 'Now', rationale: 'Trending the wrong way three weeks running.' },
        { title: 'Stabilise the e2e gate', detail: 'Two reruns per week on average.', column: 'Now', rationale: 'Slowest and flakiest gate blocks every release.' },
        { title: 'Per-band deep links', detail: 'Open the board focused on one band.', column: 'Next', rationale: 'Makes the demo board usable as documentation.' },
        { title: '60-second tour recording', detail: 'Screen capture driven off --demo.', column: 'Next', rationale: 'Cheapest onboarding win available.' },
        { title: 'Snapshot diff in the browser', detail: 'Today it is MCP/HTTP only.', column: 'Later', rationale: 'Useful, not blocking.' },
        { title: 'Theme editor UI', detail: 'Edit CSS variables from the toolbar.', column: 'Cut', rationale: 'Nine built-in themes already cover the need.' },
      ],
    },
  },
  'config-editor': {
    title: 'Canvas feature flags',
    data: {
      flags: [
        { key: 'strictSizeDemo', label: 'strictSize on demo nodes', area: 'Demo', enabled: true, description: 'Keeps the generated band layout exactly as authored.' },
        { key: 'contentFit', label: 'Iframe content-fit', area: 'Layout', enabled: true, description: 'Iframe surfaces grow to their reported content height.' },
        { key: 'codeGraph', label: 'Auto dependency edges', area: 'Graph', enabled: true, description: 'Derives depends-on edges between file nodes.' },
        { key: 'axInteractions', label: 'Node AX interactions', area: 'AX', enabled: false, requires: ['axCapabilities'], description: 'Lets eligible node surfaces emit AX operations.' },
        { key: 'axCapabilities', label: 'AX capability ceiling', area: 'AX', enabled: false, description: 'Per-node-type ceiling a node can narrow but never escalate.' },
        { key: 'webviewAutomation', label: 'Bun.WebView automation', area: 'Tooling', enabled: false, description: 'Headless webview driving for CI screenshots.' },
      ],
    },
  },
  'ax-board': {
    title: 'Agent board',
    data: {
      note: 'Tasks queued here land in the canvas AX work queue, so the agent picks them up without another prompt.',
      defaultRuns: 3,
    },
  },
  'ax-flow': {
    title: 'Release flow',
    data: {
      note: 'Each step is a canvas AX work item. Materialize drops the same flow onto the board as real nodes.',
      steps: [
        { title: 'Cut the branch', detail: 'Bump the version and write the changelog entry.' },
        { title: 'Run the gates', detail: 'typecheck, unit, e2e, lint — all green before anything else.' },
        { title: 'Publish', detail: 'Tag, push, npm publish, then smoke the published package.' },
        { title: 'Report', detail: 'What shipped, what is still open, what to watch.' },
      ],
      loop: { enabled: true, maxRuns: 3 },
    },
  },
  'prompt-tuner': {
    title: 'Board summary prompt',
    data: {
      template:
        'You are looking at a PMX Canvas board for {{project}}.\n\nSummarise it for a {{audience}} in {{sentences}} sentences. Lead with what the board is FOR, then what changed most recently. Ignore layout and node ids.\n\nPinned nodes are the human’s curation — weight them above everything else.',
      samples: [
        { name: 'Standup', variables: { project: 'pmx-canvas', audience: 'teammate joining the standup', sentences: 'two' } },
        { name: 'Exec review', variables: { project: 'the 0.4.7 release', audience: 'director who has not seen the tool', sentences: 'three' } },
        { name: 'Handoff', variables: { project: 'the demo board rebuild', audience: 'agent picking the work up cold', sentences: 'four' } },
      ],
    },
  },
};

async function bandPrimitives(): Promise<void> {
  const top = await bandLabel(
    'label-primitives',
    '⑦ HTML primitives',
    'All 21 generated communication surfaces — self-contained sandboxed documents, no build step.',
  );

  const descriptors = listHtmlPrimitiveDescriptors();
  const columns = 4;
  const colGap = 56;
  const rowGap = 64;
  const cellWidth = Math.max(...descriptors.map((d) => d.defaultSize.width));
  const rowHeights: number[] = [];
  for (const [index, descriptor] of descriptors.entries()) {
    const row = Math.floor(index / columns);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, descriptor.defaultSize.height);
  }
  const rowTops = rowHeights.map((_, row) =>
    rowHeights.slice(0, row).reduce((sum, height) => sum + height + rowGap, 0),
  );

  for (const [index, descriptor] of descriptors.entries()) {
    const preset = PRIMITIVE_DATA[descriptor.kind];
    if (!preset) throw new Error(`No demo data authored for HTML primitive "${descriptor.kind}".`);
    const column = index % columns;
    const row = Math.floor(index / columns);
    await node(`primitive-${descriptor.kind}`, {
      type: 'html',
      primitive: descriptor.kind,
      title: preset.title,
      data: preset.data,
      x: cx(column * (cellWidth + colGap)),
      y: top + rowTops[row],
    });
  }

  const bandHeight = rowTops[rowTops.length - 1] + rowHeights[rowHeights.length - 1];
  endBand(top, bandHeight);
}

// ── grouping ──────────────────────────────────────────────────

const GROUP_FRAME = { width: 1000, height: 440 };
const GROUP_INSET = 60;

async function bandGrouping(): Promise<void> {
  const top = await bandLabel(
    'label-grouping',
    '⑥ Grouping',
    'A group says "these belong together". One frame is enough — bands carry a board\u2019s structure.',
  );

  await node('group-note', {
    type: 'markdown',
    title: 'Sprint 41 — canvas polish',
    content: [
      'Three nodes, one frame. Moving the frame moves the children; ungrouping leaves them exactly where they are.',
      '',
      '- Group children keep their own positions by default',
      '- `childLayout` opts into auto-packing',
      '- The frame is stored as `data.children` on the group',
    ].join('\n'),
    x: cx(GROUP_INSET),
    y: top + 76,
    width: 440,
    height: 300,
  });

  await node('group-status', {
    type: 'status',
    title: 'Sprint state',
    x: cx(540),
    y: top + 76,
    width: 400,
    height: 140,
    data: {
      phase: 'review',
      detail: '6 of 7 items merged',
      message: 'Demo board is the last one open',
      level: 'ok',
    },
  });

  await node('group-trace', {
    type: 'trace',
    title: 'canvas_group',
    toolName: 'canvas_group · create',
    category: 'mcp',
    status: 'success',
    duration: '11ms',
    resultSummary: 'Framed 3 nodes',
    x: cx(540),
    y: top + 256,
    width: 400,
    height: 120,
  });

  await create('group', '/api/canvas/group', {
    title: 'Sprint 41',
    color: '#7c5cff',
    childIds: [serverId('group-note'), serverId('group-status'), serverId('group-trace')],
    x: cx(0),
    y: top,
    width: GROUP_FRAME.width,
    height: GROUP_FRAME.height,
  });

  endBand(top, GROUP_FRAME.height);
}

// ── agent at work ─────────────────────────────────────────────

/**
 * A believable task caught mid-flight. Statuses are deliberately MIXED so the
 * seeded board reads as work in progress rather than a fresh queue, and step 2 —
 * the one the agent is on — is the context pin.
 */
const AGENT_FLOW_TITLE = 'Flaky publish gate';
const AGENT_FLOW_STEPS: Array<{ title: string; detail: string; status: string }> = [
  {
    title: 'Reproduce',
    detail: 'Ran the publish gate 20× in a loop. Fails 3 in 20, always on the registry probe.',
    status: 'done',
  },
  {
    title: 'Fix',
    detail: 'Retry the probe with backoff instead of failing the gate on the first timeout.',
    status: 'in-progress',
  },
  { title: 'Verify', detail: 'Re-run the same 20× loop and require 20 green.', status: 'todo' },
  { title: 'Ship', detail: 'Land the patch, then watch the next three releases.', status: 'todo' },
];
/** The step the agent is on — pinned, so the board shows the active step as context. */
const AGENT_ACTIVE_STEP = AGENT_FLOW_STEPS.findIndex((step) => step.status === 'in-progress');

const AGENT_STEP_SIZE = { width: 360, height: 240 };
const AGENT_NOTE_SIZE = { width: 520, height: 240 };

interface MaterializedFlow {
  primitive: {
    steps: Array<{ index: number; nodeId: string; workItemId: string }>;
    edgeIds: string[];
  };
}

/**
 * ⑧ — the flow is built through the REAL path: the ⑦ `ax-flow` panel emits
 * `ax.flow.materialize`, exactly as its "Materialize to board" button does, and
 * the step nodes it returns are moved into this band. Hand-assembling the nodes
 * would produce the same picture with dead controls.
 */
async function bandAgentAtWork(): Promise<void> {
  const top = await bandLabel(
    'label-agent',
    '⑧ Agent at work',
    'A task caught mid-flight: one work item per step, status chips on the nodes, controls that steer the agent.',
  );

  const flow = await api<MaterializedFlow>('POST', '/api/canvas/ax/interaction', {
    type: 'ax.flow.materialize',
    sourceNodeId: serverId('primitive-ax-flow'),
    sourceSurface: 'html-node',
    payload: {
      title: AGENT_FLOW_TITLE,
      steps: AGENT_FLOW_STEPS.map((step) => ({ title: step.title, detail: step.detail })),
      loop: { enabled: false },
    },
  });
  const steps = flow.primitive.steps;
  if (steps.length !== AGENT_FLOW_STEPS.length) {
    throw new Error(`Materialize returned ${steps.length} steps, expected ${AGENT_FLOW_STEPS.length}.`);
  }

  for (const [index, step] of steps.entries()) {
    // Step node + work-item ids: the node id derives from the panel's server id
    // (so the existing rewrite handles it); the work-item id is random, so it
    // needs a stable key of its own or the fixture differs on every run.
    registerDerivedId(step.nodeId);
    stableIds.set(step.workItemId, `work-agent-${index + 1}`);
    await patchById(step.nodeId, {
      x: cx(index * (AGENT_STEP_SIZE.width + GAP)),
      y: top,
      width: AGENT_STEP_SIZE.width,
      height: AGENT_STEP_SIZE.height,
      strictSize: true,
    });
    // Through the same interaction the native Start/Done buttons emit, so the
    // seeded chips are produced by the code path the board's controls use.
    await api('POST', '/api/canvas/ax/interaction', {
      type: 'ax.work.update',
      sourceNodeId: step.nodeId,
      sourceSurface: 'native-node',
      payload: { id: step.workItemId, status: AGENT_FLOW_STEPS[index].status },
    });
  }
  // The flow edges materialize created are derived ids too, but nothing else
  // registers them — the export allowlist would reject them.
  for (const edgeId of flow.primitive.edgeIds) registerDerivedId(edgeId);

  await node('agent-note', {
    type: 'markdown',
    title: 'How to read this band',
    content: [
      'Each step is a real **AX work item**, so the chip on a step node is the',
      'agent’s live status — it moves as the agent works.',
      '',
      'The buttons in each step footer steer it: **Start**, **Done** and',
      '**Blocked** write that step’s work item, which the agent reads back from',
      '`canvas://ax-work`.',
      '',
      `Step ${AGENT_ACTIVE_STEP + 1} is pinned, so \`canvas://pinned-context\` hands the agent the`,
      'step it is actually on.',
    ].join('\n'),
    x: cx(steps.length * (AGENT_STEP_SIZE.width + GAP)),
    y: top,
    width: AGENT_NOTE_SIZE.width,
    height: AGENT_NOTE_SIZE.height,
  });

  endBand(top, Math.max(AGENT_STEP_SIZE.height, AGENT_NOTE_SIZE.height));

  // Pinned with the rest of the board's pins (see buildPinsAndAnnotations), which
  // runs last and would otherwise clobber a pin set here.
  serverIds.set('agent-step-active', steps[AGENT_ACTIVE_STEP].nodeId);
}

// ── edges, pins, annotations ──────────────────────────────────

async function buildEdges(): Promise<void> {
  await edge('edge-runs', 'status', 'trace-plan', { type: 'flow', label: 'runs', animated: true });
  await edge('edge-then', 'trace-plan', 'trace-apply', { type: 'flow', label: 'then', style: 'dotted' });
  await edge('edge-decisions', 'context', 'ledger', { type: 'relation', label: 'decisions' });
  await edge('edge-changed-in', 'file-ts', 'diff', { type: 'depends-on', label: 'changed in' });
  await edge('edge-gate', 'mermaid-sequence', 'mermaid-state', {
    type: 'references',
    label: 'approval gate',
    style: 'dashed',
  });
  await edge('edge-sprint', 'group-note', 'group-status', { type: 'relation', style: 'dashed' });
}

async function buildPinsAndAnnotations(): Promise<void> {
  await api('POST', '/api/canvas/context-pins', {
    nodeIds: [serverId('intro'), serverId('context'), serverId('diff')],
    mode: 'set',
  });
  // The ⑧ step the agent is on, added rather than set: the human's spatial
  // curation and the agent's active step are the same channel.
  await api('POST', '/api/canvas/context-pins', {
    nodeIds: [serverId('agent-step-active')],
    mode: 'add',
  });

  await api('POST', '/api/canvas/annotation', {
    id: 'demo-annotation-pins',
    type: 'text',
    text: 'Pinned nodes → canvas://pinned-context',
    points: [{ x: 2286, y: 470 }],
    width: 26,
    color: '#eab308',
  });
}

// ── export ────────────────────────────────────────────────────

interface ExportedNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  data: Record<string, unknown>;
}

interface ExportedEdge {
  id: string;
  from: string;
  to: string;
  type: string;
}

interface ExportedLayout {
  nodes: ExportedNode[];
  edges: ExportedEdge[];
  annotations?: unknown[];
}

interface ExportedWorkItem {
  id: string;
  status: string;
  nodeIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** The canvas-bound AX partition — exactly what `GET /api/canvas/ax` returns as `state`. */
interface ExportedAx {
  workItems: ExportedWorkItem[];
}

/**
 * Rewrite every time-based server id to its stable `demo-*` key across the WHOLE
 * exported document, not just the id/from/to fields: graph and json-render nodes
 * embed their own node id in `data.url` / `data.surfaceUrl`, and a group stores
 * child ids in `data.children`. A textual pass over the serialized layout catches
 * all of them at once — and self-referencing viewer URLs have to be rewritten or
 * the seeded node would point its iframe at an id that no longer exists.
 *
 * The AX block goes through the same pass, so a work item and the `axStep`
 * stamp that points at it are rewritten to the same stable id.
 */
function withStableIds<T>(document: T): T {
  let json = JSON.stringify(document);
  for (const [server, stable] of stableIds) json = json.replaceAll(server, stable);
  return JSON.parse(json) as T;
}

const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g;

/**
 * Work items are stamped `createdAt`/`updatedAt` from the wall clock. Pin them to
 * the fixture stamp so a regeneration that changes nothing produces no diff, then
 * assert nothing else in the block still carries a live clock reading.
 */
function freezeAxTimestamps(ax: ExportedAx): ExportedAx {
  const frozen: ExportedAx = {
    ...ax,
    workItems: ax.workItems.map((item) => ({
      ...item,
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
    })),
  };
  for (const stamp of JSON.stringify(frozen).match(ISO_TIMESTAMP) ?? []) {
    if (!FIXTURE_TIMESTAMP.startsWith(stamp)) {
      throw new Error(`Unfrozen AX timestamp "${stamp}" would make the fixture differ between runs.`);
    }
  }
  return frozen;
}

function normalizeNodeData(data: Record<string, unknown>): Record<string, unknown> {
  const next = { ...data };
  // The create-time webpage fetch either sets `error` or deletes it; the PATCH
  // above normalizes it to an empty string. Drop it so the fixture is identical
  // whether or not the generator had network access.
  if (next.error === '') delete next.error;
  return next;
}

/** Assert the invariants the demo test also enforces, before anything is written. */
function assertBoardInvariants(
  nodes: ExportedNode[],
  edges: ExportedEdge[],
  pins: string[],
  ax: ExportedAx,
): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Every `axStep` stamp has to resolve, or the seeded board renders status chips
  // over controls that 404 the moment anyone presses them.
  const workItemIds = new Set(ax.workItems.map((item) => item.id));
  for (const n of nodes) {
    const step = n.data.axStep as { workItemId?: unknown } | undefined;
    if (!step) continue;
    if (typeof step.workItemId !== 'string' || !workItemIds.has(step.workItemId)) {
      throw new Error(`${n.id} carries an axStep whose work item "${String(step.workItemId)}" is not in the fixture.`);
    }
  }
  for (const item of ax.workItems) {
    for (const nodeId of item.nodeIds) {
      if (!byId.has(nodeId)) throw new Error(`Work item ${item.id} references missing node ${nodeId}.`);
    }
  }

  for (const edgeItem of edges) {
    if (!byId.has(edgeItem.from)) throw new Error(`Edge ${edgeItem.id} has a missing source ${edgeItem.from}.`);
    if (!byId.has(edgeItem.to)) throw new Error(`Edge ${edgeItem.id} has a missing target ${edgeItem.to}.`);
  }
  for (const pin of pins) {
    if (!byId.has(pin)) throw new Error(`Context pin "${pin}" does not resolve to a node.`);
  }

  const groups = nodes.filter((n) => n.type === 'group');
  if (groups.length !== 1) throw new Error(`Expected exactly one group node, found ${groups.length}.`);
  for (const group of groups) {
    const children = group.data.children;
    if (!Array.isArray(children) || children.length === 0) throw new Error(`${group.id} has no children.`);
    for (const childId of children as string[]) {
      const child = byId.get(childId);
      if (!child) throw new Error(`${group.id} references missing child ${childId}.`);
      if (child.data.parentGroup !== group.id) throw new Error(`${childId} is not linked back to ${group.id}.`);
      const insetLeft = child.position.x - group.position.x;
      const insetTop = child.position.y - group.position.y;
      const insetRight = group.position.x + group.size.width - (child.position.x + child.size.width);
      const insetBottom = group.position.y + group.size.height - (child.position.y + child.size.height);
      const inset = Math.min(insetLeft, insetTop, insetRight, insetBottom);
      if (inset < 40) throw new Error(`${childId} is inset only ${inset}px inside ${group.id} (need >= 40).`);
    }
  }

  const framed = nodes.filter((n) => n.type !== 'group');
  for (let i = 0; i < framed.length; i += 1) {
    for (let j = i + 1; j < framed.length; j += 1) {
      const a = framed[i];
      const b = framed[j];
      const separated =
        a.position.x + a.size.width <= b.position.x ||
        b.position.x + b.size.width <= a.position.x ||
        a.position.y + a.size.height <= b.position.y ||
        b.position.y + b.size.height <= a.position.y;
      if (!separated) throw new Error(`${a.id} overlaps ${b.id}.`);
    }
  }

  for (const n of nodes) {
    if (n.type === 'prompt' || n.type === 'response') throw new Error(`Internal node type ${n.type} leaked into the board.`);
  }
}

async function exportFixture(outputPath: string, workspace: string): Promise<{ nodes: number; edges: number }> {
  const layout = withStableIds(await api<ExportedLayout>('GET', '/api/canvas/state?includeBlobs=true'));
  // Canvas-bound AX only. The timeline partitions (events/evidence/steering) are
  // NOT part of this read, which matches how snapshots restore: the fixture keeps
  // the work items the board's controls need and none of the diagnostic noise.
  const axState = await api<{ state: ExportedAx }>('GET', '/api/canvas/ax?includeContext=false');
  const ax = freezeAxTimestamps(withStableIds(axState.state));

  const known = new Set(stableIds.values());
  const nodes = layout.nodes.map((raw) => {
    if (!known.has(raw.id)) throw new Error(`Node "${raw.id}" was not created by this script.`);
    return { ...raw, data: normalizeNodeData(raw.data) };
  });
  // Auto-detected import edges are recomputed at runtime; never freeze them.
  const edges = layout.edges.filter((raw) => !raw.id.startsWith('codegraph-'));
  for (const raw of edges) {
    if (!known.has(raw.id)) throw new Error(`Edge "${raw.id}" was not created by this script.`);
  }
  const pins = withStableIds(await api<{ nodeIds: string[] }>('GET', '/api/canvas/pinned-context')).nodeIds;
  // annotation.add always stamps `createdAt` with the wall clock; pin it so a
  // regeneration that changes nothing produces no diff.
  const annotations = (layout.annotations ?? []).map((annotation) => ({
    ...(annotation as Record<string, unknown>),
    createdAt: FIXTURE_TIMESTAMP,
  }));

  assertBoardInvariants(nodes, edges, pins, ax);

  // Opens on the intro band with the next bands hinted below.
  const viewport = { x: 90, y: 70, scale: 0.52 };

  const fixture = {
    viewport,
    nodes,
    edges,
    annotations,
    contextPins: pins,
    ax,
  };
  const serialized = `${JSON.stringify(fixture, null, 2)}\n`;
  // The board has to be reproducible on any machine: nothing may capture the
  // generator's throwaway workspace (or a leftover server id).
  if (serialized.includes(workspace)) {
    throw new Error('The generator workspace path leaked into the fixture.');
  }
  for (const server of stableIds.keys()) {
    if (serialized.includes(server)) throw new Error(`Server id "${server}" leaked into the fixture.`);
  }
  writeFileSync(outputPath, serialized);
  return { nodes: nodes.length, edges: edges.length };
}

// ── runner ────────────────────────────────────────────────────

async function waitForServer(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Canvas server did not come up on ${BASE} within ${timeoutMs}ms.`);
}

async function main(): Promise<void> {
  const repoRoot = new URL('..', import.meta.url).pathname;
  const workspace = mkdtempSync(join(tmpdir(), 'pmx-demo-gen-'));
  const server = Bun.spawn(['bun', 'run', join(repoRoot, 'src/cli/index.ts'), '--no-open', `--port=${PORT}`], {
    cwd: workspace,
    env: {
      ...process.env,
      PMX_CANVAS_WORKSPACE_ROOT: workspace,
      PMX_CANVAS_DISABLE_BROWSER_OPEN: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  try {
    await waitForServer();
    await buildBoard();
    const outputPath = join(repoRoot, 'src/server/demo-state.json');
    const counts = await exportFixture(outputPath, workspace);
    console.log(`demo board written: ${counts.nodes} nodes, ${counts.edges} edges -> ${outputPath}`);
  } finally {
    server.kill();
    await server.exited;
    rmSync(workspace, { recursive: true, force: true });
  }
}

await main();
