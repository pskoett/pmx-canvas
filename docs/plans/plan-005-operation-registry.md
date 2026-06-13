# Plan 005 — Operation Registry: one definition site per canvas operation

**Status:** In progress (branch `refactor/v0.2-operation-registry`)
**Date:** 2026-06-12
**Motivation:** docs/tech-debt-assessment-2026-06.md item 1. Every operation is hand-written 5–6 times (CanvasStateManager/canvas-operations, PmxCanvas SDK, HTTP handler, MCP tool, CLI command, plus Local/Remote CanvasAccess in src/mcp/canvas-access.ts). Documented bug classes caused by this: fix applied to one of two mutation paths (LRN-20260606-006), enum guard not updated for new member (LRN-20260607-005), shared readJson hardening killing the batch bare-array shape (LRN-20260608-002).

## Confirmed live drift this refactor erases

- `PmxCanvas.addNode` uses `fileMode: 'path'` while `handleCanvasAddNode` uses `fileMode: 'auto'`.
- Node-update merge logic exists in three diverging versions: `handleCanvasUpdateNode` has webpage `titleSource`, html top-level `html`/`axCapabilities`, group children, `refresh:true` delegation; `PmxCanvas.updateNode` and batch `node.update` have none of these.
- `canvas_remove_node` over local access silently succeeds on a missing id while the HTTP path 404s.
- The per-type default-size ladder is copy-pasted in `handleCanvasAddNode`, `executeCanvasBatch`, and `PmxCanvas.addNode`.

## Registry core design

New directory `src/server/operations/`:

```
types.ts        Operation<I,O>, OperationContext, OperationError, defineOperation()
registry.ts     register/get/list, executeOperation(), setOperationEventEmitter()
http.ts         route table + dispatchOperationRoute(req, url): Promise<Response | null>
invoker.ts      OperationInvoker: LocalOperationInvoker | HttpOperationInvoker
mcp.ts          registerOperationTools(server, getInvoker)
ops/nodes.ts    slice 1: node.add / node.get / node.update / node.remove / layout.get
index.ts        imports all ops/* files and registers them (single registration site)
```

Key contracts:

- `Operation<I,O>` fields: `name` ('node.add', doubles as batch op name), `mutates` (true → registry emits `canvas-layout-update` after success), `input` (a ZodObject; MUST be loose/passthrough — legacy ignores unknown keys, strict parsing would be an invisible API break), `http { method, path (EXACT legacy path, ':param' segments), readInput?, serialize? }`, `mcp { toolName (frozen legacy name), description, extraShape? (MCP-only presentation flags like full/verbose), formatResult? } | null`, `handler(input, ctx)` — the single implementation, mutating via canvasState/canvas-operations so mutation history records automatically.
- `OperationError(message, status 400|404|409)` maps to HTTP status + `{ ok:false, error }` and MCP `isError: true`.
- `executeOperation(name, rawInput)`: validate → run → emit. The ONE execution path. zod failures → OperationError(400).
- SSE: `setOperationEventEmitter` injected from server.ts at module top level (same pattern as `setCanvasLayoutUpdateEmitter`). Handlers never emit `canvas-layout-update` themselves; `mutates` is the single source. Extra events (focus, viewport) go through `ctx.emit`.
- `http.ts` route matching is segment-count exact so `/node/:id` never swallows `/node/:id/refresh`. Dispatch inserted in the server.ts fetch handler immediately before the first legacy `/api/canvas/*` check; registry routes shadow legacy ones and the legacy block is deleted in the same commit that registers the op.
- The shared body reader preserves array bodies (per-op `readInput` decides; the shared reader never coerces) — structural fix for the batch bare-array bug class.
- `invoker.ts`: `LocalOperationInvoker` wraps `executeOperation`; `HttpOperationInvoker(baseUrl)` builds the request from `op.http.path` template (fills `:id` from input, GET flags to query, rest as JSON body). MCP uses local or HTTP invoker depending on CanvasAccess mode; CLI uses `HttpOperationInvoker(getBaseUrl())`; SDK wraps the handler core functions directly to stay synchronous.
- `mcp.ts`: iterates the registry, passes `{ ...op.input.shape, ...extraShape }` to `server.tool()` (zod v4 shapes pass through unchanged), invokes via the invoker, formats with `formatResult` (where compactNodePayload/createdNodePayload live).

## Slice 1 — node CRUD + layout (this slice)

Ops: `node.add`, `node.get`, `node.update`, `node.remove`, `layout.get`.

- Export `NODE_TYPES` tuple once; derive the zod enum and replace the `VALID_NODE_TYPES` Set — structural fix for the enum-guard near-miss.
- `node.add` handler = union of `handleCanvasAddNode` + `createCanvasWebpageNode` + `createCanvasHtmlPrimitiveNode`, calling existing `addCanvasNode`/`createCanvasGroup`/`buildHtmlPrimitive`/`refreshCanvasWebpageNode` etc. Default-size ladder becomes one exported `defaultNodeSize(type)`. `http.serialize` = existing `buildNodeResponse` shape, byte-identical wire format. The json-render/graph/web-artifact redirect errors keep their exact current messages.
- `node.update` = shared `buildNodePatch(existing, input)` carrying the HTTP superset semantics (titleSource, html top-level fields, group children, refresh delegation). SDK `updateNode` delegates to it — drift disappears.
- `node.remove` = `closeNodeAppSession` + `removeCanvasNode`; missing id → OperationError 404 (unifies the silent local-remove asymmetry — see parity test note below).
- `node.get`/`layout.get` keep `withContextPinReadState`/serialization in `http.serialize`; MCP keeps compact/full payload behavior via `formatResult`.
- SDK keeps `fileMode: 'path'` as an explicit visible parameter instead of forked code.

Legacy deleted in this slice: `handleCanvasAddNode`, `createCanvasWebpageNode`, `createCanvasHtmlPrimitiveNode`, `handleCanvasUpdateNode`, inline state/node GET/PATCH/DELETE routes, `VALID_NODE_TYPES`, five MCP `server.tool` blocks, orphaned CanvasAccess methods, the SDK's forked merge logic.

## Migration order after slice 1

1. Edges (mechanical; DELETE body takes `edge_id`, schema accepts both)
2. Arrange/viewport/focus/fit/clear (focus emits 3 extra events via ctx.emit; fit is mutates:false with manual viewport emit)
3. Groups
4. Pins/search/spatial-context/summary/history/undo/redo
5. Snapshots (restore keeps its deferred emit mechanism)
6. json-render/graph/stream (alias triangle heightPx/nodeHeight/height absorbed into one schema)
7. AX domain (read + mutate sub-slices; long-poll waitMs in readInput; structured denial bodies preserved)
8. Webpage refresh/diagram/mcp-app open/web-artifact/html-surface (side-channel semantics; mutates:false, own their emits; one op per commit)
9. Batch last — meta-operation dispatching `executeOperation` per entry with layout emission suppressed + single final emit; deletes the 290-line switch in canvas-operations.ts

Theme/annotations/code-graph/schema/prompt/trace endpoints are single-transport, low-duplication; they may stay legacy indefinitely.

## Verification (every slice)

1. `bun run typecheck`
2. Targeted: `PMX_CANVAS_DISABLE_BROWSER_OPEN=1 bun test tests/unit/operation-parity.test.ts tests/unit/mcp-tool-freeze.test.ts tests/unit/server-api.test.ts tests/unit/mcp-server.test.ts tests/unit/cli-node.test.ts tests/unit/canvas-operations.test.ts tests/unit/pmx-canvas-sdk.test.ts`
3. Full unit: `bun run test`
4. Milestones (after slices 1, 6, batch): `bun run test:web-canvas` + `bun run test:e2e-cli`

Safety nets already in place (committed before any registry code): `tests/unit/operation-parity.test.ts` (cross-surface parity, SSE counts, junk-key tolerance, pinned asymmetries) and `tests/unit/mcp-tool-freeze.test.ts` (69 tool names + 14 fixed resource URIs frozen).

Parity note: the parity test currently PINS the local-remove silent-success asymmetry. Slice 1 deliberately unifies it to a 404-style error on all surfaces; update that one pinned assertion in the same commit, with a CHANGELOG note.

## Risks

- zod strictness: schemas must be loose; parity test has junk-key cases.
- Route shadowing: segment-exact matching + registry self-test against known still-legacy paths.
- SSE drift: double emit / missing emit — parity test counts frames.
- MCP-against-remote: ensure at least one test exercises each migrated tool through RemoteCanvasAccess/HttpOperationInvoker (mcp-server.test.ts daemon mode covers this).
- Import cycles: operations/ never imports server.ts (emitter injected) or index.ts (SDK imports the cores).
- Batch is highest-risk: last, separately committed, one-commit revert.
