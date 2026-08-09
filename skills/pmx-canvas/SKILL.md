---
name: pmx-canvas
description: >
  Spatial canvas workbench for visual thinking — nodes, edges, groups on an infinite 2D canvas
  with pan/zoom, minimap, and real-time sync. Use this skill whenever you need to lay out
  information spatially: investigation boards, architecture diagrams, dependency maps, task plans,
  status dashboards, file relationship views, or any scenario where a flat list or text wall
  isn't enough. Also use when the user mentions "canvas", "board", "diagram", "spatial layout",
  "visual map", "node graph", or wants to see how things connect. The canvas is your extended
  working memory — pin nodes to curate context, read spatial arrangement to understand intent.
---

# PMX Canvas

PMX Canvas is a server-authoritative spatial workbench controlled through MCP, HTTP, or the CLI.
Humans curate agent context by pinning nodes; agents read that curation through
`canvas://pinned-context`. State survives browser refresh.

## Required Operating Sequence

0. **After a `pmx-canvas` upgrade, refresh this skill first.** Run
   `pmx-canvas skills sync --yes` (`--check` to detect drift; exit 1 when stale) — it finds the skill
   copies already installed in the workspace (whatever layout your agent uses) and replaces the
   complete trees from the package, references/evals/fixtures included. Sync ONLY from the
   installed package, never from a source checkout: this skill documents the runtime it ships
   with, and a newer repo skill paired with an older installed runtime advertises commands and
   themes the binary does not have (0.4.3 report skew finding). Also restart the HTTP daemon and
   any `--mcp` processes; Bun does not hot-reload a running process.
1. **Open or focus the workbench before mutating.** Reuse one visible canvas surface for the
   session.
2. **Verify workspace identity.** Read `GET /health` or `pmx-canvas serve status`; the returned
   `workspace` must equal the intended absolute workspace root. A healthy listener on port 4313
   may belong to another project.
3. **Read before write.** Search with `canvas_query { action: "search", query }` before creating
   nodes. Read the full layout only when necessary. The MCP parameter is `query` — passing the
   HTTP API's `q` is silently ignored and returns zero results.
4. **Snapshot before destructive changes.** Use `canvas_snapshot { action: "save", name }` before
   clear, restore, or a major
   reorganization.
5. **Show intent with the Ghost Cursor — by default.** Signal with
   `canvas_intent { action: "signal", ... }` before every meaningful create, move, connect, remove,
   or edit, then pass the returned `intent.id` as `intentId` on the mutation so the ghost settles
   into the result. Use it as much as possible to make your next move and your work visible: the
   human watches intent form and can veto mid-thought. Skip it only for trivial in-place tweaks or
   high-frequency batch churn. The default TTL (~8s) expires between agent turns: signal with
   `ttlMs: 30000` and settle by passing `intentId` on the mutation in the same or next call.
   Since 0.4.5, an agent mutation WITHOUT a signal still shows a server-synthesized **auto-ghost**
   (rendered lighter — dimmer, dotted, no veto — and settled instantly). That is a visibility
   floor, not a replacement: only an explicit signal gives the human a real pre-mutation veto
   window, your reasoning (`reason`), and staged multi-step previews. Batch and browser-human
   actions never auto-ghost.
6. **Mutate through current composites.** Prefer the 16 composite MCP tools below.
7. **Arrange and validate.** After batch changes, use `canvas_view { action: "arrange" }` when
   appropriate and always finish with `canvas_query { action: "validate" }`.
7b. **Show the human.** After creating user-facing output, bring the camera to it: a single node
   gets `canvas_view { action: "focus", id }` (pans by default), a small cluster gets
   `canvas_view { action: "fit", nodeIds: [...] }` with exactly the new ids. See
   **In-View Placement & Sizing** below — auto-placement is board-relative, not camera-relative.
8. **Verify context pins.** Pin with `canvas_pin_nodes` or the browser's **Pin as context**, then
   read `canvas://pinned-context`.
9. **Clean up temporary nodes.** Remove retry/test fixtures and restore the baseline snapshot when
   the task requires leaving the board unchanged.

## Workspace Safety

Before any create, update, remove, clear, restore, or arrange:

```bash
curl -sS http://localhost:4313/health
pmx-canvas serve status
```

Both surfaces report `workspace`. It must match the intended workspace root.
For a full environment check in one command (health + workspace, CLI/server
version skew, MCP initialize handshake, temp-node create/search/remove
round-trip, board validation), run `pmx-canvas smoke` (0.4.6+) — JSON report,
exit 1 on failure.

- If `responsive: true` but `pidRunning: false`, treat the listener as potentially stale.
- On mismatch, do not mutate. Start the intended workspace on an explicit free port:
  `pmx-canvas serve --daemon --no-open --port=<free-port>`. (`serve --daemon` enforces this
  itself: pointed at a port owned by another workspace, it refuses with the owner named instead
  of reporting "already running".)
- Target that port and re-check `/health`.
- `PMX_CANVAS_PORT` is the agent CLI target; the server's startup port is controlled by `--port`
  or `PMX_WEB_CANVAS_PORT`.
- **MCP transport workspace resolution.** An MCP server (`pmx-canvas --mcp`) holds its own in-memory
  canvas. To avoid the old "wrong-workspace split" (a `--mcp` launched from an incidental dir, e.g.
  `~/.copilot`, silently binding a fallback port the panel never renders): when the preferred port is
  held by a healthy daemon serving a *different* workspace, the MCP server now **attaches** to it
  (inherits its workspace) so writes are visible where the panel renders; and if it launched from an
  incidental host/agent config dir on a *free* port, it still binds but emits a loud stderr warning
  instead of silently adopting that cwd. To pin the intended workspace deterministically set
  **`PMX_CANVAS_WORKSPACE_ROOT=<abs project root>`** (recommended for host adapters); for a genuinely
  separate canvas set `PMX_CANVAS_ALLOW_WORKSPACE_SPLIT=1` or a distinct `PMX_CANVAS_PORT`. The CLI's
  query/mutation commands are a thin HTTP client and never start a server of their own (only `serve` /
  `--mcp` spawn a process).

## Choose the Smallest Useful Node Type

| Need | Node/tool |
|------|-----------|
| Narrative, note, explanation | `markdown` via `canvas_node` |
| Progress or current state | `status` via `canvas_node` |
| Persistent context cards | `context` via `canvas_node` |
| Event/check stream | `ledger` or `trace` via `canvas_node` |
| Local source with live updates | `file` via `canvas_node` |
| Tabular data (`.csv`/`.tsv`), a PDF, or any other file on disk (0.4.6+) | `file` via `canvas_node` — CSV/TSV render as tables, PDFs render inline, other binaries show a size placeholder. Never paste a CSV into a markdown fence. |
| Code review / unified diff (0.4.6+) | `diff` via `canvas_node` (content = diff text; link to its file node with a `references` edge) |
| Flowchart / sequence / state diagram (0.4.6+) | `mermaid` via `canvas_node` (content = mermaid source; renders client-side, no hosted app) |
| Image | `image` via `canvas_node` |
| Cached URL content | `webpage` via `canvas_node` |
| Structured UI | `json-render` via `canvas_render` |
| Chart | `graph` via `canvas_render` |
| Live work-item board (0.4.6+) | `canvas_render { action: "workboard" }` — one board node, auto-refreshes on work-item changes |
| Generated communication surface | HTML primitive via `canvas_node` |
| Give the agent tasks + watch progress + loop (0.4.7+) | `ax-board` HTML primitive — a live AX control surface, created AX-enabled |
| The same, drawn as a task flow, and materializable to real nodes+edges (0.4.7+) | `ax-flow` HTML primitive — **Materialize to board** lays the steps out as nodes joined by `flow` edges with a loop-back edge, each linked to a work item |
| Drive a flow WITHOUT the panel (0.4.7+) | Materialized step nodes carry native Start/Done/Blocked controls, and the anchor adds Run loop/Stop + steer. The native loop runs server-side, so it survives a browser reload and keeps advancing while the tab is closed. |
| Self-contained HTML/JS | `html` via `canvas_node` |
| Hosted interactive MCP app | `canvas_app { action: "open-mcp-app" }` |
| Excalidraw diagram (interactive/human drawing) | `canvas_app { action: "diagram" }` — prefer `mermaid` for agent-authored diagrams |
| Bundled React artifact | `canvas_app { action: "build-artifact" }` |

Use the lightest tier that communicates the result. Do not build a web artifact when markdown,
json-render, a graph, or an HTML primitive is sufficient.

## Current MCP Composites

The live MCP surface is **22 tools**: the 16 composites below plus 6 standalones (v0.4.x —
this table is kept in sync with the server's composite registry; `tools/list` on a fresh
`pmx-canvas --mcp` is always authoritative).

| Composite | Actions |
|-----------|---------|
| `canvas_node` | `add`, `get`, `update`, `remove` |
| `canvas_render` | `describe-schema`, `validate`, `add-json-render`, `stream-json-render`, `add-graph` |
| `canvas_edge` | `add`, `remove` |
| `canvas_group` | `create`, `add`, `ungroup` |
| `canvas_history` | `undo`, `redo` |
| `canvas_view` | `arrange`, `focus`, `fit`, `clear`, `remove-annotation` |
| `canvas_query` | `search`, `layout`, `validate` |
| `canvas_webview` | `status`, `start`, `stop`, `resize`, `evaluate` |
| `canvas_app` | `open-mcp-app`, `diagram`, `build-artifact` |
| `canvas_ax_state` | `get`, `set-focus`, `set-policy`, `report-capability` |
| `canvas_ax_work` | `add`, `update`, `annotate` |
| `canvas_ax_gate` | `request`, `resolve`, `await` with `approval`, `elicitation`, or `mode` |
| `canvas_ax_timeline` | `read`, `record-event`, `add-evidence`, `send-steering` |
| `canvas_ax_delivery` | `claim`, `mark` |
| `canvas_snapshot` | `save`, `list`, `restore`, `delete`, `gc`, `diff` |
| `canvas_intent` | `signal`, `update`, `clear` |

Important routing:

- Basic nodes: `canvas_node { action: "add", type, ... }`
- HTML: `canvas_node { action: "add", type: "html", html }`
- HTML primitive: `canvas_node { action: "add", type: "html", primitive, data }`
- Graph: `canvas_render { action: "add-graph", ... }`
- JSON render: `canvas_render { action: "add-json-render", ... }`
- MCP app: `canvas_app { action: "open-mcp-app", ... }`
- Excalidraw: `canvas_app { action: "diagram", ... }`
- Web artifact: `canvas_app { action: "build-artifact", ... }`

As of v0.3.0, the 57 legacy single-purpose tools from the v0.2 compatibility window are removed.
The composites above plus the retained standalones are now the whole MCP surface: `canvas_batch`,
`canvas_pin_nodes`, `canvas_screenshot`, `canvas_ax_interaction`, `canvas_ingest_activity`, and
`canvas_invoke_command`. Snapshots are the `canvas_snapshot` composite (actions
`save | list | restore | delete | gc | diff`); the 6 legacy snapshot standalones were removed in
v0.4.0 after their deprecated 0.3.x window.

## Spatial Rules

- Treat proximity as relatedness and top-left to bottom-right as reading order.
- Search before adding to avoid duplicate nodes.
- Extend the current board in place; do not evict prior nodes to add new material.
- Use groups only when the frame communicates meaningful containment.
- Keep related nodes 40–80 px apart and separate unrelated clusters by roughly 150–250 px.
- Use directed edges for actual relationships, not decoration.
- Edge types: `flow`, `depends-on`, `relation`, `references`.
- After manual or batch layout changes, run `canvas_query { action: "validate" }`.

## In-View Placement & Sizing (required for user-facing nodes)

Auto-placement (omitting `x`/`y`) is **board-relative, not camera-relative**: it places right of
the last node or scans rows from the origin, ignoring where the human is looking. On a board with
distant nodes, an auto-placed node lands off-camera.

1. Omit `x`/`y` only on an empty or locally dense board. Otherwise place near the human's
   attention: the pinned/focused neighborhood, or explicit coordinates beside the last
   user-facing output (gap ≥ 24–48 px).
2. After creating nodes the human should see, pan the camera (operating-sequence step 7b):
   `focus` for one node, `fit` with exactly the new `nodeIds` for a cluster. Use `noPan`
   (`focus --no-pan`) only when you must not steal the camera.
3. Never fit the whole board to "show" new work — on a board with outliers that miniaturizes
   everything. Always pass explicit `nodeIds` to `fit`.
4. Never leave user-facing output at far coordinates without a focus/fit.
5. **Do not hand-compute a whole board's coordinates.** Create the nodes (omitting x/y), then
   `canvas_view { action: "arrange", layout: "grid" | "column" | "flow" }` and finish with a
   `fit` over the new ids. Manual pixel math is what produces long-line, unbalanced boards.
6. `fit` sizes itself to the connected browser window (0.4.6+) — you do not need to guess
   `width`/`height`. Pass them only to fit for a window other than the human's.
7. **Docking is explicit (0.4.6+).** Nodes render on the canvas where you put them; a node is
   only a HUD pill if you set `dockPosition`. An edge whose endpoint is docked cannot be drawn —
   `validate` reports it as `hiddenEdgeEndpoints` and fails `ok`, because the edge visually
   trails off into empty canvas.

**Size for content.** Omitting `width`/`height` gives readable per-type defaults — prefer them:
markdown 640×420, status 360×200, file 520×360, diff 640×420, mermaid 640×460, html 720×640,
graph 760×520, mcp-app 960×600, web-artifact 960×720. A *hosted* app opened with
`canvas_app { action: "open-mcp-app" | "diagram" }` — including the Excalidraw diagram preset — is
the exception: it opens at 720×500, not 960×600 (960×600 is the default for an `mcp-app` node you
create directly). Pass `width`/`height` to that action when you want a bigger diagram tile.
Since 0.4.6 the server clamps explicit creation sizes UP to per-type
readability floors (e.g. markdown 360×180, graph/json-render/html 420×280, mcp-app 480×320) —
a tiny probe size silently becomes the floor. `strictSize: true` is the only opt-out (a fixed
scrolling frame you genuinely want small). `canvas_query { action: "validate" }` additionally
reports any node below its floor as an advisory `sizeWarnings` entry — treat a non-empty list
as layout work left to do.

**Token hygiene.** For routine state checks use `canvas_ax_state { action: "get" }` WITHOUT
`includeContext` — the full AX context payload is ~10× larger; request it only when you are
actually consuming context.

## Context Pins

Context pins are the primary human-to-agent bridge:

1. Human pins nodes in the browser using **Pin as context**.
2. Agent reads `canvas://pinned-context`.
3. The resource includes pinned nodes and nearby unpinned neighbors.

Do not confuse context pinning with **Lock position**, which only excludes a node from auto-arrange.
Every node type, including `status`, can be removed through `canvas_node { action: "remove" }`, the
title-bar × control, or the **Close** context-menu action.

## Browser Workflows

Use the visible workbench when the human is actively curating layout:

- Drag nodes to move them.
- Shift+drag empty space to lasso-select.
- Use the selection bar for Pin as context, Group, Connect, and Clear.
- Right-click a node for context pinning, position locking, focus, collapse, connect, refresh,
  open, close, and type-specific actions.
- Drop files or URLs to create matching nodes.
- Double-click markdown to edit inline.
- Use toolbar snapshots before experiments and restore only after confirmation.
- The toolbar carries view controls (fit, reset, zoom), arrange, minimap, a theme picker (nine
  themes: dark, light, high-contrast, midnight, sepia, arctic, ember, forest, volt), snapshots, trace,
  the annotation tools, search (Cmd+K), and shortcuts. On narrow viewports (≤900px — most
  embedded host panes and mobile) the secondary controls collapse into a single "⋯" More menu at
  the end of the bar; every action is still there as a labeled row, including the theme list. If
  an automation script can't find a toolbar button at panel width, open the More menu first.
- Embedding hosts can open `/workbench?theme=<name>` (or `?theme=auto` to follow the host's
  light/dark appearance) for a session-local default theme that never changes the server-global
  theme other clients see; an explicit pick from the theme menu ends the override. The bundled
  Copilot extension opens its panel with `?theme=light`.

After changing files under `src/client/`, rebuild with `bun run build` before manual browser
verification.

## AX Interactions

Node interactions request PMX AX primitives; they never execute arbitrary shell, tools, MCP calls,
or host actions.

- `DEFAULT_NODE_AX_CAPABILITIES` is the per-node-type ceiling.
- `data.axCapabilities` may enable or narrow capabilities but cannot escalate beyond the ceiling.
- Sandboxed surfaces are scoped to their own source node.
- HTML nodes must explicitly opt in.
- Use `window.PMX_AX.emit(type, payload)` and await its result.
- Listen for `pmx-ax-update` when an HTML control surface reflects live AX state.
- Steering is queued; claim with `canvas_ax_delivery`, act, then mark delivered.

Read [AX HTML control surfaces](references/ax-html-control-surface.md) before building an
interactive AX-enabled HTML node.

### Ready-made control surfaces (0.4.7+) — prefer these over hand-rolling

Two HTML primitives ship AX-enabled, so you do not need to author a control surface or pass
`axCapabilities` yourself. They are the ONLY primitives created with AX on; every other kind is
still a static document.

- **`ax-board`** — task list: create tasks, watch status change live, steer, bounded loop.
- **`ax-flow`** — the same controls drawn as a task flow with a loop-back rail, plus
  **Materialize to board**.

**`ax.flow.materialize`** is the one interaction that creates canvas nodes, and it is deliberately
narrow: you supply TEXT ONLY (<= 12 steps, title <= 120 chars) and the server owns the result —
one `markdown` node per step, `flow` edges between them, a dashed `references` loop edge, and one
work item per step linked to its node. Re-materializing REPLACES the previous flow (the source
node keeps a manifest of what it created), so it is safe to call repeatedly.

**The flow also works without the panel.** Materialized step nodes carry `data.axStep`, and the
canvas renders native Start / Done / Blocked controls on them, with Run loop / Stop and a steer box
on the anchor (first) step. Those controls also follow the node into focus mode. The native loop
runs **server-side**: it advances when a step's work item completes, survives a browser reload, and
keeps going while the tab is closed — unlike the panel's loop, which dies with the iframe. Bounds
are the same either way: advances only while running, hard cap 20 runs, Stop persists immediately,
and `blocked`/`cancelled` halts it.

When you want the agent to work through a checklist the human can watch and steer, reach for
`ax-flow` + materialize rather than a markdown to-do list — the status chips and the loop come free.

### Working a flow: keep the board honest as you go

A materialized flow is only useful if it tracks reality. While you work one:

1. **Move the step to `in-progress` BEFORE you start it, and to `done` when it is actually done** —
   not in a batch at the end. The human is watching the chips to know where you are; a board that
   only updates on completion tells them nothing while it matters.
2. **Pin the in-progress step as context** (`canvas_pin_nodes` with just that node, or
   `POST /api/canvas/context-pins` mode `set`). This makes the active step the one thing in
   `canvas://pinned-context`, so the board's "what am I working on" and your own context are the
   same answer instead of drifting apart. Re-pin as you advance.
3. **Mark `blocked` rather than going quiet** when you are stuck — a stalled `in-progress` chip is
   indistinguishable from a crashed agent.
4. Read steering back with `canvas_ax_delivery` as you go; a human watching a live flow steers
   mid-run, and a steer you never claim is a correction you ignored.

## Resources

Read the smallest resource that answers the question:

- `canvas://pinned-context` — curated context plus neighborhoods
- `canvas://summary` — compact board overview
- `canvas://layout` — complete state
- `canvas://spatial-context` — clusters and reading order
- `canvas://history` — mutation history
- `canvas://code-graph` — detected file dependencies
- `canvas://ax-context` — compact AX context
- `canvas://ax-work` — work items and gates
- `canvas://ax-timeline` — events, evidence, steering
- `canvas://ax-pending-steering` — adapterless delivery queue
- `canvas://skills` and `canvas://skills/<name>` — bundled skills

Prefer `canvas_query { action: "search" }` over parsing the full layout.

## Known Limitations

- Hosted MCP-app/ext-app nodes such as Excalidraw require the in-canvas host bridge and are not
  standalone **Open as site** targets. URL-backed viewers and bundled web artifacts remain
  openable.
- A standalone html surface (`/api/canvas/surface/:id` opened as a site) is a VISUAL view: it
  renders the same content and theme, but `window.PMX_AX` is not injected without the canvas
  iframe's per-mount nonce, so AX buttons only work inside the in-canvas node (0.4.4 Codex note).
  Do not tell a user a standalone tab's controls will steer the agent.
- A hosted ext-app (Excalidraw) node in a **WebKit** host panel (e.g. the GitHub Copilot app's
  embedded WKWebView) historically could render as a black tile — a host compositor paint race
  on the nested iframe, **not** a broken node (the session is healthy, `sessionStatus` is
  `ready`, and it renders fine in Chrome/Codex). Since 0.4.6 the canvas runs a **paint oracle +
  recovery ladder** under WebKit: present-at-load ext-apps mount strictly one at a time (the
  cold burst was the trigger), each frame answers a double-rAF **paint probe** after settle, and
  on silence the ladder escalates — soft-expand cycle (the automatic analogue of the proven
  enlarge+close) → serialized remount → an explicit "App surface failed to paint / Retry"
  affordance. The connecting overlay stays up until paint is confirmed, so a black layer is
  never presented as ready. The recovery trail
  (`GET /api/canvas/debug/ext-app-recovery` / `window.__PMX_EXTAPP_LOG`) now records
  `mount-slot`, `paint-ok`, `paint-fail`, `soft-expand-cycle`, and `recovery-exhausted` — when
  diagnosing, trust `paint-ok`/`paint-fail`, and never assert health from `settled` alone. If a
  tile still shows the Retry affordance, click Retry (fresh recovery budget) or expand-then-close;
  attach the recovery trail when reporting.
- Ext-app frame documents live in server memory. Through 0.4.0, killing/restarting the daemon
  while a panel stays open leaves ext-app tiles on dead frame URLs (`Frame document not found`,
  0.4.0 report Finding S) until a full workbench reload. Since 0.4.1 the browser revalidates its
  frame documents on every reconnect and re-mints them against the new process automatically —
  if a post-restart tile still looks blank on an older install, reload the workbench page.
- A hosted ext-app (Excalidraw) resized NARROW/TALL (e.g. 360x529) can show its diagram in the
  upper region with the app's own dark fill below it — in every engine (0.3.4 report Finding Q).
  This letterboxing lives inside the hosted app bundle's root container, not in PMX (a body-level
  background override ships but cannot reach the app's inner root). Keep ext-app tiles landscape —
  at or above the 720x500 they open at, or the same ratio — or expand the node: the fullscreen
  overlay renders full-bleed. The durable fix is upstream in the excalidraw-mcp app.
- Behind proxies that buffer streaming responses (e.g. portal hosts), the workbench auto-falls
  back from SSE to a polling transport within ~3s, so the board still boots and stays live.
  Force a mode with `/workbench?transport=poll` (or `transport=sse`) when diagnosing.
- Nested-iframe embeds (e.g. the Amp orb portal renders the canvas page inside an ampcode.com
  iframe) can block child iframes from loading ANY `src` URL, breaking every iframe-backed node
  with a gray placeholder. The canvas probes this at boot and auto-falls back to fetching
  same-origin surfaces and rendering them inline via `srcdoc` (HTML, graph, json-render, frame
  documents). In Amp orbs specifically, the server sees `AMP_ORB` in its environment and adapts
  end to end: it binds the portal-assigned `$PORT` automatically (no port flag in the service
  command), stamps the page so the embedded client skips the (there-unreliable) probe, goes
  straight to `srcdoc`, AND defaults to the polling transport (the portal proxy buffers SSE —
  waiting out the watchdog could trip the boot modal); HTML surfaces also inline their theme
  stylesheet so they render styled. External app
  URLs cannot be inlined (cross-origin) and may stay blocked in such hosts. Force a mode with
  `/workbench?iframe-mode=srcdoc` (or `iframe-mode=src`) when diagnosing.
- Graph and json-render standalone surfaces use `display=site` and fill the browser viewport, and
  reflow on a live window resize. Some single-tab host browsers historically didn't deliver
  live-resize events; current Codex builds do — the 0.4.6 pass watched a standalone graph reflow
  live (SVG 1550×783 → 850×483 on a 1600×900 → 900×600 window resize) with no reload. Do not
  present a system browser as a workaround for stale resizing; it is only a preference for viewing
  a full page beside the canvas.
- Some hosts cannot automate inside sandboxed workbench iframes. Verify those interactions in a
  system browser or through server-side AX state.
- `pmx-canvas screenshot` requires an active WebView. Start it with
  `canvas_webview { action: "start" }`.
- The default server port is 4313, but it may fall back or be explicitly changed.

## Persistence

State lives under `.pmx-canvas/`, primarily in `canvas.db`. It includes viewport, nodes, edges,
annotations, pins, snapshots, AX canvas state, and large-node blobs.

- Stop the server or close/flush the SDK before committing `canvas.db`.
- History is session-scoped and is not persisted.
- Timeline AX data persists independently from canvas snapshots.
- `canvas_view { action: "clear" }` clears canvas-bound state but not host/session diagnostics.

## Detailed References

Load only the reference relevant to the task:

- [Full MCP, HTTP, CLI, layout, and workflow reference](references/full-reference.md)
- [Installing PMX Canvas](references/installing-pmx-canvas.md)
- [HTML primitives](references/html-primitives.md)
- [Excalidraw diagram authoring](references/excalidraw-diagram-authoring.md)
- [AX HTML control surfaces](references/ax-html-control-surface.md)
- [GitHub Copilot adapter](references/github-copilot-app-adapter.md)
- [Codex app adapter](references/codex-app-adapter.md)

The authoritative current MCP inventory and legacy replacement table is
[`docs/mcp.md`](../../docs/mcp.md).
