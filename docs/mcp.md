# MCP reference

PMX Canvas ships an MCP stdio server with **83 tools** + **14 core resources**,
plus per-skill resources at `canvas://skills/<name>`. The server emits
`notifications/resources/updated` when canvas state changes — humans pin
nodes in the browser, agents are notified immediately.

> **Consolidation in progress (plan-006/008).** The 83 tools are 14 action-discriminated
> **composites** (recommended — see below) plus 69 legacy single-purpose tools.
> The composites fold the legacy tools behind an `action` (and, for `canvas_ax_gate`,
> a `kind`) enum; each action dispatches to the same operation, so behavior is
> identical. Folded legacy tools are marked `Deprecated:` in their descriptions and
> are removed in v0.3 per [`api-stability.md`](api-stability.md). **Prefer the
> composites.**

## Connect

Add to your agent's MCP config:

```json
{
  "mcpServers": {
    "canvas": {
      "command": "bunx",
      "args": ["pmx-canvas", "--mcp"]
    }
  }
}
```

The canvas auto-starts on first tool call.

## Composite tools (recommended)

Action-discriminated tools that consolidate the single-purpose tools. Each maps
its `action` to the same operation the legacy tool used, so results are identical.

| Composite | `action` values | Replaces |
|-----------|-----------------|----------|
| `canvas_node` | `add` · `get` · `update` · `remove` | `canvas_add_node`, `canvas_get_node`, `canvas_update_node`, `canvas_remove_node` |
| `canvas_render` | `describe-schema` · `validate` · `add-json-render` · `stream-json-render` · `add-graph` | `canvas_describe_schema`, `canvas_validate_spec`, `canvas_add_json_render_node`, `canvas_stream_json_render_node`, `canvas_add_graph_node` |
| `canvas_edge` | `add` · `remove` | `canvas_add_edge`, `canvas_remove_edge` |
| `canvas_group` | `create` · `add` · `ungroup` | `canvas_create_group`, `canvas_group_nodes`, `canvas_ungroup` |
| `canvas_history` | `undo` · `redo` | `canvas_undo`, `canvas_redo` |
| `canvas_view` | `arrange` · `focus` · `fit` · `clear` | `canvas_arrange`, `canvas_focus_node`, `canvas_fit_view`, `canvas_clear` |
| `canvas_query` | `search` · `layout` | `canvas_search`, `canvas_get_layout` |
| `canvas_webview` | `status` · `start` · `stop` · `resize` · `evaluate` | `canvas_webview_status`, `canvas_webview_start`, `canvas_webview_stop`, `canvas_resize`, `canvas_evaluate` |
| `canvas_app` | `open-mcp-app` · `diagram` · `build-artifact` | `canvas_open_mcp_app`, `canvas_add_diagram`, `canvas_build_web_artifact` |
| `canvas_ax_state` | `get` · `set-focus` · `set-policy` · `report-capability` | `canvas_get_ax`, `canvas_set_ax_focus`, `canvas_set_ax_policy`, `canvas_report_host_capability` |
| `canvas_ax_work` | `add` · `update` · `annotate` | `canvas_add_work_item`, `canvas_update_work_item`, `canvas_add_review_annotation` |
| `canvas_ax_gate` | `request` · `resolve` · `await` × kind `approval` \| `elicitation` \| `mode` | `canvas_request_approval`, `canvas_resolve_approval`, `canvas_await_approval`, `canvas_request_elicitation`, `canvas_respond_elicitation`, `canvas_await_elicitation`, `canvas_request_mode`, `canvas_resolve_mode`, `canvas_await_mode` (9 → 1) |
| `canvas_ax_timeline` | `read` · `record-event` · `add-evidence` · `send-steering` | `canvas_get_ax_timeline`, `canvas_record_ax_event`, `canvas_add_evidence`, `canvas_send_steering` |
| `canvas_ax_delivery` | `claim` · `mark` | `canvas_claim_ax_delivery`, `canvas_mark_ax_delivery` |

Field names match the underlying operation (e.g. `canvas_view { action: "focus", id }`,
`canvas_group { action: "create", childIds }`). `canvas_ax_gate` has two discriminators:
`{ kind, action }` — e.g. `{ kind: "approval", action: "request", title }`,
`{ kind: "elicitation", action: "resolve", id, response }`,
`{ kind: "mode", action: "await", id, timeoutMs }`. (The approval machine-readable
action identifier is passed as `approvalAction`, since `action` is the lifecycle
discriminator.) `canvas_app` folds the external / built-content tools:
`{ action: "open-mcp-app", transport, toolName }`, `{ action: "diagram", elements }`
(the hosted Excalidraw preset), and `{ action: "build-artifact", title, appTsx }`
(build-artifact can run for minutes on a cold workspace — set a long client
timeout). `canvas_ax_interaction`, `canvas_ingest_activity`, and
`canvas_invoke_command` stay standalone (trust-boundary / firehose / execution-intent
tools). `canvas_screenshot` also stays standalone — it returns a binary image payload
the composite/registry JSON wire shape does not model. Snapshots fold as their registry
slice lands.

## Tools (legacy single-purpose)

| Tool | Description |
|------|-------------|
| `canvas_add_node` | Add a node (markdown, status, context, file, webpage, html, etc.) |
| `canvas_add_html_node` | Create an `html` node from a self-contained HTML/JS document (sandboxed iframe) |
| `canvas_add_html_primitive` | Create a reusable generated HTML communication primitive as a sandboxed `html` node |
| `canvas_add_diagram` | Hand-drawn diagram via the hosted Excalidraw MCP App (preset alias for `canvas_open_mcp_app`) |
| `canvas_open_mcp_app` | Open any [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) server's `ui://` resource as an iframe node |
| `canvas_describe_schema` | Describe the running server's create schemas, examples, json-render catalog, and HTML primitive catalog |
| `canvas_validate_spec` | Validate a json-render spec, graph payload, or HTML primitive payload without creating a node |
| `canvas_refresh_webpage_node` | Re-fetch and update a webpage node from its stored URL |
| `canvas_add_json_render_node` | Create a native json-render node from a validated spec |
| `canvas_stream_json_render_node` | Progressively build a json-render node from SpecStream JSON-Patch ops (live/streaming panels) |
| `canvas_add_graph_node` | Create a native graph node (line, bar, pie, area, scatter, radar, stacked-bar, composed, sparkline, dot-plot, bullet, slopegraph) |
| `canvas_build_web_artifact` | Build a bundled HTML artifact and open it on the canvas |

`canvas_add_html_node` accepts optional `summary`, `agentSummary`, `embeddedNodeIds`, and
`embeddedUrls`. PMX also derives a bounded text summary from visible HTML, so rich HTML nodes stay
searchable and readable in pinned/spatial context.
| `canvas_update_node` | Update content, position, size, collapsed state |
| `canvas_remove_node` | Remove a node and its edges |
| `canvas_get_layout` | Get full canvas state |
| `canvas_get_node` | Get a single node by ID |
| `canvas_remove_annotation` | Remove a human-drawn annotation by ID |
| `canvas_add_edge` | Connect two nodes |
| `canvas_remove_edge` | Remove a connection |
| `canvas_arrange` | Auto-arrange (grid/column/flow) |
| `canvas_validate` | Validate collisions, containment, and missing edge endpoints |
| `canvas_focus_node` | Pan viewport to a node; use CLI `focus --no-pan` when you only need to select/raise |
| `canvas_fit_view` | Fit the canvas viewport to all nodes or a selected subset |
| `canvas_get_ax` | Read the PMX AX state (focus, work items, approvals, review annotations, host capability) plus pinned/focused context |
| `canvas_set_ax_focus` | Set the host-agnostic AX focus node set; adapters can pass a source such as `codex` |
| `canvas_record_ax_event` | Record a normalized timeline `agent-event` (prompt/assistant-message/tool-start/tool-result/failure/approval/steering) |
| `canvas_send_steering` | Record a `steering-message`: a user instruction from the surface to the active agent session |
| `canvas_get_ax_timeline` | Read the bounded AX timeline (events, evidence, steering) plus counts |
| `canvas_add_work_item` | Add a canvas-bound `work-item` (visible task/plan/status tied to nodes) |
| `canvas_update_work_item` | Update a work item's title/status/detail/nodeIds by ID |
| `canvas_request_approval` | Request human approval via an `approval-gate` (pending) before a high-impact action |
| `canvas_resolve_approval` | Resolve a pending approval gate (`approved`/`rejected`) |
| `canvas_add_evidence` | Record an `evidence-item` on the timeline (logs/tool-result/screenshot/file/diff/test-output) |
| `canvas_add_review_annotation` | Add a canvas-bound `review-annotation` (comment/finding) anchored to a node, file, or region |
| `canvas_report_host_capability` | Report a host/session `host-capability` for diagnostics |
| `canvas_ax_interaction` | Submit one capability-gated AX interaction envelope (`{ type, sourceNodeId, payload }`) that maps onto an AX operation; the server re-validates and clamps sandboxed surfaces to their own node |
| `canvas_claim_ax_delivery` | Claim undelivered steering messages for an adapterless consumer (loop-safe — never returns steering the consumer originated) |
| `canvas_mark_ax_delivery` | Mark a steering message delivered for a consumer |
| `canvas_request_elicitation` | Request structured human input via a canvas-bound `elicitation` (pending) |
| `canvas_respond_elicitation` | Respond to / resolve a pending elicitation |
| `canvas_request_mode` | Request a workflow `mode-request` transition (plan/execute/autonomous) |
| `canvas_resolve_mode` | Resolve a pending mode request |
| `canvas_ingest_activity` | Ingest a harness-forwarded agent activity (tool/session event); the board auto-reacts with kind-driven, overridable defaults (failure → work item + review + evidence; `tool-result`+success → evidence). Makes AX bidirectional |
| `canvas_await_approval` | Block until an approval gate resolves (human approves/rejects in the browser) or the timeout elapses (`timeoutMs` 0 = immediate read). Gates that actually gate |
| `canvas_await_elicitation` | Block until an elicitation is answered or the timeout elapses |
| `canvas_await_mode` | Block until a mode request resolves or the timeout elapses |
| `canvas_invoke_command` | Invoke a registry command (`pmx.plan`, `pmx.execute`, `pmx.promote-context`, `pmx.summarize`, `pmx.review`); records a `command` agent-event, unknown names rejected |
| `canvas_set_ax_policy` | Patch the canvas-bound tool/prompt policy (`tools.allowed\|excluded\|approvalRequired`, `prompt.systemAppend\|mode`); patches merge and are normalized |
| `canvas_pin_nodes` | Pin nodes to include in agent context |
| `canvas_clear` | Clear all nodes and edges |
| `canvas_snapshot` | Save current canvas as a named snapshot |
| `canvas_list_snapshots` | List saved snapshots, bounded to the newest 20 by default |
| `canvas_gc_snapshots` | Delete old snapshots while keeping the newest N |
| `canvas_restore` | Restore canvas from a saved snapshot |
| `canvas_delete_snapshot` | Delete a saved snapshot |
| `canvas_search` | Find nodes by title/content keywords |
| `canvas_undo` | Undo the last canvas mutation |
| `canvas_redo` | Redo the last undone mutation |
| `canvas_diff` | Compare current canvas vs a saved snapshot |
| `canvas_create_group` | Create a group containing specified nodes |
| `canvas_group_nodes` | Add nodes to an existing group |
| `canvas_ungroup` | Release all children from a group |
| `canvas_batch` | Run a batch of canvas operations with `$ref` support |
| `canvas_webview_status` | Get Bun.WebView automation status for the workbench |
| `canvas_webview_start` | Start or replace the Bun.WebView automation session |
| `canvas_webview_stop` | Stop the active Bun.WebView automation session |
| `canvas_evaluate` | Evaluate JavaScript in the active workbench automation session |
| `canvas_resize` | Resize the active workbench automation viewport |
| `canvas_screenshot` | Capture a screenshot from the active workbench automation session |

## Resources

Individual bundled skills are also readable at `canvas://skills/<name>`.

| Resource | Description |
|----------|-------------|
| `canvas://pinned-context` | Content of pinned nodes + nearby unpinned neighbors |
| `canvas://ax` | PMX AX state: focus, work items, approval gates, review annotations |
| `canvas://ax-context` | Agent-readable pinned and focused AX context, plus timeline summary and host capability |
| `canvas://ax-work` | Canvas-bound AX work: work items, approval gates, review annotations, elicitations, mode requests, and tool/prompt policy |
| `canvas://ax-timeline` | Bounded AX timeline: recent agent-events, evidence, and steering messages |
| `canvas://ax-pending-steering` | Undelivered steering an adapterless MCP client can claim, act on, and mark delivered |
| `canvas://ax-delivery` | Steering delivery state (delivered flag) for diagnostics |
| `canvas://schema` | Running-server create schemas and json-render catalog metadata |
| `canvas://layout` | Full canvas state (all nodes, edges, viewport) |
| `canvas://summary` | Compact overview: counts, pinned titles, viewport |
| `canvas://spatial-context` | Proximity clusters, reading order, pinned neighborhoods |
| `canvas://history` | Mutation history timeline with undo/redo position |
| `canvas://code-graph` | Auto-detected file dependency graph (JS/TS, Python, Go, Rust) |
| `canvas://skills` | Index of bundled agent skills + per-skill content at `canvas://skills/<name>` |

## Node interactions (capability-gated)

Eligible nodes emit one normalized, validated interaction envelope
(`{ type, sourceNodeId, payload, sourceSurface }`) via `canvas_ax_interaction`
(HTTP `POST /api/canvas/ax/interaction`) that maps onto an AX operation — work
item, evidence, approval, review, focus, steering, event, elicitation, mode, or
command. The server is the single trust boundary and re-validates every
interaction against the node's effective capabilities.

- **Capabilities:** each node type has a default capability set (a ceiling). A
  node may opt in or narrow via `data.axCapabilities` (`{ enabled, allowed }`),
  clamped to the ceiling — a node can never escalate beyond its type's ceiling.
  `html` / `html-primitive`, `mcp-app`, and internal `prompt` / `response` are
  disabled by default.
- **Scoping:** sandboxed/opaque-origin iframe surfaces (`html-node`, `mcp-app`,
  `json-render`) are clamped to their own node — caller-supplied `nodeIds` are
  forced to the source node. Trusted surfaces (`native-node`, `adapter`) may
  target explicit nodeIds.
- **Transports:** native node controls call the endpoint directly; sandboxed
  `html` / `mcp-app` nodes call `window.PMX_AX.emit(type, payload)`; the
  `json-render` / `graph` viewer forwards a spec action named after an AX type
  (e.g. `on.press → { action: "ax.work.create", params }`). All postMessage
  transports are nonce-validated by the parent canvas before submission.
- **Commands:** `canvas_invoke_command` runs a registry command (`pmx.plan`,
  `pmx.execute`, `pmx.promote-context`, `pmx.summarize`, `pmx.review`); unknown
  names are rejected and a successful call records a `command` agent-event.

## Change notifications

The MCP server emits `notifications/resources/updated` whenever canvas state
changes:

- Pin changes notify `canvas://pinned-context`, `canvas://ax`, and `canvas://ax-context`
- AX focus changes notify `canvas://ax` and `canvas://ax-context`
- Canvas-bound AX mutations (work items, approval gates, review annotations,
  host capability) notify `canvas://ax`, `canvas://ax-work`, and `canvas://ax-context`
- AX timeline mutations (agent-events, evidence, steering) notify
  `canvas://ax-timeline` and `canvas://ax-context`
- All mutations notify `canvas://layout`, `canvas://summary`,
  `canvas://spatial-context`, `canvas://history`, and `canvas://code-graph`

This closes the human-to-agent loop: spatial curation in the browser becomes
an immediate signal in the agent's context.

## Codex App Adapter

In the Codex app, PMX Canvas runs natively through the existing Codex surfaces:
MCP for tools/resources and the in-app Browser for the live `/workbench` view.
No separate PMX renderer is needed. Prefer MCP over the CLI for Codex-native
operation; keep the CLI for fallback scripts and manual debugging.

Use `canvas://ax-context` or `canvas_ax_state { action: "get" }` to read
pinned/focused context. When Codex-hosted steering sets the current attention
target, call `canvas_ax_state { action: "set-focus", source: "codex" }` so the
AX state records where the focus came from. The full workflow lives in
`skills/pmx-canvas/references/codex-app-adapter.md`.

## Annotation Visibility

Human-drawn canvas annotations are rendered as browser SVG ink. MCP resources
keep annotation context compact: agents see annotation counts, bounds, and target
summaries such as the node or empty canvas region that was marked, but not the
raw stroke geometry or visual shape.

Annotations are a browser-visible markup layer. Use the pen toolbar button to
draw and the eraser toolbar button to remove an annotation again; agents can also
remove a known annotation ID with `canvas_remove_annotation`.

Use WebView automation when an agent needs to actually see annotations as drawn.
For example, inspect `.annotation-layer path` with `canvas_evaluate` or capture a
`canvas_screenshot` to distinguish an arrow from a line, circle, or highlight.

## Node-type routing

MCP node creation uses dedicated tools for structured node families. Read
`mcp.nodeTypeRouting` from `canvas_describe_schema` / `canvas://schema` when
in doubt:

- `json-render` → `canvas_add_json_render_node`
- `graph` → `canvas_add_graph_node`
- `html-primitive` → `canvas_add_html_primitive`
- `html` → `canvas_add_html_node`
- `web-artifact` → `canvas_build_web_artifact`
- `mcp-app` → `canvas_open_mcp_app`
- `group` → `canvas_create_group`
- Basic nodes (`markdown`, `status`, `file`, `image`, `webpage`) →
  `canvas_add_node`

## CLI/MCP alignment

CLI and MCP are kept aligned for the main canvas operations: node and edge
creation, graph/json-render/html/html-primitive nodes, web artifacts, external apps, groups,
batch builds, layout validation, snapshots, search, focus, pins, undo/redo,
semantic watch streams, WebView automation, and daemon/server control where
it applies. A few agent-native capabilities — resource subscriptions and
`canvas_diff` — remain MCP-only.
