# Plan 008 — Finish the operation-registry refactor (plan-005 items 8–9 + plan-006 completion)

**Status:** Proposed
**Date:** 2026-06-15
**Depends on:** plan-005 (registry — slices 1–7 merged), plan-006 (consolidation — waves 1–2 merged), plan-007 (AX domain — merged).
**Motivation:** Close out the registry refactor so v0.2 ships a coherent, complete surface. After this, the registry covers every n-way-duplicated operation; the only legacy left is the deliberate single-transport / poor-fit set.

## Verdicts (from the remaining-surface investigation)

| Operation | Verdict | Why |
|---|---|---|
| `canvas_validate` (board validation) | **Migrate** — `validate.get` op (read) | Pure read; clean fit; unblocks `canvas_query` validate action |
| `canvas_remove_annotation` | **Migrate** — `annotation.remove` op | Trivial DELETE-by-id mutation; unblocks `canvas_view` remove-annotation action |
| webview `status`/`start`/`stop`/`resize`/`evaluate` | **DONE (Wave 3)** — migrated via runner injection; `canvas_webview` composite shipped | The webview machinery (`startCanvasAutomationWebView` …) lives in `server.ts`, which `operations/` must NOT import (the isolation rule). Resolved with a **runner-injection** pattern (`src/server/operations/webview-runner.ts` + `setWebviewRunner` in `server.ts`), exactly mirroring `setOperationEventEmitter`. Ops in `src/server/operations/ops/webview.ts`; composite `canvas_webview` folds the 5 actions |
| `canvas_screenshot` | **Stay legacy** (intentional) | Returns a binary image payload the registry JSON wire shape does not model. Stays a standalone hand-written tool (and route) |
| `canvas_refresh_webpage_node` | **Stay legacy** (fold deferred) | Foldable in principle (`node.update {refresh:true}`), but a `canvas_node` `refresh` action needs the composite to INJECT `refresh:true` — a per-action input transform the composite mechanism doesn't have. Not worth the extension for one niche action |
| `canvas_add_html_node` / `canvas_add_html_primitive` | **Stay legacy** (fold deferred) | `node.add` already creates these, but `canvas_render` `add-primitive` likewise needs per-action input injection (set type / map kind). Defer with refresh |
| `canvas_open_mcp_app` / `canvas_add_diagram` / `canvas_build_web_artifact` | **Stay legacy** (poor fit: stateful session + custom SSE / long-running build) | plan-005 "don't force a bad abstraction" — same class as the json-render stream route. `canvas_app` composite **deferred** (documented) |
| `canvas_batch` | **Migrate last** — `canvas.batch` meta-op | The remaining registry slice; deletes the 290-line switch |
| `canvas_ax_interaction` / `canvas_ingest_activity` | **Stay legacy** (already decided — trust boundary / firehose) | plan-007 |

## Wave 1 — clean migrations + the two free composite actions

Two new ops (follow the established pattern; delete legacy handler + route + MCP tool + orphaned CanvasAccess per op). Both are server-independent (no `server.ts`/`index.ts` import):
- **`validate.get`** — `GET /api/canvas/validate`, mutates:false, no emit; serialize = `validateCanvasLayout(canvasState.getLayout())`; MCP `canvas_validate` (no args).
- **`annotation.remove`** — `DELETE /api/canvas/annotation/:id`, mutates:true (auto layout emit); 404 on missing; returns `{ ok:true, removed:id }`; MCP `canvas_remove_annotation { id }`.

Consolidation (additive; these are clean `action→op`, NO mechanism extension — that's why they're in scope and refresh/add-primitive are not):
- **`canvas_query`** + `validate` action → `validate.get`. Deprecate `canvas_validate`.
- **`canvas_view`** + `remove-annotation` action → `annotation.remove`. Deprecate `canvas_remove_annotation`.

Tool names: the 2 migrated tools keep their names (hand-written → registry-served); no freeze-count change. Deprecation prefixes auto-derive from the composite definitions.

**Deferred (documented, not in this campaign):** `canvas_app` (open_mcp_app/diagram/build_web_artifact poor fits), `canvas_node` refresh + `canvas_render` add-primitive + `canvas_add_html_node` folding (need a per-action input-injection mechanism — over-engineering for niche actions), `canvas_snapshot` (v0.3 name collision). These legacy tools keep working, unchanged. (`canvas_webview` is **done** — Wave 3 below; its server.ts coupling was resolved with runner injection. `canvas_screenshot` intentionally stays standalone — binary payload.)

## Wave 2 — batch (plan-005 item 9, last, highest risk)

Convert `executeCanvasBatch` (the ~290-line switch in canvas-operations.ts) into a `canvas.batch` registry meta-op:
- **`executeOperation(name, input, opts?)` gains `opts.suppressEmit`** — when true, the registry runs the op but skips the auto `canvas-layout-update`. The single, minimal registry-core change.
- The `canvas.batch` handler: read `{ operations:[...] }` or a bare `[...]` (shared array-preserving reader); for each entry resolve `$ref`/`assign` against prior results, then `executeOperation(entry.op, entry.args, { suppressEmit:true })`; collect `results`/`refs`; on failure record `failedIndex`/`error` and stop (preserve current semantics). `mutates:false` + ONE manual `ctx.emit('canvas-layout-update')` at the end. Result shape `{ ok, results, refs, failedIndex?, error? }` byte-identical.
- All 11 batch op names (`node.add/update/remove`, `graph.add`, `edge.add`, `group.create/add/remove`, `pin.set` [+ add/remove modes], `snapshot.save`, `arrange`) are already registered — names match.
- Delete the switch. Per-entry mutation history still records individually (undo per step preserved).
- **Risk: highest** — last, separately committed, one-commit revert. Verify: every op name in batch + standalone, `$ref` chaining, bare-array + `{operations}` shapes, SSE single-final-emit (operation-parity counts frames), failure at each index, local + remote.

## Wave 3 — webview (DONE) — runner injection

Migrate the 5 browser-automation tools (`status`/`start`/`stop`/`resize`/`evaluate`) to the registry. The blocker was that the webview machinery lives in `server.ts`, which `operations/` must NOT import. Resolved with **runner injection**, mirroring `setOperationEventEmitter`:

- **`src/server/operations/webview-runner.ts`** declares a `WebviewRunner` interface (`status` / `start` / `stop` / `resize` / `evaluate`) + a module-level injected instance with `setWebviewRunner(runner)` and `getWebviewRunner()` (throws a clear error if not injected). `screenshot` is intentionally NOT in the runner (binary).
- **`server.ts`** calls `setWebviewRunner({ … })` at module load (same point as `setOperationEventEmitter`), wiring the real `getCanvasAutomationWebViewStatus` / `startCanvasAutomationWebView` / `stopCanvasAutomationWebView` / `resizeCanvasAutomationWebView` / `evaluateCanvasAutomationWebView` functions. The `start` closure carries the success/error asymmetry the legacy route preserved (200 ok; 503 server-not-running; 501 unsupported runtime; 500 supported-failure — with the webview status in the error body so callers can read `lastError`).
- **`src/server/operations/ops/webview.ts`** — 5 `mutates:false` ops (webview is a side surface — no `canvas-layout-update` frame). Each handler calls `getWebviewRunner()`, never `server.ts`. Routes match the legacy paths exactly (`GET /api/workbench/webview`, `POST …/start`, `DELETE …/webview`, `POST …/resize`, `POST …/evaluate`). The `evaluate` op preserves the exact arg validation (exactly one of `expression`/`script`, MCP message in `buildInput`, HTTP message in the handler), the async-IIFE script wrap, and the arbitrary-eval trust posture (relocated, unchanged). `start`'s MCP `buildInput` sandboxes `dataStoreDir` to the workspace (MCP-only, as the legacy tool did). The fetch handler dispatches `/api/workbench/webview*` through `dispatchOperationRoute` (a null return falls through to the still-hand-written screenshot route).
- **Composite** `canvas_webview` (additive): `status` → `webview.status`, `start` → `webview.start`, `stop` → `webview.stop`, `resize` → `webview.resize`, `evaluate` → `webview.evaluate`. Deprecation prefixes auto-derive via `buildCompositeDeprecationNotes`.
- **Deleted legacy:** the 5 MCP tool blocks (`mcp/server.ts`), the 5 HTTP handlers + routes + `parseCanvasAutomationWebViewRequestBody` (`server.ts`), and the orphaned `CanvasAccess` methods (`startAutomationWebView` / `stopAutomationWebView` / `resizeAutomationWebView` / `evaluateAutomationWebView` + the `WebViewEnvelope` / `WebViewStopEnvelope` / `WebViewEvaluateEnvelope` interfaces + the `AutomationWebViewOptions` / `AutomationEvaluateResult` type aliases). **KEPT:** `CanvasAccess.getAutomationWebViewStatus` + `screenshotAutomationWebView` (the standalone `canvas_screenshot` tool needs both) and the public SDK `PmxCanvas` webview methods.
- **Freeze:** `canvas_webview` is a new tool name → freeze list 81 → 82 (the only deliberate freeze change). The 5 legacy webview tool names stay in the list (still registered, now registry-served).
- **Divergence (documented):** the only allowed unification is the local-vs-remote error asymmetry. For `evaluate`/`resize` a runtime error throws an `OperationError` (HTTP 400 `{ ok:false, error }` — no `webview` field, vs the legacy handler's `{ ok:false, error, webview }`); the MCP result is byte-identical (isError + bare message) because the HTTP invoker reads only `error`. No test asserts that error body shape.

## Verification (every wave)

1. `bun run typecheck`
2. Targeted: `operation-parity`, `mcp-tool-freeze`, `mcp-server`, `mcp-composites`, `server-api`, `cli-node`, `canvas-operations`, `pmx-canvas-sdk` (+ the batch/webview/validate suites)
3. Full `bun test tests/unit`
4. Guard tests (operation-parity / mcp-tool-freeze / mcp-server) edited only deliberately; wire shapes + tool names byte-compatible; `operations/` never imports server.ts/index.ts.
5. `dist/types` regenerated before the PR.
