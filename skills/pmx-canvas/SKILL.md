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

1. **Open or focus the workbench before mutating.** Reuse one visible canvas surface for the
   session.
2. **Verify workspace identity.** Read `GET /health` or `pmx-canvas serve status`; the returned
   `workspace` must equal the intended absolute workspace root. A healthy listener on port 4313
   may belong to another project.
3. **Read before write.** Search with `canvas_query { action: "search", query }` before creating
   nodes. Read the full layout only when necessary.
4. **Snapshot before destructive changes.** Use `canvas_snapshot` before clear, restore, or a major
   reorganization.
5. **Signal substantial spatial changes.** Use `canvas_intent { action: "signal", ... }` before a
   visible create, move, connect, remove, or edit when human steering would be useful.
6. **Mutate through current composites.** Prefer the 15 composite MCP tools below.
7. **Arrange and validate.** After batch changes, use `canvas_view { action: "arrange" }` when
   appropriate and always finish with `canvas_query { action: "validate" }`.
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

- If `responsive: true` but `pidRunning: false`, treat the listener as potentially stale.
- On mismatch, do not mutate. Start the intended workspace on an explicit free port:
  `pmx-canvas serve --daemon --no-open --port=<free-port>`.
- Target that port and re-check `/health`.
- `PMX_CANVAS_PORT` is the agent CLI target; the server's startup port is controlled by `--port`
  or `PMX_WEB_CANVAS_PORT`.

## Choose the Smallest Useful Node Type

| Need | Node/tool |
|------|-----------|
| Narrative, note, explanation | `markdown` via `canvas_node` |
| Progress or current state | `status` via `canvas_node` |
| Persistent context cards | `context` via `canvas_node` |
| Event/check stream | `ledger` or `trace` via `canvas_node` |
| Local source with live updates | `file` via `canvas_node` |
| Image | `image` via `canvas_node` |
| Cached URL content | `webpage` via `canvas_node` |
| Structured UI | `json-render` via `canvas_render` |
| Chart | `graph` via `canvas_render` |
| Generated communication surface | HTML primitive via `canvas_node` |
| Self-contained HTML/JS | `html` via `canvas_node` |
| Hosted interactive MCP app | `canvas_app { action: "open-mcp-app" }` |
| Excalidraw diagram | `canvas_app { action: "diagram" }` |
| Bundled React artifact | `canvas_app { action: "build-artifact" }` |

Use the lightest tier that communicates the result. Do not build a web artifact when markdown,
json-render, a graph, or an HTML primitive is sufficient.

## Current MCP Composites

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

Legacy single-purpose tools remain during the v0.2 compatibility window but are deprecated and
scheduled for removal in v0.3. Standalones that intentionally remain include `canvas_batch`,
`canvas_pin_nodes`, `canvas_screenshot`, snapshot tools, `canvas_ax_interaction`,
`canvas_ingest_activity`, and `canvas_invoke_command`.

## Spatial Rules

- Treat proximity as relatedness and top-left to bottom-right as reading order.
- Search before adding to avoid duplicate nodes.
- Extend the current board in place; do not evict prior nodes to add new material.
- Use groups only when the frame communicates meaningful containment.
- Keep related nodes 40–80 px apart and separate unrelated clusters by roughly 150–250 px.
- Use directed edges for actual relationships, not decoration.
- Edge types: `flow`, `depends-on`, `relation`, `references`.
- After manual or batch layout changes, run `canvas_query { action: "validate" }`.

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
- Graph and json-render standalone surfaces use `display=site` and fill the browser viewport.
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
- `canvas_clear` clears canvas-bound state but not host/session diagnostics.

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
