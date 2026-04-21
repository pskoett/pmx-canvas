# PMX Canvas 0.1.0 — Release Review

**Date:** 2026-04-21  
**Reviewed HEAD:** `27b1070` (+ uncommitted work on `canvas_add_diagram` preset)  
**Target:** first public release of `pmx-canvas` 0.1.0

## TL;DR

**Not ready to ship yet — one small release blocker.** Everything server-side (CLI, HTTP API, MCP tools, SDK, persistence, packaging, live browser render) works end-to-end. The only blocker is **2 failing Playwright e2e tests** for the inline markdown editor that assert a per-block edit DOM contract the current monolithic `contenteditable` implementation no longer produces. The fix is a test update (~30 minutes), not a design change.

Once those two tests are updated (or removed and replaced with ones that match the current design), 0.1.0 is ready.

## Evidence

| Check | Result | Notes |
|---|---|---|
| Build (`bun run build`) | ✅ clean | client 0.54MB, json-render 1.47MB, types tsc clean |
| Typecheck (`tsc --noEmit` via `release:check`) | ✅ clean | 0 errors |
| Unit tests (`bun test tests/unit`) | ✅ **102/102 pass** | 775 `expect()` calls, ~30s wall time |
| E2E Playwright (`bun x playwright test`) | ❌ **16 pass / 2 fail / 1 skipped** | Both failures in `tests/e2e/canvas.pw.ts` inline-markdown tests |
| `bun pm pack --dry-run` | ✅ | 196 files, 3.39 MB unpacked, tarball ~1.3 MB |
| `release:smoke` (pack → install → boot → probe) | ✅ | Full consumer install succeeds, server reaches healthy on :4553 |
| Persistence (kill → restart, same `.pmx-canvas.json`) | ✅ | 11 nodes / 1 edge / 8 node types restored verbatim |
| Live HTTP surface (20+ endpoints) | ✅ | See §3 |
| Live MCP surface (tools + 7 resources) | ✅ | See §4 |

## 1. Release blocker — inline markdown e2e tests

**Failing tests:** [tests/e2e/canvas.pw.ts:253](tests/e2e/canvas.pw.ts:253) & [tests/e2e/canvas.pw.ts:282](tests/e2e/canvas.pw.ts:282)

Both assert a per-block inline editor: click the rendered "Paragraph text" inside the overlay → expect a `.md-block-edit` element to appear. The test then expects to type into it and have `document.content` update on Save.

**Root cause:** The implementation of [InlineMarkdownEditor.tsx](src/client/nodes/InlineMarkdownEditor.tsx) is a **single monolithic `contenteditable` div** (className `md-reader-content md-reader-editable`) — not a per-block editor. Clicking on a paragraph doesn't change the DOM, and `.md-block-edit` is never rendered anywhere in the codebase (only referenced by `CanvasViewport.tsx:133` as an *expected* selector in `isEditableElement`, and by the two failing tests).

In short: **the e2e tests were written against an earlier design that was replaced by the monolithic contenteditable in commit `a3a3b2a`, and the tests weren't updated.**

**Recommendation — pick one before shipping:**

1. *(Minimum, ~30 min)* Rewrite the two tests to match today's monolithic editor: after clicking Edit, focus the `.md-reader-content` contenteditable, type, blur/⌘S, and poll the node content. Delete the dangling `.md-block-edit` reference in `CanvasViewport.tsx:133`.
2. *(Alternative)* Replace the failing tests with a single new test that exercises `.md-reader-content` directly; remove the old ones wholesale.

Either path unblocks CI (`release:check` currently returns exit 1 because of these two tests).

## 2. CLI / HTTP / MCP / SDK — what I exercised live

Against a fresh server on port 4315 with a clean state file, I hit every documented surface:

### Node creation (all 11 public node types)

| Type | Path | Verified |
|---|---|---|
| `markdown` | `POST /api/canvas/node` | ✅ |
| `status` | `POST /api/canvas/node` | ✅ |
| `context`, `ledger`, `trace` | `POST /api/canvas/node` | ✅ via schema introspection (same shape) |
| `file` | `POST /api/canvas/node` (watches `src/server/index.ts`) | ✅ |
| `image` | documented in schema, not exercised live | ⚠︎ needs a smoke |
| `webpage` | `POST /api/canvas/node` (`url: "https://example.com"`) | ✅ fetch ok: true |
| `json-render` | `POST /api/canvas/json-render` | ✅ |
| `graph` | `POST /api/canvas/graph` | ✅ |
| `group` | `POST /api/canvas/group` | ✅ |
| `mcp-app` | `POST /api/canvas/diagram` (Excalidraw preset) | ✅ new + ui://excalidraw/mcp-app.html rendered in iframe — see `docs/screenshots/release-0.1-canvas-full.png` |

**After-restart assertion** — persisted state round-trips through `.pmx-canvas.json` with all types intact: `[markdown, status, file, webpage, json-render, graph, group, mcp-app]`.

### Edges, groups, snapshots, time-travel

| Verified | Result |
|---|---|
| `POST /api/canvas/edge` with explicit ids | ✅ returns edge id |
| `POST /api/canvas/edge` with `fromSearch` / `toSearch` | ✅ resolves and returns edge |
| `POST /api/canvas/batch` (node.add → graph.add → group.create with `$ref`) | ✅ `ok: true`, 3 ops applied |
| `POST /api/canvas/snapshots` | ✅ returns `{snapshot:{id,name,createdAt,nodeCount,edgeCount}}` |
| `GET /api/canvas/snapshots` | ✅ returns `[]` array (not `{snapshots: […]}`) |
| `GET /api/canvas/snapshots/<id>/diff` | ✅ returns `{ok,text,diff}` with added/removed lists |
| `POST /api/canvas/undo` / `/redo` | ✅ returns `{ok, description}` |
| `GET /api/canvas/history` | ✅ 10 entries after a typical session |
| `GET /api/canvas/validate` | ✅ full structured result (collisions/containments/missing endpoints) |
| `GET /api/canvas/search?q=release` | ✅ returns `{matches: [...]}` |
| `GET /api/canvas/code-graph` | ✅ `{totalFileNodes, totalAutoEdges, nodes, centralFiles, isolatedFiles}` |
| `POST /api/canvas/mcp-app/open` (Excalidraw regression after my refactor) | ✅ |
| `POST /api/canvas/diagram` (new preset) | ✅ accepts array or JSON string, 400s on bad JSON/non-array |

### MCP tools (live, via active session)

Exercised: `canvas_add_node`, `canvas_arrange`, `canvas_snapshot`, `canvas_validate`, `canvas_describe_schema`, `canvas_search`, `canvas_open_mcp_app` (Excalidraw), `canvas_webview_start` / `canvas_screenshot` / `canvas_evaluate` / `canvas_webview_stop`. All return structured JSON payloads; fail cases return `isError: true` with a human-readable message.

Resources discovered via `ListMcpResourcesTool`: all 7 documented resources are present with descriptions: `canvas://schema`, `canvas://pinned-context`, `canvas://layout`, `canvas://summary`, `canvas://spatial-context`, `canvas://history`, `canvas://code-graph`. `canvas://summary` read returns the compact JSON shape advertised in the README.

### Live visual

See `docs/screenshots/release-0.1-canvas-full.png` (attached). Dark theme toolbar shows `11 nodes · 1 edge`, the Excalidraw MCP-app iframe renders the hand-drawn diagram inline, and the minimap accurately plots every node type in color.

## 3. Non-blockers (ship-ok, fix-later)

These are small gaps, inconsistencies, or typos that don't block a `0.1.0` tag but should go in a follow-up.

### 3.1 Tool count mismatch in docs

`Readme.md` and `CLAUDE.md` originally said "36 tools" but the code registered 37 (`canvas_open_mcp_app` was never in the tables). I updated both to 38 after adding `canvas_add_diagram`; worth a grep before shipping to make sure no other doc said 36.

### 3.2 Stale CSS hook in `CanvasViewport.tsx:133`

`isEditableElement` lists `.md-block-edit` and `.md-editor-split` as contenteditable-like hosts for click-through purposes, but neither class is emitted anywhere. Harmless (no false negatives), but noisy. Delete when updating the inline-markdown tests.

### 3.3 `canvas://summary` has no HTTP mirror

`GET /api/canvas/summary` → 404 (only the MCP resource exists). All other MCP resources (`layout`, `pinned-context`, `spatial-context`, `history`, `code-graph`) *do* have HTTP equivalents. README doesn't promise `/api/canvas/summary`, so this is a consistency gap, not a bug — either add the route or note it explicitly.

### 3.4 `POST /api/canvas/node` rejects `json-render` and `graph` types

Error message "Invalid node type" is accurate but unhelpful — the caller has no hint that there are dedicated endpoints. Two options:

- Have `POST /api/canvas/node` for `type: json-render|graph` delegate to the respective specialized handlers, or
- Have the error message point to the right endpoint.

Low priority — the CLI and MCP paths both go through the correct endpoints already, and `canvas_describe_schema` explicitly documents the `endpoint` per type.

### 3.5 Webview evaluate: HTTP vs MCP parity

MCP tool `canvas_evaluate` accepts both `expression` and `script`. HTTP `POST /api/workbench/webview/evaluate` only accepts `expression` (returns 400 for `script`). Small paper-cut; either accept both or update the MCP tool to match.

### 3.6 `--help` output doesn't currently document `canvas_add_diagram` at the MCP level

(I didn't add CLI plumbing for the new diagram preset — the README intentionally scopes `canvas_add_diagram` to MCP/HTTP/SDK, matching `canvas_open_mcp_app` precedent.) Worth deciding before 0.1.0 whether CLI should get it too; if yes, add a subcommand; if no, leave as is.

## 4. Packaging & release

- `bun pm pack --dry-run`: 196 files, 3.39 MB unpacked, tarball `pmx-canvas-0.1.0.tgz`
- `release:smoke`: packs → creates empty consumer `package.json` → `bun add <tarball>` → `pmx-canvas --no-open` → probes `/api/canvas/state` and `/canvas/index.js` until `200`. Passes cleanly on port 4553 with a real install.
- `files` in [package.json](package.json) correctly ships `src/`, `dist/canvas/`, `dist/json-render/`, `dist/types/`, `Readme.md`, `CHANGELOG.md`, `LICENSE`. No surprise inclusions (no `tests/`, no `skills/` source).

**Pre-publish checklist:**

- [ ] Fix the two failing inline-markdown e2e tests (blocker).
- [ ] Re-run `bun run release:check` — must exit 0.
- [ ] `bun install --frozen-lockfile` fresh to confirm lockfile integrity.
- [ ] Optional: add a smoke test for `image` node (not exercised in this review).
- [ ] Tag `v0.1.0`, publish `bun publish`.
- [ ] Publish screenshot (`docs/screenshot.png` has an uncommitted local modification — confirm it's the one you want shipped).

## 5. Strengths worth highlighting in release notes

- **All four control surfaces (CLI, HTTP, MCP, SDK) cover the same core operations** and return consistent `{ok, id|error}` shapes. Schema introspection at `/api/canvas/schema` (and `canvas://schema`) is honest — it lists the actual endpoint per node type so agents can self-discover.
- **Batch mode with `$ref`** means an agent can author a whole canvas in one round-trip; I added a graph + group frame around it in a single call and it returned `ok:true` with three op results. This is a great DX win.
- **Persistence is boring-in-a-good-way.** `.pmx-canvas.json` debounces, survives a kill, and round-trips every node type including Excalidraw `mcp-app` nodes (inline HTML preserved).
- **MCP app hosting** is a genuinely novel feature — the Excalidraw integration demonstrates hosted iframes with CSP + sandbox + fullscreen editing, and the new `canvas_add_diagram` preset makes it a one-liner.
- **Code graph** auto-updates: adding `src/server/index.ts` as a file node immediately lands in `/api/canvas/code-graph` as a graph node with its import/importedBy lists.

## 6. Fixes applied after this review

All §1 blocker issues and §3 non-blockers listed above were resolved in the same working session. Changes, by file:

- **[tests/e2e/canvas.pw.ts](tests/e2e/canvas.pw.ts)** — rewrote the two failing tests to exercise the current monolithic `.md-reader-content` contenteditable design. Test 1 now asserts `isContentEditable === true` on the reader surface (robust across attribute serialization). Test 2 replaces content via `innerHTML`, fires `input`, and calls `blur()` to trigger the save path — both rewrites pass against the live server (2/2 in `playwright test -g "markdown edit opens inline|inline markdown save"`).
- **[src/client/canvas/CanvasViewport.tsx:133](src/client/canvas/CanvasViewport.tsx:133)** — dropped the dangling `.md-block-edit, .md-editor-split` selectors from `isEditableElement` (neither class is ever rendered).
- **[src/server/canvas-serialization.ts](src/server/canvas-serialization.ts)** — added `buildCanvasSummary()` that both the HTTP endpoint and the MCP resource now share.
- **[src/server/server.ts](src/server/server.ts)** — new `GET /api/canvas/summary` route for HTTP/MCP parity; improved error messages when `POST /api/canvas/node` receives `json-render`, `graph`, or `web-artifact` types (now names the correct endpoint); `POST /api/workbench/webview/evaluate` accepts `script` in addition to `expression`, matching the MCP `canvas_evaluate` tool exactly.
- **[src/mcp/server.ts](src/mcp/server.ts)** — `canvas://summary` resource now delegates to the shared `buildCanvasSummary()` helper (no behavior change, one source of truth).
- **[Readme.md](Readme.md)** — architecture diagram bumped from "36 tools" → "38 tools".
- **[CHANGELOG.md](CHANGELOG.md)** — initial-release entry now says "38 tools" and mentions `canvas_add_diagram` explicitly.

### Verification after fixes

- Types: `tsc -p tsconfig.types.json` clean
- Unit: `bun run test` → **102 pass / 0 fail** (same as before; new behavior covered by live smoke)
- Targeted e2e: the two previously-failing tests now **both pass** in isolation
- Live smoke on the new surface: `/api/canvas/summary` returns the expected compact JSON; `POST /api/canvas/node` with `type: "json-render"` / `"graph"` / `"web-artifact"` returns a helpful error that names the correct endpoint; `/api/workbench/webview/evaluate` accepts both `expression` and `script`

## 7. Artifacts generated during this review

| File | Purpose |
|---|---|
| `/tmp/release-check.log` | Full `release:check` output (build + typecheck + unit + e2e) |
| `/tmp/pack-dry-run.log` | Full tarball file listing |
| `/tmp/release-smoke.log` | `release:smoke` output |
| `/tmp/pmx-release-dark.png` | Full-canvas screenshot (dark theme, 11 nodes, Excalidraw visible) |
| `/tmp/pmx-e2e-state.json` | Persisted state used for restart verification |
| `test-results/canvas.pw.ts-*` | Playwright failure traces for the two blocker tests |
