# MCP reference

PMX Canvas ships an MCP stdio server with **27 tools** + **14 core resources**,
plus per-skill resources at `canvas://skills/<name>`. The server emits
`notifications/resources/updated` when canvas state changes — humans pin
nodes in the browser, agents are notified immediately.

> **Consolidation completed in v0.3.0 (plan-006/008).** The MCP surface shrank
> from 84 tools to 27: 15 action-discriminated **composites** (recommended —
> see below) plus 12 standalone tools. The 57 legacy single-purpose tools that
> the composites replaced were removed in v0.3.0 per
> [`api-stability.md`](api-stability.md); their descriptions carried
> `Deprecated:` prefixes for one minor before removal. The 6 snapshot tools
> remain registered as deprecated standalones — they fold into a
> `canvas_snapshot` composite in v0.4 (see [Standalone tools](#standalone-tools)
> below). **Prefer the composites.**

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

| Composite | `action` values | Replaced (removed in v0.3.0) |
|-----------|-----------------|----------|
| `canvas_node` | `add` · `get` · `update` · `remove` | `canvas_add_node`, `canvas_get_node`, `canvas_update_node`, `canvas_remove_node`, `canvas_add_html_node` (`add` + `type:"html"`), `canvas_add_html_primitive` (`add` + `type:"html"`, `primitive:"<kind>"`), `canvas_refresh_webpage_node` (`update` + `refresh:true`) |
| `canvas_render` | `describe-schema` · `validate` · `add-json-render` · `stream-json-render` · `add-graph` | `canvas_describe_schema`, `canvas_validate_spec`, `canvas_add_json_render_node`, `canvas_stream_json_render_node`, `canvas_add_graph_node` |
| `canvas_edge` | `add` · `remove` | `canvas_add_edge`, `canvas_remove_edge` |
| `canvas_group` | `create` · `add` · `ungroup` | `canvas_create_group`, `canvas_group_nodes`, `canvas_ungroup` |
| `canvas_history` | `undo` · `redo` | `canvas_undo`, `canvas_redo` |
| `canvas_view` | `arrange` · `focus` · `fit` · `clear` · `remove-annotation` | `canvas_arrange`, `canvas_focus_node`, `canvas_fit_view`, `canvas_clear`, `canvas_remove_annotation` |
| `canvas_query` | `search` · `layout` · `validate` | `canvas_search`, `canvas_get_layout`, `canvas_validate` |
| `canvas_webview` | `status` · `start` · `stop` · `resize` · `evaluate` | `canvas_webview_status`, `canvas_webview_start`, `canvas_webview_stop`, `canvas_resize`, `canvas_evaluate` |
| `canvas_app` | `open-mcp-app` · `diagram` · `build-artifact` | `canvas_open_mcp_app`, `canvas_add_diagram`, `canvas_build_web_artifact` |
| `canvas_ax_state` | `get` · `set-focus` · `set-policy` · `report-capability` | `canvas_get_ax`, `canvas_set_ax_focus`, `canvas_set_ax_policy`, `canvas_report_host_capability` |
| `canvas_ax_work` | `add` · `update` · `annotate` | `canvas_add_work_item`, `canvas_update_work_item`, `canvas_add_review_annotation` |
| `canvas_ax_gate` | `request` · `resolve` · `await` × kind `approval` \| `elicitation` \| `mode` | `canvas_request_approval`, `canvas_resolve_approval`, `canvas_await_approval`, `canvas_request_elicitation`, `canvas_respond_elicitation`, `canvas_await_elicitation`, `canvas_request_mode`, `canvas_resolve_mode`, `canvas_await_mode` (9 → 1) |
| `canvas_ax_timeline` | `read` · `record-event` · `add-evidence` · `send-steering` | `canvas_get_ax_timeline`, `canvas_record_ax_event`, `canvas_add_evidence`, `canvas_send_steering` |
| `canvas_ax_delivery` | `claim` · `mark` | `canvas_claim_ax_delivery`, `canvas_mark_ax_delivery` |
| `canvas_intent` | `signal` · `update` · `clear` | _(new — Ghost Cursor of Intent; no legacy standalone tool)_ |

### `canvas_intent` — Ghost Cursor of Intent

Announce the spatial move you are **about** to make so the canvas paints a faint
pre-commit placeholder (a "ghost"). The human sees the next move forming — and can
veto it — before the mutation lands.

- `signal` — register an intent: `kind` (`create` \| `move` \| `connect` \| `remove` \| `edit`) plus the anchor it renders against (`position` for create/move, `nodeId` for move/edit/remove, `edge` for connect). Optional `label`, `reason`, `confidence` (0..1 → ghost opacity), `seq` (staged-batch ordering), `ttlMs` (default ~8s), and a stable `id` to update/clear later.
- `update` — patch a live intent by `id` (position/label/reason/confidence/ttlMs).
- `clear` — abandon/dissolve it explicitly. Normal linked mutations settle automatically.

Intents are **ephemeral presence**: never persisted, never snapshotted, never in
`canvas_query { action: "layout" }`, and auto-expiring. They ride their own SSE channel
(`ax-intent` / `ax-intent-clear`) and replay to reconnecting browsers while still
live. Best practice — narrate your next move: `signal` → mutate with the returned
`intent.id` as `intentId`. A vetoed or expired linked mutation is rejected, and a
successful mutation settles the ghost automatically. Also reachable over HTTP:
`POST/PATCH/DELETE /api/canvas/ax/intent[/:id]`.

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
the composite/registry JSON wire shape does not model. (Wave 5 folded
`canvas_refresh_webpage_node` → `canvas_node { action: "update", refresh: true }` after
fixing `node.update`'s `formatResult` to surface a FAILED refresh as `isError` +
`{ ok:false, error }` instead of masking it as a false `{ ok:true }`.) The 6
snapshot tools are the one deferred fold: a `canvas_snapshot` composite is
planned for v0.4 (the name collides with the legacy `canvas_snapshot` save
tool, and [`api-stability.md`](api-stability.md) requires deprecating a tool
for one minor before removing it) — they stay registered as deprecated
standalones until then.

## Standalone tools

12 tools that intentionally stay outside the composites — either because
folding them would hurt (distinct callers, binary payloads, trust-boundary or
execution-intent semantics), or because they're mid-deprecation pending a
v0.4 composite. See [Migration reference](#migration-reference) below for the
57 tools these composites replaced.

| Tool | Description |
|------|-------------|
| `canvas_batch` | Run a batch of canvas operations with `$ref` support |
| `canvas_pin_nodes` | Pin nodes to include in agent context |
| `canvas_invoke_command` | Invoke a registry command (`pmx.plan`, `pmx.execute`, `pmx.promote-context`, `pmx.summarize`, `pmx.review`); records a `command` agent-event, unknown names rejected |
| `canvas_ax_interaction` | Submit one capability-gated AX interaction envelope (`{ type, sourceNodeId, payload }`) that maps onto an AX operation; the server re-validates and clamps sandboxed surfaces to their own node |
| `canvas_ingest_activity` | Ingest a harness-forwarded agent activity (tool/session event); the board auto-reacts with kind-driven, overridable defaults (failure → work item + review + evidence; `tool-result`+success → evidence). Makes AX bidirectional |
| `canvas_screenshot` | Capture a screenshot from the active workbench automation session |
| `canvas_snapshot` | **Deprecated** → folds into the `canvas_snapshot` composite in v0.4 (actions `save\|list\|restore\|delete\|gc\|diff`). Save current canvas as a named snapshot |
| `canvas_list_snapshots` | **Deprecated** → folds into the `canvas_snapshot` composite in v0.4 (actions `save\|list\|restore\|delete\|gc\|diff`). List saved snapshots, bounded to the newest 20 by default |
| `canvas_restore` | **Deprecated** → folds into the `canvas_snapshot` composite in v0.4 (actions `save\|list\|restore\|delete\|gc\|diff`). Restore canvas from a saved snapshot |
| `canvas_delete_snapshot` | **Deprecated** → folds into the `canvas_snapshot` composite in v0.4 (actions `save\|list\|restore\|delete\|gc\|diff`). Delete a saved snapshot |
| `canvas_gc_snapshots` | **Deprecated** → folds into the `canvas_snapshot` composite in v0.4 (actions `save\|list\|restore\|delete\|gc\|diff`). Delete old snapshots while keeping the newest N |
| `canvas_diff` | **Deprecated** → folds into the `canvas_snapshot` composite in v0.4 (actions `save\|list\|restore\|delete\|gc\|diff`). Compare current canvas vs a saved snapshot |

`canvas_node { action: "add", type: "html" }` accepts optional `summary`, `agentSummary`,
`embeddedNodeIds`, and `embeddedUrls`. PMX also derives a bounded text summary from visible
HTML, so rich HTML nodes stay searchable and readable in pinned/spatial context.

## Migration reference

The 57 legacy single-purpose tools below were removed in v0.3.0. Each row is
the composite call that replaces it — kept as a lookup table for anyone
migrating an older integration.

| Removed tool | Composite replacement |
|------|-------------|
| `canvas_add_node` | `canvas_node { action: "add" }` |
| `canvas_get_node` | `canvas_node { action: "get" }` |
| `canvas_update_node` | `canvas_node { action: "update" }` |
| `canvas_remove_node` | `canvas_node { action: "remove" }` |
| `canvas_add_html_node` | `canvas_node { action: "add", type: "html" }` |
| `canvas_add_html_primitive` | `canvas_node { action: "add", type: "html", primitive: "<kind>" }` |
| `canvas_refresh_webpage_node` | `canvas_node { action: "update", refresh: true }` |
| `canvas_describe_schema` | `canvas_render { action: "describe-schema" }` |
| `canvas_validate_spec` | `canvas_render { action: "validate" }` |
| `canvas_add_json_render_node` | `canvas_render { action: "add-json-render" }` |
| `canvas_stream_json_render_node` | `canvas_render { action: "stream-json-render" }` |
| `canvas_add_graph_node` | `canvas_render { action: "add-graph" }` |
| `canvas_add_edge` | `canvas_edge { action: "add" }` |
| `canvas_remove_edge` | `canvas_edge { action: "remove" }` |
| `canvas_create_group` | `canvas_group { action: "create" }` |
| `canvas_group_nodes` | `canvas_group { action: "add" }` |
| `canvas_ungroup` | `canvas_group { action: "ungroup" }` |
| `canvas_undo` | `canvas_history { action: "undo" }` |
| `canvas_redo` | `canvas_history { action: "redo" }` |
| `canvas_arrange` | `canvas_view { action: "arrange" }` |
| `canvas_focus_node` | `canvas_view { action: "focus" }` |
| `canvas_fit_view` | `canvas_view { action: "fit" }` |
| `canvas_clear` | `canvas_view { action: "clear" }` |
| `canvas_remove_annotation` | `canvas_view { action: "remove-annotation" }` |
| `canvas_search` | `canvas_query { action: "search" }` |
| `canvas_get_layout` | `canvas_query { action: "layout" }` |
| `canvas_validate` | `canvas_query { action: "validate" }` |
| `canvas_open_mcp_app` | `canvas_app { action: "open-mcp-app" }` |
| `canvas_add_diagram` | `canvas_app { action: "diagram" }` |
| `canvas_build_web_artifact` | `canvas_app { action: "build-artifact" }` |
| `canvas_webview_status` | `canvas_webview { action: "status" }` |
| `canvas_webview_start` | `canvas_webview { action: "start" }` |
| `canvas_webview_stop` | `canvas_webview { action: "stop" }` |
| `canvas_resize` | `canvas_webview { action: "resize" }` |
| `canvas_evaluate` | `canvas_webview { action: "evaluate" }` |
| `canvas_get_ax` | `canvas_ax_state { action: "get" }` |
| `canvas_set_ax_focus` | `canvas_ax_state { action: "set-focus" }` |
| `canvas_set_ax_policy` | `canvas_ax_state { action: "set-policy" }` |
| `canvas_report_host_capability` | `canvas_ax_state { action: "report-capability" }` |
| `canvas_add_work_item` | `canvas_ax_work { action: "add" }` |
| `canvas_update_work_item` | `canvas_ax_work { action: "update" }` |
| `canvas_add_review_annotation` | `canvas_ax_work { action: "annotate" }` |
| `canvas_request_approval` | `canvas_ax_gate { kind: "approval", action: "request" }` |
| `canvas_resolve_approval` | `canvas_ax_gate { kind: "approval", action: "resolve" }` |
| `canvas_await_approval` | `canvas_ax_gate { kind: "approval", action: "await" }` |
| `canvas_request_elicitation` | `canvas_ax_gate { kind: "elicitation", action: "request" }` |
| `canvas_respond_elicitation` | `canvas_ax_gate { kind: "elicitation", action: "resolve" }` |
| `canvas_await_elicitation` | `canvas_ax_gate { kind: "elicitation", action: "await" }` |
| `canvas_request_mode` | `canvas_ax_gate { kind: "mode", action: "request" }` |
| `canvas_resolve_mode` | `canvas_ax_gate { kind: "mode", action: "resolve" }` |
| `canvas_await_mode` | `canvas_ax_gate { kind: "mode", action: "await" }` |
| `canvas_get_ax_timeline` | `canvas_ax_timeline { action: "read" }` |
| `canvas_record_ax_event` | `canvas_ax_timeline { action: "record-event" }` |
| `canvas_add_evidence` | `canvas_ax_timeline { action: "add-evidence" }` |
| `canvas_send_steering` | `canvas_ax_timeline { action: "send-steering" }` |
| `canvas_claim_ax_delivery` | `canvas_ax_delivery { action: "claim" }` |
| `canvas_mark_ax_delivery` | `canvas_ax_delivery { action: "mark" }` |

## Resources

Individual bundled skills are also readable at `canvas://skills/<name>`.

| Resource | Description |
|----------|-------------|
| `canvas://pinned-context` | Content of pinned nodes + nearby unpinned neighbors |
| `canvas://ax` | PMX AX state: focus, work items, approval gates, review annotations |
| `canvas://ax-context` | Agent-readable pinned and focused AX context, plus a compact `delivery` lead block (`pendingSteering` newest-first + `totalPending`/`omittedPending` counts), timeline summary, and host capability |
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
remove a known annotation ID with `canvas_view { action: "remove-annotation", id }`.

Use WebView automation when an agent needs to actually see annotations as drawn.
For example, inspect `.annotation-layer path` with `canvas_webview { action: "evaluate" }`
or capture a `canvas_screenshot` to distinguish an arrow from a line, circle, or highlight.

## Node-type routing

MCP node creation uses dedicated composite actions for structured node
families. Read `mcp.nodeTypeRouting` from `canvas_render { action:
"describe-schema" }` / `canvas://schema` when in doubt:

- `json-render` → `canvas_render { action: "add-json-render" }`
- `graph` → `canvas_render { action: "add-graph" }`
- `html-primitive` → `canvas_node { action: "add", type: "html", primitive: "<kind>" }`
- `html` → `canvas_node { action: "add", type: "html" }`
- `web-artifact` → `canvas_app { action: "build-artifact" }`
- `mcp-app` → `canvas_app { action: "open-mcp-app" }`
- `group` → `canvas_group { action: "create" }`
- Basic nodes (`markdown`, `status`, `file`, `image`, `webpage`) →
  `canvas_node { action: "add" }`

## CLI/MCP alignment

CLI and MCP are kept aligned for the main canvas operations: node and edge
creation, graph/json-render/html/html-primitive nodes, web artifacts, external apps, groups,
batch builds, layout validation, snapshots, search, focus, pins, undo/redo,
semantic watch streams, WebView automation, and daemon/server control where
it applies. A few agent-native capabilities — resource subscriptions and
`canvas_diff` — remain MCP-only.
