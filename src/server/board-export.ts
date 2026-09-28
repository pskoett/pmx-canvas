/**
 * Static board export (plan 013, vision move 11): one self-contained HTML file
 * of one board — read-only, pan / zoom / expand, no server. The first step to
 * sharing, so the owner sees what leaves the machine (`previewBoardExport`)
 * before the file is written.
 *
 * Card bodies are rendered here as escaped HTML. Anything that runs code (html
 * cards, charts, diagrams, built apps) goes into a sandboxed iframe with no
 * same-origin, exactly as on the canvas. The chart and diagram viewer bundles
 * are stored once in the file and spliced into each iframe at open time.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Marked, type RendererThis, type Tokens } from 'marked';
import { canvasThemeScheme } from '../shared/themes.js';
import { buildJsonRenderViewerHtml, escapeInlineScriptSource, readJsonRenderBundle } from '../json-render/server.js';
import type { JsonRenderSpec } from '../json-render/server.js';
import { getCanvasNodeTitle } from './canvas-serialization.js';
import { canvasState, PMX_CANVAS_DIR, type CanvasEdge, type CanvasNodeState } from './canvas-state.js';
import { buildHtmlSurfaceDocument, buildMermaidSurfaceHtml } from './html-surface.js';
import { validateLocalImageFile } from './image-source.js';

const JR_JS = '__PMX_EXPORT_JSONRENDER_JS__';
const JR_CSS = '__PMX_EXPORT_JSONRENDER_CSS__';
const MERMAID_SRC = '__PMX_EXPORT_MERMAID_SRC__';
const MAX_FILE_BYTES = 1024 * 1024;

export interface ExportManifest {
  boardId: string;
  boardName: string;
  cards: number;
  connections: number;
  /** Cards shown in sandboxed frames: html, charts, diagrams, built apps. */
  frames: number;
  placeholders: Array<{ nodeId: string; title: string; reason: string }>;
  files: Array<{ nodeId: string; path: string; included: boolean }>;
  embeddedImages: number;
  /** Web images the file loads when opened. */
  remoteImages: string[];
  /** Navigable links present in markdown and webpage cards. */
  links: string[];
  /** Statically visible network destinations in sandboxed HTML frames. */
  frameNetworkDestinations: string[];
  /** Scripts in embedded frames can make requests that static inspection cannot enumerate. */
  embeddedCodeCanAccessNetwork: boolean;
  includeFiles: boolean;
}

interface ExportCard {
  id: string;
  kind: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  group?: true;
  html?: string;
  frame?: string;
}

interface Collected {
  manifest: ExportManifest;
  cards: ExportCard[];
  edges: CanvasEdge[];
  scheme: 'dark' | 'light';
  needsJsonRender: boolean;
  needsMermaid: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const isSafeLink = (href: string): boolean => /^(https?:|mailto:|#)/i.test(href.trim());

function createMarkdown(remoteImages: Set<string>, links: Set<string>): Marked {
  return new Marked({
    renderer: {
      // Raw HTML in a card is shown as text: the export's own page must run no author script.
      html({ text: raw }: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(raw);
      },
      link(this: RendererThis, { href, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        if (/^https?:/i.test(href)) links.add(href);
        return isSafeLink(href)
          ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
          : inner;
      },
      image({ href, text: alt }: Tokens.Image) {
        if (/^https?:/i.test(href)) {
          remoteImages.add(href);
          return `<img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}" referrerpolicy="no-referrer">`;
        }
        if (/^data:image\//i.test(href)) return `<img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}">`;
        return escapeHtml(alt);
      },
    },
  });
}

function collectFrameNetworkDestinations(html: string, destinations: Set<string>): void {
  const patterns = [
    /\b(?:src|href|action|poster)\s*=\s*["'](https?:\/\/[^"']+)["']/gi,
    /\burl\(\s*["']?(https?:\/\/[^)'"\s]+)["']?\s*\)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) destinations.add(match[1]);
  }
}

function ownedArtifactHtml(path: string): string | null {
  try {
    const artifactRoot = realpathSync(resolve(canvasState.workspaceRoot, PMX_CANVAS_DIR, 'artifacts'));
    const candidate = realpathSync(resolve(path));
    const rel = relative(artifactRoot, candidate);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
    const stat = statSync(candidate);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    return readFileSync(candidate, 'utf-8');
  } catch {
    return null;
  }
}

function pre(value: string, className = ''): string {
  return `<pre class="${className}">${escapeHtml(value)}</pre>`;
}

function rows(entries: Array<[string, unknown]>): string {
  const cells = entries
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(
      ([key, value]) =>
        `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(typeof value === 'string' ? value : JSON.stringify(value))}</td></tr>`,
    );
  return cells.length ? `<table class="kv">${cells.join('')}</table>` : '';
}

function canvasBundleDir(): string {
  const candidates = [join(import.meta.dir, '..', '..', 'dist', 'canvas'), join(process.cwd(), 'dist', 'canvas')];
  return candidates.find((dir) => existsSync(join(dir, 'surface-theme.css'))) ?? candidates[0];
}

function readAsset(name: string): string {
  const path = join(canvasBundleDir(), name);
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

function imageDataUri(path: string): string | null {
  try {
    const { mimeType } = validateLocalImageFile(path);
    return `data:${mimeType};base64,${readFileSync(path).toString('base64')}`;
  } catch {
    return null;
  }
}

function fileText(node: CanvasNodeState, path: string): string | null {
  if (node.data.binary === true) return null;
  if (typeof node.data.fileContent === 'string') return node.data.fileContent;
  try {
    if (!statSync(path).isFile() || statSync(path).size > MAX_FILE_BYTES) return null;
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

async function collect(boardId: string, includeFiles: boolean, withFrames: boolean): Promise<Collected | null> {
  const read = canvasState.readBoard(boardId);
  if (!read) return null;
  const { board, state } = read;
  const theme = canvasThemeScheme(state.theme ?? canvasState.theme);
  const remoteImages = new Set<string>();
  const links = new Set<string>();
  const frameNetworkDestinations = new Set<string>();
  const markdown = createMarkdown(remoteImages, links);
  const manifest: ExportManifest = {
    boardId,
    boardName: board.name,
    cards: 0,
    connections: state.edges.length,
    frames: 0,
    placeholders: [],
    files: [],
    embeddedImages: 0,
    remoteImages: [],
    links: [],
    frameNetworkDestinations: [],
    embeddedCodeCanAccessNetwork: false,
    includeFiles,
  };
  const cards: ExportCard[] = [];
  let needsJsonRender = false;
  let needsMermaid = false;
  const themeCss = withFrames ? readAsset('surface-theme.css') : '';

  for (const node of state.nodes) {
    const title = node.type === 'board' ? 'Linked board' : (getCanvasNodeTitle(node) ?? node.type);
    const card: ExportCard = {
      id: node.id,
      kind: node.type,
      title,
      x: node.position.x,
      y: node.position.y,
      w: node.size.width,
      h: node.size.height,
    };
    const data = node.data;
    const placeholder = (reason: string) => {
      manifest.placeholders.push({ nodeId: node.id, title, reason });
      card.html = `<div class="placeholder">${escapeHtml(reason)}</div>`;
    };

    switch (node.type) {
      case 'board':
        placeholder('Linked board is not included in this export.');
        break;
      case 'group':
        card.group = true;
        break;
      case 'markdown':
        card.html = `<div class="md">${await markdown.parse(text(data.content))}</div>`;
        break;
      case 'status':
        card.html = rows([
          ['Phase', data.phase],
          ['Message', data.message],
          ['Detail', data.detail],
        ]);
        break;
      case 'context': {
        const items = Array.isArray(data.cards) ? (data.cards as Array<Record<string, unknown>>) : [];
        card.html = `<ul class="list">${items
          .map((item) => `<li><strong>${escapeHtml(text(item.title))}</strong> ${escapeHtml(text(item.summary))}</li>`)
          .join('')}</ul>`;
        break;
      }
      case 'ledger':
        card.html = `${text(data.content) ? pre(text(data.content)) : ''}${rows(
          Object.entries(data).filter(
            ([key]) => !['title', 'content', '__type', 'strictSize', 'arrangeLocked'].includes(key),
          ),
        )}`;
        break;
      case 'trace':
        card.html = rows([
          ['Tool', data.toolName],
          ['Status', data.status],
          ['Duration', data.duration],
          ['Result', data.resultSummary],
        ]);
        break;
      case 'diff':
        card.html = `<pre class="diff">${text(data.content)
          .split('\n')
          .map((line) => {
            const cls = line.startsWith('+')
              ? 'add'
              : line.startsWith('-')
                ? 'del'
                : line.startsWith('@@')
                  ? 'hunk'
                  : '';
            return `<span class="${cls}">${escapeHtml(line)}</span>`;
          })
          .join('\n')}</pre>`;
        break;
      case 'prompt':
        card.html = pre(text(data.text));
        break;
      case 'response':
        card.html = `<div class="md">${await markdown.parse(text(data.content))}</div>`;
        break;
      case 'webpage': {
        const url = text(data.url);
        if (/^https?:/i.test(url)) links.add(url);
        card.html = `${url && isSafeLink(url) ? `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a></p>` : ''}${
          text(data.description) ? `<p>${escapeHtml(text(data.description))}</p>` : ''
        }${text(data.excerpt) ? `<p class="dim">${escapeHtml(text(data.excerpt))}</p>` : ''}`;
        break;
      }
      case 'image': {
        const src = text(data.src);
        const alt = text(data.alt) || title;
        let img = '';
        if (/^data:image\//i.test(src)) img = src;
        else if (/^https?:/i.test(src)) {
          remoteImages.add(src);
          img = src;
        } else if (src) {
          img = imageDataUri(src) ?? '';
          if (img) manifest.embeddedImages += 1;
        }
        card.html = img
          ? `<img class="image" src="${escapeHtml(img)}" alt="${escapeHtml(alt)}" referrerpolicy="no-referrer">${
              text(data.caption) ? `<p class="dim">${escapeHtml(text(data.caption))}</p>` : ''
            }`
          : `<div class="placeholder">Image not available: ${escapeHtml(src)}</div>`;
        break;
      }
      case 'file': {
        const path = text(data.path);
        if (!path) {
          // Inline content the board itself holds, not a file on disk.
          card.html = pre(text(data.fileContent) || text(data.content), 'code');
          break;
        }
        const body = includeFiles ? fileText(node, path) : null;
        manifest.files.push({ nodeId: node.id, path, included: body !== null });
        card.html = `<p class="dim">${escapeHtml(path)}</p>${
          body !== null
            ? pre(body, 'code')
            : '<div class="placeholder">File contents not included in this export.</div>'
        }`;
        break;
      }
      case 'html': {
        const html = text(data.html) || text(data.content);
        collectFrameNetworkDestinations(html, frameNetworkDestinations);
        manifest.frames += 1;
        if (withFrames) card.frame = buildHtmlSurfaceDocument(html, { theme, title, inlineThemeCss: themeCss });
        break;
      }
      case 'mermaid':
        manifest.frames += 1;
        needsMermaid = true;
        if (withFrames) {
          card.frame = buildHtmlSurfaceDocument(
            buildMermaidSurfaceHtml(text(data.content), null, data.fit === 'none' ? 'none' : 'contain').replace(
              '<script src="/canvas/mermaid-entry.js"></script>',
              `<script src="${MERMAID_SRC}"></script>`,
            ),
            { theme, title, inlineThemeCss: themeCss },
          );
        }
        break;
      case 'json-render':
      case 'graph':
        if (!data.spec || typeof data.spec !== 'object') {
          placeholder('This chart has no spec to export.');
          break;
        }
        manifest.frames += 1;
        needsJsonRender = true;
        if (withFrames) {
          card.frame = await buildJsonRenderViewerHtml({
            title,
            spec: data.spec as JsonRenderSpec,
            theme,
            display: 'site',
          });
        }
        break;
      case 'mcp-app': {
        const artifactPath = data.viewerType === 'web-artifact' ? text(data.path) : '';
        const artifactHtml = artifactPath ? ownedArtifactHtml(artifactPath) : null;
        if (artifactHtml !== null) {
          collectFrameNetworkDestinations(artifactHtml, frameNetworkDestinations);
          manifest.frames += 1;
          if (withFrames) card.frame = artifactHtml;
        } else {
          placeholder(
            artifactPath
              ? 'Built app is unavailable or is not an owned PMX Canvas artifact.'
              : 'Live app — open this board in PMX Canvas to use it.',
          );
        }
        break;
      }
    }
    manifest.cards += card.group ? 0 : 1;
    cards.push(card);
  }

  manifest.remoteImages = [...remoteImages];
  manifest.links = [...links];
  manifest.frameNetworkDestinations = [...frameNetworkDestinations];
  manifest.embeddedCodeCanAccessNetwork = manifest.frames > 0;
  return { manifest, cards, edges: state.edges, scheme: theme, needsJsonRender, needsMermaid };
}

/** What an export of `boardId` would put in the file, without building it. */
export async function previewBoardExport(boardId: string, includeFiles: boolean): Promise<ExportManifest | null> {
  return (await collect(boardId, includeFiles, false))?.manifest ?? null;
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export async function buildBoardExport(
  boardId: string,
  includeFiles: boolean,
): Promise<{ html: string; manifest: ExportManifest } | null> {
  const collected = await collect(boardId, includeFiles, true);
  if (!collected) return null;
  const { manifest, cards, edges: snapshotEdges, scheme, needsJsonRender, needsMermaid } = collected;

  // Store each viewer bundle once; frames reference it by placeholder.
  const assets: Record<string, string> = {};
  if (needsJsonRender) {
    const bundle = await readJsonRenderBundle();
    const js = escapeInlineScriptSource(bundle.js);
    for (const card of cards) {
      if (!card.frame || (card.kind !== 'json-render' && card.kind !== 'graph')) continue;
      card.frame = card.frame.replace(js, JR_JS).replace(bundle.css, JR_CSS);
    }
    assets[JR_JS] = js;
    assets[JR_CSS] = bundle.css;
  }
  if (needsMermaid) {
    const entry = readAsset('mermaid-entry.js');
    assets[MERMAID_SRC] = `data:text/javascript;charset=utf-8;base64,${Buffer.from(entry, 'utf-8').toString('base64')}`;
  }

  const edges = snapshotEdges.map((edge: CanvasEdge) => ({
    from: edge.from,
    to: edge.to,
    label: edge.label ?? '',
    style: edge.style ?? 'solid',
  }));
  const exportedAt = new Date().toISOString();
  const html = exportPage({
    title: manifest.boardName,
    scheme,
    exportedAt,
    board: { cards, edges },
    assets,
  });
  return { html, manifest };
}

/** Writes the export beside the database (`exports/`) and returns its path. */
export function writeBoardExport(html: string, boardName: string): string {
  const dbPath = canvasState.databasePath;
  const folder = resolve(
    dbPath ? join(dirname(dbPath), 'exports') : join(canvasState.workspaceRoot, PMX_CANVAS_DIR, 'exports'),
  );
  mkdirSync(folder, { recursive: true });
  const slug =
    boardName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'board';
  const stem = `${slug}-${new Date().toISOString().replace(/[-:.]/g, '')}`;
  for (let attempt = 0; ; attempt++) {
    const path = join(folder, `${stem}${attempt === 0 ? '' : `-${attempt}`}.html`);
    try {
      writeFileSync(path, html, { flag: 'wx' });
      return path;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
  }
}

export function exportsFolder(): string | null {
  const dbPath = canvasState.databasePath;
  return dbPath ? resolve(dirname(dbPath), 'exports') : null;
}

function exportPage(input: {
  title: string;
  scheme: 'dark' | 'light';
  exportedAt: string;
  board: { cards: ExportCard[]; edges: Array<{ from: string; to: string; label: string; style: string }> };
  assets: Record<string, string>;
}): string {
  const date = new Date(input.exportedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  return `<!doctype html>
<html lang="en" data-scheme="${input.scheme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="PMX Canvas">
<title>${escapeHtml(input.title)}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<header class="bar">
  <div class="name"><strong>${escapeHtml(input.title)}</strong><span>Exported ${escapeHtml(date)} from PMX Canvas · read-only</span></div>
  <div class="tools">
    <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
    <button type="button" data-zoom="fit" aria-label="Fit board">Fit</button>
    <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
  </div>
</header>
<main id="stage" aria-label="Board"><div id="world"><svg id="edges" aria-hidden="true"></svg></div></main>
<div id="overlay" hidden><div class="sheet" role="dialog" aria-modal="true"><header><strong id="overlay-title"></strong><button type="button" id="overlay-close" aria-label="Close">×</button></header><div id="overlay-body"></div></div></div>
<script type="application/json" id="pmx-board">${scriptJson(input.board)}</script>
<script type="application/json" id="pmx-assets">${scriptJson(input.assets)}</script>
<script>${EXPORT_VIEWER_JS}</script>
</body>
</html>
`;
}

const EXPORT_CSS = `
:root{--bg:#0b1016;--panel:#121a23;--line:#263241;--text:#e8edf2;--soft:#9aa7b4;--accent:#4bbcff;--add:#2ea66f;--del:#e25d6e}
[data-scheme=light]{--bg:#f4f6f8;--panel:#ffffff;--line:#d5dbe1;--text:#17202a;--soft:#5b6875;--accent:#0a6fc2;--add:#1c7a4f;--del:#b3263a}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
.bar{position:fixed;top:0;left:0;right:0;height:48px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 16px;background:var(--panel);border-bottom:1px solid var(--line);z-index:5}
.bar .name{display:flex;flex-direction:column;min-width:0}
.bar .name strong,.bar .name span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar .name span{font-size:11px;color:var(--soft)}
.tools{display:flex;gap:6px;flex-shrink:0}
button{font:inherit;color:var(--text);background:none;border:1px solid var(--line);border-radius:7px;padding:4px 10px;cursor:pointer}
button:hover{border-color:var(--accent)}
#stage{position:fixed;top:48px;left:0;right:0;bottom:0;overflow:hidden;cursor:grab;touch-action:none}
#stage.panning{cursor:grabbing}
#world{position:absolute;left:0;top:0;transform-origin:0 0}
#edges{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
#edges line{stroke:var(--soft);stroke-width:1.5}
#edges text{fill:var(--soft);font-size:12px;text-anchor:middle}
.card{position:absolute;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.18)}
.card.group{background:color-mix(in srgb,var(--accent) 5%,transparent);border-style:dashed;box-shadow:none}
.card-title{flex-shrink:0;padding:7px 10px;font-weight:600;font-size:13px;border-bottom:1px solid var(--line);cursor:zoom-in;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card.group .card-title{border-bottom:none;cursor:default;color:var(--soft)}
.card-body{flex:1;min-height:0;overflow:auto;padding:8px 10px}
.card iframe,#overlay-body iframe{flex:1;width:100%;height:100%;border:0;background:var(--bg)}
.md h1,.md h2,.md h3{margin:.4em 0 .3em;line-height:1.2}.md p{margin:.4em 0}.md img{max-width:100%}
.md code,pre{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
pre{margin:0;white-space:pre-wrap;word-break:break-word}
pre.diff .add{color:var(--add)}pre.diff .del{color:var(--del)}pre.diff .hunk{color:var(--accent)}
a{color:var(--accent)}
.dim{color:var(--soft)}
.kv{border-collapse:collapse;font-size:12px}.kv th{text-align:left;color:var(--soft);padding:2px 10px 2px 0;vertical-align:top}.kv td{padding:2px 0}
.list{margin:0;padding-left:18px}
.image{max-width:100%;max-height:100%;object-fit:contain;display:block;margin:auto}
.placeholder{padding:12px;border:1px dashed var(--line);border-radius:8px;color:var(--soft);font-size:12px}
#overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:24px;z-index:10}
#overlay[hidden]{display:none}
#overlay .sheet{width:min(1100px,100%);height:min(90vh,100%);display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
#overlay .sheet>header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line)}
#overlay-body{flex:1;min-height:0;overflow:auto;padding:14px;display:flex;flex-direction:column}
`;

const EXPORT_VIEWER_JS = `(() => {
const board = JSON.parse(document.getElementById('pmx-board').textContent);
const assets = JSON.parse(document.getElementById('pmx-assets').textContent);
const stage = document.getElementById('stage');
const world = document.getElementById('world');
const svg = document.getElementById('edges');
const overlay = document.getElementById('overlay');
const view = { x: 0, y: 0, scale: 1 };
const byId = new Map(board.cards.map((c) => [c.id, c]));
const withAssets = (doc) => Object.keys(assets).reduce((out, key) => out.split(key).join(assets[key]), doc);
const frame = (card) => {
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts');
  f.setAttribute('title', card.title);
  f.srcdoc = withAssets(card.frame);
  return f;
};
const body = (card) => {
  if (card.frame) return frame(card);
  const d = document.createElement('div');
  d.className = 'card-body';
  d.innerHTML = card.html || '';
  return d;
};
const ordered = [...board.cards].sort((a, b) => (b.group ? 1 : 0) - (a.group ? 1 : 0));
for (const card of ordered) {
  const el = document.createElement('section');
  el.className = 'card' + (card.group ? ' group' : '');
  el.dataset.nodeId = card.id;
  Object.assign(el.style, { left: card.x + 'px', top: card.y + 'px', width: card.w + 'px', height: card.h + 'px' });
  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = card.title;
  el.appendChild(title);
  if (!card.group) {
    el.appendChild(body(card));
    title.addEventListener('click', () => expand(card));
  }
  world.appendChild(el);
}
const NS = 'http://www.w3.org/2000/svg';
for (const edge of board.edges) {
  const a = byId.get(edge.from), b = byId.get(edge.to);
  if (!a || !b) continue;
  const x1 = a.x + a.w / 2, y1 = a.y + a.h / 2, x2 = b.x + b.w / 2, y2 = b.y + b.h / 2;
  const line = document.createElementNS(NS, 'line');
  line.setAttribute('x1', x1); line.setAttribute('y1', y1); line.setAttribute('x2', x2); line.setAttribute('y2', y2);
  if (edge.style === 'dashed') line.setAttribute('stroke-dasharray', '6 4');
  if (edge.style === 'dotted') line.setAttribute('stroke-dasharray', '2 4');
  svg.appendChild(line);
  if (edge.label) {
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', (x1 + x2) / 2); t.setAttribute('y', (y1 + y2) / 2 - 4);
    t.textContent = edge.label;
    svg.appendChild(t);
  }
}
const apply = () => { world.style.transform = 'matrix(' + view.scale + ',0,0,' + view.scale + ',' + view.x + ',' + view.y + ')'; };
const fit = () => {
  if (!board.cards.length) return apply();
  const minX = Math.min(...board.cards.map((c) => c.x)), minY = Math.min(...board.cards.map((c) => c.y));
  const maxX = Math.max(...board.cards.map((c) => c.x + c.w)), maxY = Math.max(...board.cards.map((c) => c.y + c.h));
  const pad = 32, w = stage.clientWidth, h = stage.clientHeight;
  view.scale = Math.min(1, (w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxY - minY));
  view.x = (w - (maxX - minX) * view.scale) / 2 - minX * view.scale;
  view.y = pad - minY * view.scale;
  apply();
};
const zoomAt = (factor, cx, cy) => {
  const next = Math.min(4, Math.max(0.1, view.scale * factor));
  view.x = cx - (cx - view.x) * (next / view.scale);
  view.y = cy - (cy - view.y) * (next / view.scale);
  view.scale = next;
  apply();
};
stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
let drag = null;
stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.card-body, .card-title')) return;
  drag = { x: e.clientX - view.x, y: e.clientY - view.y };
  stage.classList.add('panning');
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  view.x = e.clientX - drag.x; view.y = e.clientY - drag.y;
  apply();
});
stage.addEventListener('pointerup', () => { drag = null; stage.classList.remove('panning'); });
document.querySelector('[data-zoom=in]').addEventListener('click', () => zoomAt(1.25, stage.clientWidth / 2, stage.clientHeight / 2));
document.querySelector('[data-zoom=out]').addEventListener('click', () => zoomAt(0.8, stage.clientWidth / 2, stage.clientHeight / 2));
document.querySelector('[data-zoom=fit]').addEventListener('click', fit);
const close = () => { overlay.hidden = true; document.getElementById('overlay-body').replaceChildren(); };
function expand(card) {
  document.getElementById('overlay-title').textContent = card.title;
  document.getElementById('overlay-body').replaceChildren(body(card));
  overlay.hidden = false;
}
document.getElementById('overlay-close').addEventListener('click', close);
overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
fit();
})();`;
