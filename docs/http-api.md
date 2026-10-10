# HTTP API reference

REST endpoints for all canvas operations + an SSE event stream. Works from
any language. Default base URL: `http://localhost:4313`.

`GET /health` includes `contracts: ["pmx-embedded-workbench-v4"]` when the daemon
enforces `expectedBoardId` and `expectedContentRevision` preconditions, bulk-write
fences/locks using validated geometry and affected automatic parent frames only,
and the `allowExternalMcp: false` operation restriction (including
deferred backend rehydration). The experimental MCP App requires this contract
when attaching to a daemon; package version equality alone is insufficient.

A non-empty request body that is not valid JSON returns
`400 { "ok": false, "error": "Malformed JSON body." }` on every route; empty
bodies are treated as an empty request. As of 0.4.0 every error response is a
JSON envelope of that same shape (`{ ok: false, error }`, status unchanged) —
no plain-text errors remain.

Node-create responses include `sizeAdjustment` when a frame dimension was
defaulted or raised to its node type's readability floor. It contains the
`requested` dimensions (`null` when omitted), the final `applied` dimensions,
and a `reason` (`defaulted`, `clamped-to-minimum`, or
`defaulted-and-clamped-to-minimum`; groups also use `fit-to-children`). `strictSize: true`
still bypasses the readability clamp, but omitted dimensions are reported as
defaulted. MCP create actions return the same size report.
Updates preserve explicit dimensions without applying creation floors; their
returned node `size` is the applied size. Omitted update dimensions retain the
existing size and are not reported as defaulted adjustments.

Both group-create routes report defaults or final child-derived dimensions, including
when children override supplied width/height because x/y were omitted. Explicit manual
frames retain their existing semantics. Group child replacement reports `fit-to-children`
when it changes the frame; `group.add` reports the previous frame as `requested` and
the final frame as `applied`. Reports survive compact/full MCP and batch responses.
External MCP app creation and web-artifact builds that open a node report their default
frames too; reusing an existing app node or building without opening does not report a
creation default. These reports describe the synchronous operation, not later browser
content auto-height or indirect parent-group reflow after editing a child.

## Board tours

- `GET /api/canvas/tour` → `{ tour: { stops: [...] }, derived: boolean, position: number | null }`
  (`position` is the stop being presented, or `null`).
- `POST /api/canvas/tour` with `{ "tour": { "stops": [...] } }` persists the tour;
  `{ "tour": null }` resets to derived group reading order. Returns `{ "ok": true }`.
- `GET /api/canvas/state` includes optional `tour`. Tour writes broadcast a layout
  update and are included in snapshots/undo. They are board-wide writes under a scope fence.
- `POST /api/canvas/tour/go` with `{ "stop": 2 }` or `{ "step": "next" | "previous" }`
  (plus optional `"present": false`) moves the shared tour cursor →
  `{ ok, index, total, stop }`; 400 when the stop does not exist or the board has no stops.
  Broadcasts `canvas-tour-step`; idle workbenches start presenting unless `present` is false.
- `POST /api/canvas/tour/exit` leaves presentation in every viewer (`canvas-tour-exit`).
- `POST /api/canvas/camera/move` with exactly one of `nodeId`, `rect: { x, y, width, height }`
  or `viewport: { x, y, scale }`, plus optional `duration`, `easing`, `padding`, `pullback`
  → `{ ok, stop, viewport }`. Broadcasts `canvas-camera-move`; browsers ease to the target in
  their real canvas area. `viewport` is the server's estimate from the last reported window
  size and is stored as the board viewport. 404 for an unknown node.

Tour steps and camera moves are navigation: no undo entry, no agent-presence write, no
scope-fence check.

The [tour model and recording walkthrough](cli.md#tour-and-presentation) describes
targets, duration, easing, padding, and pullback. Open `/workbench?present=1` to hide
chrome; camera movement is local to that viewer. Recording writes local files via
the CLI, not an HTTP job endpoint.

## Boards

A workspace holds many named boards; one is open at a time. Agent writes go to
the open board. While no board is open (Home), the first write opens the most
recently opened board, or creates one when the workspace has none;
`canvas.clear` on Home opens nothing. Agents can explicitly open a board using
`POST /api/canvas/boards/open`; verify the returned `activeBoardId` before writing.
This changes the shared workbench, not a private per-agent target. Only the
trusted workbench deletes a board — deletion requires both `x-pmx-workbench: 1` and the
per-boot `x-pmx-workbench-token` embedded in the served `/workbench` HTML;
the marker alone is not authority. Public HTTP integrations must not delete
boards. In-process SDK embedding hosts retain deletion authority.
Every change emits a
`boards-changed` SSE frame with `{ activeBoardId, boards }`.

`category` is a folder path, for example `Engineering/Canvas/Decisions`.
Home renders nested, collapsible folders and searches board names and paths.
Paths support up to eight levels, each with 1–60 characters; surrounding spaces
are trimmed. Empty segments and `.`/`..` are rejected. `null` or `""` unfiles a
board. Folders are derived from boards, so empty folders do not persist. Moving
a board changes its path, not its ID or content.

```bash
# List boards (most recently opened first) and which is open (null = Home)
curl http://localhost:4313/api/canvas/boards

# Read one board
curl http://localhost:4313/api/canvas/boards/<board-id>

# Create a board (optionally in a category) — it is NOT opened
curl -X POST http://localhost:4313/api/canvas/boards \
  -H "Content-Type: application/json" -d '{"name":"Q4 planning","category":"Planning"}'

# Preview/create an inactive copy from reusable cards (preview false creates)
curl -X POST http://localhost:4313/api/canvas/boards/from \
  -H "Content-Type: application/json" \
  -d '{"sourceBoardId":"board-source","name":"Follow-up","nodeIds":["node-1"],"includeReadme":true,"includeStructure":true,"preview":true}'

# Rename and/or file under a category on Home ("category": "" removes it)
curl -X PATCH http://localhost:4313/api/canvas/boards/<board-id> \
  -H "Content-Type: application/json" -d '{"name":"Q4 planning (final)","category":"Planning"}'

# Designate a Markdown card on this board as its README (null clears it)
curl -X PATCH http://localhost:4313/api/canvas/boards/<board-id> \
  -H "Content-Type: application/json" -d '{"readmeNodeId":"<markdown-node-id>"}'

# Pin a board into the agent's working set (its README and pinned cards reach every
# brief, whichever board is open; read-only context, never a write target), or unpin it.
# A repeat pin keeps its first attribution. Every board carries `pin` ({pinnedBy,
# pinnedAt, reason} or null).
curl -X POST http://localhost:4313/api/canvas/boards/<board-id>/pin \
  -H "Content-Type: application/json" -d '{"reason":"Q4 rests on it"}'
curl -X POST http://localhost:4313/api/canvas/boards/<board-id>/unpin

# Open a board, or Home with {"id":null} — also available to agents
curl -X POST http://localhost:4313/api/canvas/boards/open \
  -H "Content-Type: application/json" -d '{"id":"<board-id>"}'

# Delete a board and its snapshots — workbench only; deleting the open board returns to Home
curl -X DELETE http://localhost:4313/api/canvas/boards/<board-id> \
  -H "x-pmx-workbench: 1" -H "x-pmx-workbench-token: <token-from-served-workbench>"
```

## Backup and restore

A backup is one SQLite file holding every board, its snapshots and blobs,
written with `VACUUM INTO` (safe while the server runs) to
`canvas-<timestamp>.db` in the backup folder — by default `backups/` beside the
database (`.pmx-canvas/backups`). Keeping the newest `keep` (default 14)
removes older backups in that folder. The schedule is stored in the database
and runs inside the server. Not exposed over MCP.

```bash
# Folder, schedule, last backup and the backups on disk
curl http://localhost:4313/api/canvas/backup

# Back up now (optional folder and keep)
curl -X POST http://localhost:4313/api/canvas/backup \
  -H "Content-Type: application/json" -d '{"to":"/Users/me/Backups/pmx","keep":14}'

# Back up every 24h ("30m", "7d"; at least once a minute; "off" stops it)
curl -X POST http://localhost:4313/api/canvas/backup/schedule \
  -H "Content-Type: application/json" -d '{"every":"24h","keep":14,"to":"/Users/me/Backups/pmx"}'

# Replace every board with a backup; the current file is kept as canvas.db.before-restore.
# Refuses files that are not PMX Canvas databases, and the live database itself.
curl -X POST http://localhost:4313/api/canvas/backup/restore \
  -H "Content-Type: application/json" -d '{"file":"/Users/me/Backups/pmx/canvas-20260927T090000000Z.db"}'
```

## Static board export

One self-contained, read-only HTML file of one board (pan, zoom, expand) that
opens with no server or install. Cards render as escaped text; html cards,
charts, diagrams and built apps run in sandboxed iframes, with viewer bundles
stored once per file. Live MCP apps become placeholders; local file contents
are left out unless `includeFiles` is true. Files are written to `exports/`
beside the database. Built-app files are only embedded when they are regular,
bounded-size files inside the board's owned `.pmx-canvas/artifacts/` directory.
The preview manifest lists card links, remote images, and statically visible
network destinations in embedded HTML. Imported source-linked Markdown is also
excluded unless `includeDerivedText=true`, independently of `includeFiles`;
editing it does not remove that classification. Original attachment bytes are
never embedded in v1. Embedded scripts can make additional
network requests that cannot be inventoried in advance. Not exposed over MCP —
sharing is the human's act.

```bash
# What the file would contain (defaults to the open board; ?board=<id> for another)
curl "http://localhost:4313/api/canvas/export/preview?includeFiles=false&includeDerivedText=false"

# Write it → { path, url, bytes, manifest }
curl -X POST http://localhost:4313/api/canvas/export \
  -H "Content-Type: application/json" \
  -d '{"board":"<board-id>","includeFiles":false,"includeDerivedText":false}'

# Serve a written export (opaque-origin sandbox; ?download=1 as an attachment)
curl "http://localhost:4313/api/canvas/exports/<file>.html?download=1" -o board.html
```

## Agent-assisted document imports

PDF and Office uploads are raw bytes, not JSON. Upload requires the trusted
workbench token, an active captured board, a non-empty body of at most 20 MiB,
and creates both an original file card and an `attached` import. Requested x/y
coordinates are preserved when free; otherwise the original card is placed in
open space with a 48-unit gap, without moving existing cards. The import's
initial anchor follows the original card's actual position. The original
remains board-owned until board deletion; snapshot restore does not remove it,
and whole-database backups include it.

```bash
curl -X POST \
  "http://localhost:4313/api/canvas/attachments?boardId=<board-id>&name=report.pdf&mime=application/pdf&x=40&y=40" \
  -H "x-pmx-workbench-token: <token>" --data-binary @report.pdf

# Human-only: explicit consent asks the connected agent; captured board must be open
curl -X POST http://localhost:4313/api/canvas/imports/<import-id>/request \
  -H "Content-Type: application/json" -H "x-pmx-workbench: 1" \
  -H "x-pmx-workbench-token: <token>" \
  -d '{"consent":true}'

# Agent reads metadata and a controlled byte path; inline=true adds base64 only <=2 MiB
curl "http://localhost:4313/api/canvas/imports/<import-id>?inline=true"
curl http://localhost:4313/api/canvas/attachments/<attachment-id>/bytes -o source.bin

# Agent submits a reviewable draft (allowed even if another board is active)
curl -X POST http://localhost:4313/api/canvas/imports/<import-id>/submit \
  -H "Content-Type: application/json" \
  -d '{"sections":[{"title":"Summary","markdown":"...","reference":"page 1"}],"warnings":[],"agentDescription":"Extracted with the connected host PDF reader"}'

# Human-only review/commit; the original captured board must be open
curl -X POST http://localhost:4313/api/canvas/imports/<import-id>/commit \
  -H "x-pmx-workbench: 1" -H "x-pmx-workbench-token: <token>"
```

`GET /api/canvas/imports?boardId=...` lists jobs. An agent that cannot access or
interpret the source posts `{ "reason": "..." }` to
`/api/canvas/imports/:id/unavailable`; a human may later request a new attempt.
Humans can cancel requested or drafted jobs at `/cancel`. There is no bundled
converter, OCR, automatic agent launch, or guarantee for charts, scans, and
host-specific formats. A remote agent may need the human/host to transfer the
bytes before it can submit a draft.

## Canvas state

Read endpoints accept an optional `board=<board-id>` query parameter without
opening that board or changing where writes go. This is supported by
`/api/canvas/state`, `/api/canvas/node/:id`, `/api/canvas/summary`,
`/api/canvas/spatial-context`, and `/api/canvas/pinned-context`. Unknown boards
return 404. Omit `board` to read the active board. Live AX session/delivery reads
and fixed MCP resources continue to describe the open board.

```bash
# Get canvas state
curl http://localhost:4313/api/canvas/state

# Search the library (omit scope for the active board)
curl "http://localhost:4313/api/canvas/search?q=auth&limit=10&scope=library"

# Validate the current layout. Reports collisions, groupFrameOverlaps (a group
# frame covering a node that is not one of its members, nested members
# included — e.g. after a group auto-fits around enlarged children),
# containmentViolations, missingEdgeEndpoints, and advisory sizeWarnings.
curl http://localhost:4313/api/canvas/validate

# Inspect running-server schemas
curl http://localhost:4313/api/canvas/schema

# Validate a json-render spec without creating a node
curl -X POST http://localhost:4313/api/canvas/schema/validate \
  -H "Content-Type: application/json" \
  -d '{"type":"json-render","spec":{"root":"card","elements":{"card":{"type":"Card","props":{"title":"Preview"},"children":[]}}}}'

# Create a json-render node from a spec. `height` and `nodeHeight` are both
# accepted for the node frame (nodeHeight matches the graph/stream actions).
curl -X POST http://localhost:4313/api/canvas/json-render \
  -H "Content-Type: application/json" \
  -d '{"title":"Panel","nodeHeight":280,"spec":{"root":"card","elements":{"card":{"type":"Card","props":{"title":"Live"},"children":[]}}}}'

# For graph nodes, `height` is the chart's plot height, not the node frame.
# Set the frame with `nodeHeight` (`heightPx` in the SDK). A graph request that
# supplies only `height` gets the default frame height and a response warning.

# Validate an HTML primitive without creating a node
curl -X POST http://localhost:4313/api/canvas/schema/validate \
  -H "Content-Type: application/json" \
  -d '{"type":"html-primitive","kind":"choice-grid","data":{"items":[{"title":"A"}]}}'
```

## Nodes

```bash
# Add a node
curl -X POST http://localhost:4313/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"markdown","title":"Hello","content":"# World"}'

# Add an html node (sandboxed iframe)
curl -X POST http://localhost:4313/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"html","title":"Chart","summary":"Cost projection chart for the Q2 plan.","html":"<canvas id=\"c\"></canvas><script src=\"https://cdn.jsdelivr.net/npm/chart.js\"></script><script>/* ... */</script>"}'

# Add a generated HTML primitive as a sandboxed html node
curl -X POST http://localhost:4313/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"html-primitive","kind":"choice-grid","title":"Options","data":{"items":[{"title":"Small patch","summary":"Least disruption."}]}}'

# Opt an html node into AX. Top-level `html` AND `axCapabilities` are accepted on
# POST add and PATCH update (and may also be nested under `data`).
curl -X POST http://localhost:4313/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"html","title":"AX board","html":"<p>steering board</p>","axCapabilities":{"enabled":true,"allowed":["ax.steer"]}}'
```

A node creation request must resolve a `type` — pass it in the body (`{ "type":
... }`) or as a `?type=` query param. An empty / type-less body returns `400`
rather than silently creating a markdown node.

An optional `boardId` on node creation is a captured-board precondition, not a
switch command: if it no longer matches the active board, the request returns
`409` without creating a node or opening a board from Home. The file-drop UI
uses this to prevent delayed uploads from landing on a different board.

Operation-registry requests may also carry `expectedBoardId` (a board ID or
null for Home). A mismatch returns `409` before auto-opening a board or running
the operation. This is a precondition, not a board switch or permission grant.
`PATCH /api/canvas/node/:id` accepts optional `expectedContentRevision`, matched
against the node's top-level `contentRevision`; stale content returns `409`
without changing the node. Conditional edits cannot request webpage refresh.
The private MCP App uses these guards to reject stale board actions and note drafts.

Replacing a JSON-render node's `spec` preserves its current title; include `title`
to rename it explicitly. A new authored spec still resets the viewer's local drafts.

Mermaid nodes accept `data: { "fit": "contain" | "none" }` on both
`POST /api/canvas/node` and `PATCH /api/canvas/node/:id`. The default, `contain`,
shrinks overflowing diagrams without changing aspect ratio; `none` keeps 100%
with scrolling. [Mermaid sizing and readability](node-types.md#mermaid-nodes).

### File node content and bytes

A `file` node reads its file server-side. Text is stored on the node as
`data.fileContent` (with `data.lineCount`); `data.byteSize` is always set.
Non-text files are never decoded into mojibake — they carry `data.binary: true`
with no `fileContent`, plus `data.mimeType` when the type is known
(`application/pdf` for PDFs). A text file larger than 2 MB is stored truncated
with `data.truncated: true`.

```bash
# Repoint a file node at another file — content re-read, watcher rewired,
# edges/pins/position kept (recreating the node loses all three)
curl -X PATCH http://localhost:4313/api/canvas/node/node-abc123 \
  -H "Content-Type: application/json" \
  -d '{"path":"src/server/canvas-state.ts"}'
```

The title follows the new filename unless the node was renamed away from the
old one (or the patch sets `title` explicitly). Relative `path` values (including
`data.path` in batch updates) resolve against the configured canvas workspace,
not the daemon's working directory; the stored path is absolute. A missing or
unreadable target fails the update without changing the node or its existing watcher
(`400` for a direct PATCH; a failed-operation result in a batch).

```bash
# Raw bytes for a binary file node (PDF viewer, downloads)
curl http://localhost:4313/api/canvas/file-bytes?nodeId=node-abc123
```

The byte route is workspace-scoped: a file node whose path resolves outside the
workspace root returns `403`, and an unknown node id returns `404`.

## Edges

```bash
# Add an edge
curl -X POST http://localhost:4313/api/canvas/edge \
  -H "Content-Type: application/json" \
  -d '{"from":"node-1","to":"node-2","type":"flow","label":"next"}'

# Add an edge by unique search match instead of explicit IDs
curl -X POST http://localhost:4313/api/canvas/edge \
  -H "Content-Type: application/json" \
  -d '{"fromSearch":"DVT O3 — GitOps","toSearch":"deep work trend","type":"relation"}'
```

Search-based edge creation is intentionally strict: `fromSearch` and
`toSearch` must each resolve to exactly one node. Broad queries that match
multiple nodes fail; use the full visible title.

```bash
# Update an edge in place (label, type, style, animated) — empty label clears it
curl -X PATCH http://localhost:4313/api/canvas/edge/edge-123 \
  -H "Content-Type: application/json" \
  -d '{"label":"retries","type":"depends-on","style":"dashed"}'
```

Retyping an edge onto a from/to/type triple that already exists is refused
(400) — the same duplicate rule edge creation enforces.

## Annotations

```bash
# Add a freehand annotation. The default/currentColor stroke follows the active theme.
curl -X POST http://localhost:4313/api/canvas/annotation \
  -H "Content-Type: application/json" \
  -d '{"points":[{"x":100,"y":120},{"x":220,"y":120}],"color":"currentColor","width":4}'

# Remove an annotation
curl -X DELETE http://localhost:4313/api/canvas/annotation/ann-123
```

Agent-readable context reports annotation IDs, targets, and bounds. Use WebView
inspection or screenshots when the drawn shape matters.

## Viewport

```bash
# Set the camera transform (screen = world * scale + {x,y})
curl -X POST http://localhost:4313/api/canvas/viewport \
  -H "Content-Type: application/json" \
  -d '{"x":64,"y":96,"scale":0.8}'

# Centre world point (400, 300) in the visible canvas area at zoom 0.8
# (omit scale to keep the current zoom). Responds with the resulting viewport.
curl -X POST http://localhost:4313/api/canvas/viewport \
  -H "Content-Type: application/json" \
  -d '{"center":{"x":400,"y":300},"scale":0.8}'

# Fit selected nodes (omit nodeIds to fit the whole canvas)
curl -X POST http://localhost:4313/api/canvas/fit \
  -H "Content-Type: application/json" \
  -d '{"nodeIds":["node-1"],"width":1200,"height":700}'

# Focus without moving the camera
curl -X POST http://localhost:4313/api/canvas/focus \
  -H "Content-Type: application/json" \
  -d '{"id":"node-1","noPan":true}'
```

Viewport `x`/`y`, fit `width`/`height`, and fit padding are interpreted against
the **canvas area**, excluding the tool rail, top bar, and other surrounding
page chrome—not the full browser window.

`{x, y, scale}` is the transform of the canvas world inside the canvas area:
a world point `(wx, wy)` appears at canvas-area point `(wx * scale + x,
wy * scale + y)`. The canvas area starts right of the 52 px tool rail and below
the 44 px top bar in the default layout, so to put world `(wx, wy)` at browser
window point `(sx, sy)` send `x = sx - 52 - wx * scale` and
`y = sy - 44 - wy * scale`. `center` does this for the middle of the canvas
area, using the size the open workbench last reported (1440×900 when no tab has
reported one); it cannot be combined with `x`/`y`. Floating overlays inside the
canvas area (command bar, minimap) are not subtracted. Camera, fit, and focus-only requests
do not create or refresh agent writer presence. Use the explicit presence API
when an agent should publish a cursor or `focusNodeId`.

## Pins

```bash
# Pin nodes for agent context (mode: set | add | remove; default set). Each newly
# pinned node records who pinned it and when; an optional reason (max 280 chars)
# is kept with it and shown to the human on hover. Pins that stay keep their
# original attribution.
curl -X POST http://localhost:4313/api/canvas/context-pins \
  -H "Content-Type: application/json" \
  -d '{"nodeIds":["node-1","node-2"],"mode":"add","reason":"the chart the finding rests on"}'

# Get pinned context
curl http://localhost:4313/api/canvas/pinned-context

# Cross-board brief. budget is a UTF-16 character ceiling (default 16000, max 100000).
# Without since, the board/consumer cursor advances through only fully delivered revisions.
curl 'http://localhost:4313/api/canvas/context?consumer=codex&budget=16000'
```

`consumer` is optional. Supply a stable unique value only for a durable,
board-scoped cursor; without `consumer` or `since`, each request starts from the
beginning. An explicit `since` never advances a cursor. The brief is a map,
not a dump: an `overview` entry for the open board first, then pins, then each
pin's neighbours (reason `near`: up to five unpinned cards within 600 px, nearest
first, with `near: { pinNodeId, pinTitle }`), then relevant current-board changes
and asks, then pinned boards (reason `pinned-board`: the board and its pinned
cards), then compact linked or same-folder board context. Cards arrive as title,
a short summary (`summaryOnly: true`) and their relations; a pin puts a card
first, it does not send its full text. On a later read a changed card lists what changed in
`changes` (`text`, `links` or both) and marks relations drawn or changed since the cursor,
e.g. `(new, by a person)`. Every item carries source board/card IDs:
use them with the board/node read route to pull a card in full when you need it,
rather than guessing from the summary. Reading inactive boards does not open them.

## AX context and focus

AX context is the host-agnostic agent-experience layer. It combines existing
context pins with a persisted focus node set that adapters can inject into
their native prompt/context hooks.

The context response includes `boardId` (`null` on Home), captured with its content
and pins. Adapters should send that ID when recording a proxied context read, rather
than looking up whichever board is active after delivery.

```bash
# Get persisted AX state
curl http://localhost:4313/api/canvas/ax

# Get agent-readable pinned + focused context
curl http://localhost:4313/api/canvas/ax/context

# Set AX focus
curl -X POST http://localhost:4313/api/canvas/ax/focus \
  -H "Content-Type: application/json" \
  -d '{"nodeIds":["node-1"],"source":"api"}'

# Patch AX focus through the state endpoint
curl -X PATCH http://localhost:4313/api/canvas/ax \
  -H "Content-Type: application/json" \
  -d '{"focus":{"nodeIds":["node-1"],"source":"api"}}'
```

## AX primitives (timeline, work, host)

Host-agnostic agent-experience primitives across three state partitions.
Canvas-bound state (work items, approval gates, review annotations) rides
canvas snapshots; timeline state (events, evidence, steering) persists for
diagnostics but is retention-bounded and not restored by snapshots; the host
capability is reported by adapters and survives `canvas_view { action: "clear" }`.

```bash
# Timeline — record a normalized agent-event
curl -X POST http://localhost:4313/api/canvas/ax/event \
  -H "Content-Type: application/json" \
  -d '{"kind":"tool-start","summary":"ran tests","source":"api"}'

# Timeline — send a steering message; `target` addresses ONE consumer, omit to broadcast
curl -X POST http://localhost:4313/api/canvas/ax/steer \
  -H "Content-Type: application/json" \
  -d '{"message":"focus on the failing test first","source":"api","target":"copilot"}'

# Timeline — record an evidence item (logs/tool-result/screenshot/file/diff/test-output)
curl -X POST http://localhost:4313/api/canvas/ax/evidence \
  -H "Content-Type: application/json" \
  -d '{"kind":"test-output","title":"unit pass","source":"api"}'

# Timeline — read the bounded timeline (default limit 50, max 200)
curl "http://localhost:4313/api/canvas/ax/timeline?limit=50"

# Context reads — which canvas context each agent read, and whether its pinned
# nodes were in what came back (newest first, default 50, max 500; the per-consumer
# summary covers the whole retained log of 5,000 reads). Agent reads of pinned
# context, AX context, AX state, summary, spatial context and layout are recorded
# automatically, as are individual GET /api/canvas/node/:id reads (only the
# delivered node). The workbench's own reads are not. A projecting client may
# pass contextDelivery=false on node GET to avoid marking unseen content read.
curl "http://localhost:4313/api/canvas/ax/context-reads?limit=50"

# Read status — per node on a board (default: the open board), the latest agent
# read that delivered its content: when, who, and the content revision it had.
# A node whose current contentRevision is newer was changed since it was read.
# pins maps each pinned node with a known pinner to { pinnedBy, pinnedAt, reason }.
# board is the latest agent read on that board of any kind ({ lastReadAt, lastReadBy } or
# null): a pinned board whose map reached an agent reads as read even before any card is pulled.
# A brief's card summaries mark nothing read; only a full pull of a card does.
# links maps each node to the newest linksRevision any read carried (summaries count, since a
# brief summary carries the card's relations). An edge whose revision is newer than both
# ends' links value has not been seen by an agent; the workbench marks it on the link's pill.
curl "http://localhost:4313/api/canvas/ax/context-status?board=<board-id>"

# Context reads — a proxy (an MCP server attached to this daemon, a host adapter)
# records the read its agent actually made. Its own fetches send
# `x-pmx-proxied-read: 1` so they are not recorded twice.
# Pass boardId captured at read time (null for Home); omitting it uses the
# currently open board. MCP bytes measure the final formatted text response.
# readNodeIds lists every serialized node in what the agent received (pinned or
# not); the server keeps those on the board and stamps their revisions. Omitted,
# it defaults to deliveredNodeIds. seenNodeIds adds the nodes that arrived only as
# summaries, which marks their links seen; omitted, it defaults to readNodeIds.
curl -X POST http://localhost:4313/api/canvas/ax/context-reads \
  -H "Content-Type: application/json" \
  -d '{"channel":"adapter","resource":"copilot:prompt-context","consumer":"copilot","pinnedNodeIds":["node-1"],"deliveredNodeIds":["node-1"],"bytes":2048}'

# Canvas-bound — add / update a work item
curl -X POST http://localhost:4313/api/canvas/ax/work \
  -H "Content-Type: application/json" \
  -d '{"title":"Wire up auth","status":"in-progress","nodeIds":["node-1"],"source":"api"}'
curl -X PATCH http://localhost:4313/api/canvas/ax/work/<id> \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'
curl http://localhost:4313/api/canvas/ax/work

# Canvas-bound — request / resolve an approval gate (pending → approved/rejected/held)
curl -X POST http://localhost:4313/api/canvas/ax/approval \
  -H "Content-Type: application/json" \
  -d '{"title":"Deploy to prod","action":"deploy.prod","ttlMs":300000,"source":"api"}'
curl -X POST http://localhost:4313/api/canvas/ax/approval/<id>/resolve \
  -H "Content-Type: application/json" \
  -d '{"decision":"approved","source":"api"}'
curl http://localhost:4313/api/canvas/ax/approval
# Unattended-approval policy: a gate nobody answers within its TTL (default
# PMX_CANVAS_GATE_TTL_MS = 5 min, max 24 h) resolves to `held` — the action does
# NOT proceed, an awaiting agent is released with a non-approval, and a
# `policy` agent-event explains why. Reopen it (fresh TTL) from the session
# panel or here; this is the human's path, not an MCP tool.
curl -X POST http://localhost:4313/api/canvas/ax/approval/<id>/reopen \
  -H "Content-Type: application/json" -d '{"source":"browser"}'

# Canvas-bound — add a review annotation (comment/finding) anchored to node/file/region
curl -X POST http://localhost:4313/api/canvas/ax/review \
  -H "Content-Type: application/json" \
  -d '{"body":"off-by-one","kind":"finding","severity":"error","anchorType":"file","file":"src/x.ts","source":"api"}'
curl http://localhost:4313/api/canvas/ax/review

# Host/session — report and read host capability
curl -X PUT http://localhost:4313/api/canvas/ax/host-capability \
  -H "Content-Type: application/json" \
  -d '{"host":"copilot","canvas":true,"sessionMessaging":true,"source":"api"}'
curl http://localhost:4313/api/canvas/ax/host-capability
```

Validation: `/ax/event` requires a valid `kind` + `summary` (400 otherwise);
`/ax/evidence` requires `kind` + `title`; `/ax/steer`, `/ax/work`,
`/ax/approval`, `/ax/review` require their primary field; `POST`/`PATCH /ax/work`
reject an unknown `status` with 400 (the tokens are `todo`, `in-progress`,
`blocked`, `done`, `cancelled` — hyphens, not underscores); `PATCH /ax/work/:id`
and `PATCH /ax/review/:id` return 404 for unknown IDs; approval resolve returns
404 if the gate is missing or already resolved.

## Agent presence

Who is writing to the board right now, in what phase, and whether a session
is attached. Presence is *derived*: every agent-originated mutation (anything
without the workbench's own `x-pmx-workbench: 1` marker) registers its caller
as a `tooling` writer, the activity feed drives attach/detach and phase
(`session-start`, `session-end`, `tool-start`, `tool-result`), and adapters
with richer hooks can set a phase, cursor, or focus explicitly. Writers fade
5 min after their last write; attached sessions expire after 30 min of quiet
without a `session-end`.

```bash
# Read the snapshot (the browser does this on connect)
curl http://localhost:4313/api/canvas/ax/presence
# → { ok, presences: [{ sessionId, source, agentId, label, phase, detail,
#      focusNodeId, cursor, attached, opCount, contextUsage, lastSeenAt }],
#     sessionActive,
#     activity: [{ id, at, sessionId, label, op, summary, nodeId }] }  # newest first, last 50

# Attach a session and report a phase (idle | thinking | tooling | waiting-approval)
curl -X POST http://localhost:4313/api/canvas/ax/presence \
  -H "Content-Type: application/json" \
  -d '{"source":"copilot","attached":true,"phase":"thinking","detail":"planning"}'

# Point the agent cursor at a node, then detach
curl -X POST http://localhost:4313/api/canvas/ax/presence \
  -H "Content-Type: application/json" \
  -d '{"source":"copilot","focusNodeId":"<node-id>","cursor":{"x":320,"y":140}}'
curl -X POST http://localhost:4313/api/canvas/ax/presence \
  -H "Content-Type: application/json" -d '{"source":"copilot","attached":false}'
```

`sessionActive` is true when any presence is attached — it is the single gate
for the agent chrome (session panel, command bar, presence layer). Live but
unattached writers are the *external steering* case: the browser shows a
passive top-bar indicator (writers + op count) with an activity feed and a
connected-writers sheet — visibility only, never permissions. `activity` is
that feed: one entry per agent write with a human summary ("Created markdown
“Release plan”"), attributed to the writer (re-attributed to the session when
a transport writer folds into it), bounded to the last 50 and kept after a
writer fades. Detaching (`attached: false`, `session-end`) removes the
presence outright — an ended session never lingers as an external writer.

**The context summary shows a cost, not a budget.** The top bar's context
summary shows what the brief costs, as ≈ tokens (about four characters per
token). There is no share, meter or clipped state: a brief longer than one page
continues on the next read. A host that knows how many tokens its agent holds
reports it on the presence (`contextUsage: { used, total }` on
`POST /api/canvas/ax/presence` / `set-presence`); the context panel then also
names that count ("Copilot’s whole context holds 42.8k tokens"). The
bundled Copilot extension reports it from the SDK's `session.usage_info`
event (root agent, coalesced to one report per 500 ms); the legacy
`context-usage` workbench event feeds the single attached session the same
way.

```bash
curl -X POST http://localhost:4313/api/canvas/ax/presence \
  -H "Content-Type: application/json" \
  -d '{"source":"copilot","contextUsage":{"used":42800,"total":128000}}'
```

**Writer identity and attribution.** Plain HTTP callers read as source `api`,
the CLI sends `x-pmx-source: cli`, the MCP server sends `mcp` (or
`PMX_CANVAS_AGENT_SOURCE` when set), the SDK is `sdk`. Those are *transport*
labels, not agents — so while exactly one session is attached, a transport
write with no `agentId` is attributed to that session: its cursor moves to
the touched node, its phase reads `tooling`, and no second writer appears.
This is what lets a Copilot/Codex/Claude Code session that writes through MCP
keep one cursor. Pass `agentId` (sub-agents) or a host label to keep a writer
separate; with several sessions attached, transport writes stay on their own
label. A session the human started (*Start agent session*, `source: "browser"`)
is a placeholder for whichever agent comes next: it absorbs agent-less writes
under *any* label — a host label included — and takes that agent's name. If
exactly one such writer is already on the board when the human starts the
session, it is adopted on the spot. One agent arriving over two channels —
an adapter presence plus its own MCP server, both announcing the same label —
merges into one session at attach, and the merged channel's writes and detach
keep landing on it.

**Session lifecycle: pre-session snapshot and receipt.** When a session
attaches (`attached: true`, or `session-start` on the activity feed) over a
non-empty board, the server saves a snapshot named
`Before session · <label> · HH:MM` — the board before the agent touched it.
When that session ends (`attached: false`, `session-end`, or the idle expiry)
the stream carries one `agent-session-ended` frame:

```json
{ "label": "Copilot", "parentAgentId": null, "endedAt": "…", "endedBy": "agent",
  "unchanged": false, "counts": { "items": 4, "done": 3, "cancelled": 1, "rejected": 0, "held": 0 },
  "snapshot": { "id": "…", "name": "Before session · Copilot · 14:00" },
  "context": { "read": [{ "id": "…", "title": "Brief" }], "pinned": [{ "id": "…", "title": "Chart", "reason": "…" }],
               "created": [], "edited": [], "changedSinceRead": [{ "id": "…", "title": "Brief" }] } }
```

`context` is what the session did with the board's context: nodes whose content an
agent read since the session attached, pins the agent made (with their reason), nodes
it created and edited (against the pre-session snapshot), and pinned nodes changed
after their latest read. A session that only read or pinned is not `unchanged`.

`items`/`done` count the work items on the board; cancelled items, rejected
gates, and held gates have separate counts. `snapshot` is null when the board was
empty at attach or unchanged at end (the redundant snapshot is removed).
The browser shows a receipt only for a changed top-level session: `unchanged: true`
and worker endings (`parentAgentId` set) never open, replace, or extend a popup —
the orchestrator's receipt covers the board since it attached. An empty
board that stays empty is unchanged too. This only filters the popup: session-end
events, timeline records, and changed-session snapshots remain available.
There is at most one receipt. Qualifying endings that arrive while it is up merge
into it ("3 sessions ended", their labels, the union of their context); a merged
receipt has no *View diff* and points to History, which keeps each session's
snapshot. The receipt is kept until dismissed so restore/diff actions do not
disappear on a timer. A single session's *View diff* is `GET /api/canvas/snapshots/<id>/diff` against that
snapshot, and restoring the snapshot undoes the session. Adapters should end their session
explicitly so the human gets the receipt promptly rather than after the idle
expiry. The browser's *Start agent session* button is this same endpoint
(`source: "browser"`, `attached: true`) — subsequent agent-less writes are
attributed to that session, and the first named agent renames it.

## Human presence (collaborators)

Every open workbench tab reports itself; the server fans the set out as
`human-presence` SSE frames so tabs see each other's cursors. A node a human
is holding (dragging) is an edit lock: an agent write targeting it is refused
with **409** ("being edited by <name> — requeue") until the grab is released
or goes stale (8 s without renewal). Membership changes count as targeting the
member: dissolving the group a held node belongs to (`group.remove`, or
`node.remove` on the group) or pulling it into another group is refused the
same way. Human heartbeats never count as agent activity.

```bash
curl http://localhost:4313/api/canvas/human-presence
# → { ok, humans: [{ clientId, name, cursor, grabbingNodeId, lastSeenAt }] }
curl -X POST http://localhost:4313/api/canvas/human-presence \
  -H "Content-Type: application/json" -H "x-pmx-workbench: 1" \
  -d '{"clientId":"tab-1","name":"mia","cursor":{"x":320,"y":140},"grabbingNodeId":"<node-id>"}'
```

## Scope fence (agent writes)

The policy's `scope` limits what an attached agent may WRITE: existing-node
writes must target fenced nodes, new nodes must land inside the fenced
nodes' bounding box plus `padding` px (default 40), and board-wide writes
(arrange, clear, restore) are refused. Every refusal is HTTP 403 with a reason
naming the node or position. Reads are never fenced, nor are the human's own
workbench writes. A fence is a granted region: a group id in `nodeIds` expands
to the frame plus every member (nested groups included) when the scope is set.
The fence is visible to the agent in `canvas://ax-context` (`policy.scope`) and
drawn on the canvas while a session is attached.

The fence belongs to the human: only workbench calls (`x-pmx-workbench: 1`) may
set, replace, or clear `scope`. An agent call to `POST /api/canvas/ax/policy`
that includes `scope` is refused with 403, and the MCP `set-policy` action does
not take it.

```bash
# Grant (replace semantics) and clear — workbench calls
curl -X POST http://localhost:4313/api/canvas/ax/policy \
  -H "Content-Type: application/json" -H "x-pmx-workbench: 1" \
  -d '{"scope":{"nodeIds":["<node-a>","<node-b>"],"padding":40},"source":"browser"}'
curl -X POST http://localhost:4313/api/canvas/ax/policy \
  -H "Content-Type: application/json" -H "x-pmx-workbench: 1" -d '{"scope":null}'
```

## AX interactions, delivery, elicitation, mode, commands & policy

Node interactions are one normalized, capability-gated envelope that maps onto an
AX operation. The server re-validates every interaction against the source node's
effective capabilities and clamps sandboxed surfaces (`html-node`, `mcp-app`,
`json-render`) to their own node.

```bash
# Node interaction — one envelope, validated + mapped to the matching AX op
curl -X POST http://localhost:4313/api/canvas/ax/interaction \
  -H "Content-Type: application/json" \
  -d '{"type":"ax.work.create","sourceNodeId":"node-1","payload":{"title":"Wire auth"}}'

# Delivery — claim pending steering for a consumer (loop-safe), then mark delivered.
# The claim returns broadcasts plus steering addressed to THIS consumer; a claim
# with no `consumer` sees broadcasts only. With several agents connected, the
# browser composer offers a target picker fed by live presence — always claim
# with your own label or addressed steering never reaches you.
curl "http://localhost:4313/api/canvas/ax/delivery/pending?consumer=copilot&limit=20"

# Long-poll: `waitMs` parks the request until steering for this consumer
# arrives or the timeout elapses (capped at 120000ms) — the reactive loop for
# hosts whose model only runs while the host gives it a turn. Loop on this
# instead of tight polling.
curl "http://localhost:4313/api/canvas/ax/delivery/pending?consumer=copilot&waitMs=120000"
# Marks are PER CONSUMER for broadcasts: your mark removes the message from
# YOUR queue only — every other consumer still receives it ("all workers:
# stop" reaches the whole fleet). Addressed steers stay single-recipient
# compare-and-set; a consumer-less mark is the anonymous global ack.
curl -X POST http://localhost:4313/api/canvas/ax/delivery/<steering-id>/mark \
  -H "Content-Type: application/json" \
  -d '{"consumer":"copilot"}'

# Per-agent territories (fleet orchestration): fence a worker to its lane.
# An agent may fence OTHER writers, never its own key; the human may set any.
curl -X POST http://localhost:4313/api/canvas/ax/policy \
  -H "Content-Type: application/json" \
  -d '{"agentScopes":{"run1:impl":{"nodeIds":["node-a"],"padding":80}}}'

# Elicitation — request structured human input, then respond
curl -X POST http://localhost:4313/api/canvas/ax/elicitation \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Who owns this migration?","fields":["owner"],"source":"api"}'
curl -X POST http://localhost:4313/api/canvas/ax/elicitation/<id>/respond \
  -H "Content-Type: application/json" \
  -d '{"response":{"owner":"alice"}}'
curl http://localhost:4313/api/canvas/ax/elicitation

# Mode — request a plan/execute/autonomous transition, then resolve
curl -X POST http://localhost:4313/api/canvas/ax/mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"plan","reason":"scope the change first","source":"api"}'
curl -X POST http://localhost:4313/api/canvas/ax/mode/<id>/resolve \
  -H "Content-Type: application/json" \
  -d '{"decision":"approved"}'
curl http://localhost:4313/api/canvas/ax/mode

# Activity ingestion — forward an agent tool/session event; the board auto-reacts
# (kind-driven, overridable: failure → work item + review + evidence; tool-result
# + outcome:"success" → evidence). Set a reaction to false to suppress it.
curl -X POST http://localhost:4313/api/canvas/ax/activity \
  -H "Content-Type: application/json" \
  -d '{"kind":"failure","title":"tsc failed","summary":"type error in x.ts","nodeIds":["node-1"],"source":"api"}'

# Blocking gate read — read one gate, or long-poll with ?waitMs until the human
# resolves it in the browser (gates that actually gate). Returns { <primitive>, pending }.
curl "http://localhost:4313/api/canvas/ax/approval/<id>"                 # immediate read
curl "http://localhost:4313/api/canvas/ax/approval/<id>?waitMs=30000"    # blocks ≤30s / until resolved
curl "http://localhost:4313/api/canvas/ax/elicitation/<id>?waitMs=30000"
curl "http://localhost:4313/api/canvas/ax/mode/<id>?waitMs=30000"

# Context — optional ?consumer= filters the compact, loop-safe `delivery` lead block
# (undelivered steering + open work/approvals it can act on) for per-turn injection.
# `delivery.pendingSteering` is NEWEST-first (most recent first), capped at 10, so a
# fresh steer is visible even behind a backlog; `delivery.totalPending` /
# `delivery.omittedPending` report how many more are queued. Drain the full FIFO
# (oldest-first) backlog via /api/canvas/ax/delivery/pending when omittedPending > 0.
curl "http://localhost:4313/api/canvas/ax/context?consumer=copilot"

# Commands — list the registry, invoke a command (records a `command` agent-event)
curl http://localhost:4313/api/canvas/ax/command
curl -X POST http://localhost:4313/api/canvas/ax/command \
  -H "Content-Type: application/json" \
  -d '{"name":"pmx.plan","args":{"note":"draft a plan"},"source":"api"}'

# Policy — read / patch the canvas-bound tool/prompt policy (patches merge)
curl http://localhost:4313/api/canvas/ax/policy
curl -X POST http://localhost:4313/api/canvas/ax/policy \
  -H "Content-Type: application/json" \
  -d '{"tools":{"excluded":["shell"]},"prompt":{"mode":"concise"},"source":"api"}'
```

Validation: `/ax/interaction` returns `{ ok: false, code }` (403 `ax-disabled` /
`not-allowed`, 400 `invalid-payload` / `unknown-command`, 404 `unknown-node`);
`/ax/command` rejects an unknown command name with 400; `/ax/elicitation/:id/respond`
and `/ax/mode/:id/resolve` return 404 for unknown IDs; `/ax/activity` requires a
valid `kind` + `title` (400 otherwise); the single-item gate GETs return 404 for
unknown IDs and clamp `?waitMs` to ≤120000.

## Ghost Cursor intents (ephemeral)

Intents are verb-routed over HTTP — there is **no `action` field**. That
discriminator exists only on the MCP `canvas_intent` composite; `POST` always
signals a *new* intent, so a body like `{"action":"clear"}` is rejected by the
registry's kind validation. Pick the operation by method + path:

```bash
# Signal a ghost — returns { ok, intent } with the id. Auto-expires after ttlMs
# (default 8000, max 60000), so cleanup is optional.
curl -X POST http://localhost:4313/api/canvas/ax/intent \
  -H "Content-Type: application/json" \
  -d '{"kind":"create","nodeType":"markdown","label":"Add evidence","reason":"collecting run logs"}'
# A create may omit "position": the ghost forms where the canvas will auto-place
# the node (returned in intent.position), and a create linked by intentId with no
# x/y lands there. Pass "position" only when you know where the node goes.

# Update the ghost (position/label/reason/confidence/ttlMs; vetoed:true dissolves
# it AND poisons the id so a later linked settle is rejected)
curl -X PATCH http://localhost:4313/api/canvas/ax/intent/<id> \
  -H "Content-Type: application/json" \
  -d '{"position":{"x":520,"y":300},"reason":"moved next to the trace"}'

# Clear the ghost: plain DELETE dissolves it; settle it into the real node it
# became via settledNodeId, or veto it. Fields are accepted as JSON body or
# query params (?vetoed=true/false is coerced; other values are rejected 400).
curl -X DELETE http://localhost:4313/api/canvas/ax/intent/<id>
curl -X DELETE "http://localhost:4313/api/canvas/ax/intent/<id>?settledNodeId=node-42"
curl -X DELETE "http://localhost:4313/api/canvas/ax/intent/<id>?vetoed=true"
```

## Live work board

```bash
# Materialize (or refresh) the one board node showing all AX work items by status.
curl -X POST http://localhost:4313/api/canvas/workboard \
  -H 'Content-Type: application/json' -d '{}'
```

The board is a `json-render` node tagged `data.workboard: true`. Repeat calls
are idempotent (`created: false`) and the board refreshes itself whenever a
work item changes — no polling needed.

## Diagrams (Excalidraw preset)

```bash
curl -X POST http://localhost:4313/api/canvas/diagram \
  -H "Content-Type: application/json" \
  -d '{"elements":[{"type":"rectangle","id":"r1","x":60,"y":60,"width":180,"height":80,"roundness":{"type":3},"backgroundColor":"#a5d8ff","fillStyle":"solid","label":{"text":"Hello","fontSize":18}}],"title":"Diagram"}'
```

## SSE event stream

```bash
curl -N http://localhost:4313/api/workbench/events
```

The browser, the CLI `watch` command, and the MCP resource notifications
all consume this stream. Auto-reconnect with exponential backoff.

`agent-presence` frames carry the full presence snapshot (the same body as
`GET /api/canvas/ax/presence`) on every change, including TTL expiry — a
client never needs its own expiry timer. `agent-session-ended` carries the
session receipt (see [Agent presence](#agent-presence)). `context-status-changed`
(`{ boardId }`) says an agent read landed; the workbench refetches
`GET /api/canvas/ax/context-status`. It is never an MCP notification, so a read
cannot cause more reads.

Every frame's payload is wrapped in an envelope that sets `sessionId` (the
workbench session, used for reconnect/reload detection) and `timestamp` —
payload keys of those names are overwritten, so event bodies never use them.

## Polling transport (proxy-safe)

Some proxies (e.g. the Amp orb portal) buffer streaming responses and only
flush them on close, so the SSE stream above delivers nothing. The polling
transport returns the same events as short-lived JSON responses that pass
through any proxy:

```bash
# No `since`: a full connect snapshot (same events an SSE connect sends) + the
# current cursor. With `since=<seq>`: only events after that cursor.
curl "http://localhost:4313/api/workbench/poll"
curl "http://localhost:4313/api/workbench/poll?since=42"
```

Responses are `{ ok, transport: "poll", snapshot, seq, events }` — poll again
with `since=<seq>` every couple of seconds. A `since` from a previous server
run or one that fell off the bounded event ring recovers with a fresh
snapshot. The browser client uses this automatically: if the SSE stream
produces no event within 3 seconds of connecting, it switches to polling (and
tells the boot screen to wait for the fallback instead of alarming). Pages
served by an Amp orb (`AMP_ORB` set — the same stamp that drives srcdoc mode)
skip SSE entirely and default straight to polling. Force a transport with
`/workbench?transport=poll` (or `transport=sse` to disable the fallback /
override the orb default).

## Session theme override (host-default theming)

`/workbench?theme=<name>` gives that browser session its own theme without
touching the server-global theme other clients see — embedding hosts use it to
match their chrome (the bundled Copilot extension opens `?theme=daylight`).
`?theme=auto` follows the host's `prefers-color-scheme` live. Picking a theme
from the toolbar ends the override and saves globally as usual.

## Iframe embed probe (nested-iframe hosts)

Some hosts embed the canvas page itself inside an iframe (the Amp orb portal
does), and Chrome then refuses to load child iframes from `src` URLs — even
same-origin ones — so iframe-backed nodes would show a broken placeholder.
When (and only when) the canvas page detects it is embedded, it probes the
real behavior at boot by loading a hidden iframe against:

```bash
curl http://localhost:4313/api/canvas/iframe-probe
```

If that iframe never loads, the client switches every same-origin surface
(HTML nodes, graph/json-render viewers, frame documents) to `fetch()` +
`srcdoc` inline rendering. External app URLs stay on `src` — they cannot be
fetched cross-origin. Force a mode with `/workbench?iframe-mode=srcdoc` (or
`iframe-mode=src`).

In Amp orbs the probe itself is unreliable (a tiny probe iframe can load even
though node-sized ones will not), so when the server runs with `AMP_ORB` set
(orb services always do) it stamps `window.__PMX_AMP_ORB` into the page and
the embedded client forces `srcdoc` without probing. HTML surface documents
also inline their theme stylesheet, so srcdoc-rendered surfaces stay styled
without any subresource load.

`/api/canvas/frame-documents/:id` also answers `HEAD`, which the browser uses
after every reconnect to detect frame documents lost to a server restart and
re-mint them automatically (Finding S).

## Time travel

```bash
curl -X POST http://localhost:4313/api/canvas/undo
curl -X POST http://localhost:4313/api/canvas/redo
curl http://localhost:4313/api/canvas/history
# → { text, entries: [{ id, timestamp, description, actor, operationType, isCurrent, isUndone }],
#     top: { …the entry undo would revert next… } | null, canUndo, canRedo }
```

One shared undo stack, agent and human alike. Each entry's `actor` is `human`
for workbench writes (`x-pmx-workbench: 1`) and `agent` for everything else;
`top` is what the next undo reverts. The session panel uses this to offer
"undo this edit" on the agent's latest board write and tells the agent through
steering when the human takes it.

## WebView automation

```bash
# Start WebView automation
curl -X POST http://localhost:4313/api/workbench/webview/start \
  -H "Content-Type: application/json" \
  -d '{"backend":"chrome","width":1280,"height":800}'

# Evaluate JS in the active WebView session
curl -X POST http://localhost:4313/api/workbench/webview/evaluate \
  -H "Content-Type: application/json" \
  -d '{"expression":"document.title"}'

# Resize the active WebView session
curl -X POST http://localhost:4313/api/workbench/webview/resize \
  -H "Content-Type: application/json" \
  -d '{"width":1440,"height":900}'

# Capture a screenshot
curl -X POST http://localhost:4313/api/workbench/webview/screenshot \
  -H "Content-Type: application/json" \
  -d '{"format":"png"}' \
  --output canvas.png
```

## Batch operations

Build a canvas in one shot. Earlier results can be referenced from later
operations via `$assigned-name.field`.

```bash
curl -X POST http://localhost:4313/api/canvas/batch \
  -H "Content-Type: application/json" \
  -d '{"operations":[{"op":"node.add","assign":"a","args":{"type":"markdown","title":"A"}},{"op":"group.create","args":{"title":"Frame","childIds":["$a.id"]}}]}'
```

Supported operations:

- `node.add`, `node.update`
- `graph.add`
- `edge.add`
- `group.create`, `group.add`, `group.remove`
- `pin.set`, `pin.add`, `pin.remove`
- `snapshot.save`
- `arrange`

`node.add` supports `type: "webpage"` inside batch. The batch itself still
succeeds when the webpage node is created but the fetch fails; the
per-operation result includes `fetch: { ok, error? }` plus a top-level
`error` field for the fetch problem.

Example with assignments:

```json
{
  "operations": [
    {
      "op": "graph.add",
      "assign": "wins",
      "args": {
        "title": "Major wins",
        "graphType": "bar",
        "data": [
          { "label": "Docs", "value": 5 },
          { "label": "Tests", "value": 8 }
        ],
        "xKey": "label",
        "yKey": "value"
      }
    },
    {
      "op": "group.create",
      "assign": "frame",
      "args": {
        "title": "Quarterly graphs",
        "childIds": ["$wins.id"]
      }
    }
  ]
}
```
