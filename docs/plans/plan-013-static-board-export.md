# Plan 013 — Static board export

**Status:** Done (2026-09-27)
**Date:** 2026-09-27
**Source:** [Product vision, move 11](../product-vision-2026-09.md#11-static-export-the-first-step-to-sharing-m) — the first step to sharing, the 0.7.x item.
**Done when:** a colleague opens an exported board with no install: one HTML file, read-only, with pan, zoom and card expand.

## What the file is

One self-contained HTML file of one board: the board's cards, groups and connections laid out as on the
canvas, a small inline viewer (drag to pan, wheel or buttons to zoom, fit on open, click a card to expand
it, Esc to close), and a header naming the board and when it was exported. No server, no network needed
for anything the board itself holds.

## How each kind of card exports

| Card | In the file |
|---|---|
| markdown, status, context, ledger, trace, diff, prompt/response, webpage | Rendered as text. Raw HTML inside markdown is shown as text, and only http(s), mailto and in-page links stay links |
| html | Its markup in a sandboxed iframe (`allow-scripts`, no same-origin), as on the canvas |
| json-render, graph, mermaid | Their viewer documents in sandboxed iframes. The viewer bundles are stored once in the file and shared by every such card, so ten charts do not mean ten copies |
| web artifact (built app) | Its bundled page in a sandboxed iframe |
| live MCP app (e.g. Excalidraw) | A labelled placeholder — it needs its server |
| image | Local images embedded; web images stay links to the web |
| file | Path only, unless the owner opts in to include file contents |
| group | Its frame and title |

## The rule: the owner sees what leaves the machine

An export is a share. Before writing, the export dialog lists what goes into the file: the card count,
embedded charts and diagrams, apps shown as placeholders, local files (contents excluded unless the owner
ticks "Include file contents"), and web images and links the file will point to.

## Surfaces

- Browser: **Export** in the top bar → the dialog above → the file is written to `exports/` beside the
  database (`.pmx-canvas/exports/<board>-<timestamp>.html`), with Open and Download links and the path.
- `GET /api/canvas/export/preview?board=&includeFiles=` → the manifest; `POST /api/canvas/export`
  `{ board?, includeFiles? }` → writes the file and returns its path, URL and manifest;
  `GET /api/canvas/exports/<file>` serves it (opaque-origin sandbox CSP; `?download=1` as an attachment).
- CLI `pmx-canvas export [--board <id>] [--include-files] [--out <path>]`; SDK `exportBoard()`.
- Not on MCP: sharing is the human's act. Any board can be exported, not only the open one.

## Not in this slice

Tours in the file (presenting from an export), screenshots for live apps (capture is macOS-only),
portals (0.8).
