## Canvas Types

**Node types (18):** `markdown`, `status`, `context`, `ledger`, `trace`, `file`, `diff`, `image`, `html`, `mermaid`, `mcp-app`, `webpage`, `json-render`, `graph`, `group`, `board`, plus internal thread node types `prompt` and `response`

**Edge types:** `flow`, `depends-on`, `relation`, `references` — all support labels, styles (solid/dashed/dotted), and animation.

## MCP Server

25 tools: 18 action-discriminated composites (`canvas_import`, `canvas_board`, `canvas_node`, `canvas_render`, `canvas_edge`, `canvas_group`, `canvas_history`, `canvas_view`, `canvas_query`, `canvas_webview`, `canvas_app`, `canvas_snapshot`, `canvas_ax_state`, `canvas_ax_work`, `canvas_ax_gate`, `canvas_ax_timeline`, `canvas_ax_delivery`, `canvas_intent`) plus 7 standalone tools (`canvas_help`, `canvas_batch`, `canvas_pin_nodes`, `canvas_invoke_command`, `canvas_ax_interaction`, `canvas_ingest_activity`, `canvas_screenshot`). `canvas_help { op }` returns one MCP registry operation's public arguments and guidance without accessing the canvas; omit `op` to list names. `canvas_import` is the agent half of the human-consented attachment workflow: agents list/read requested imports, submit reviewable Markdown, or report unavailable; they cannot request, cancel, or commit. The 57 legacy single-purpose tools the composites replaced were removed in v0.3.0; v0.4.0 shipped the `canvas_snapshot` composite and removed the 6 deprecated snapshot standalones. Prefer composites for new MCP calls; see `docs/mcp.md` for the authoritative tool list and the legacy-to-composite migration reference.

### Agent-assisted document imports

PDF and Office drops retain the original (maximum 20 MiB) as a board-owned attachment. Nothing launches an agent automatically: a human explicitly consents and requests extraction, then reviews the returned sections, references, warnings, and `agentDescription` before committing source-linked Markdown. The agent reads controlled bytes through the returned HTTP download path, or inline base64 only at 2 MiB or below; a remote host may require manual byte transfer. Draft submission may happen while another board is active, but commit requires reopening the captured source board. PMX bundles no converter or OCR and makes no guarantee that a host can read every format, scan, chart, or diagram.

Originals remain in SQLite until their board is deleted; snapshots/restores do not discard them, and database backups include them. Static export v1 never includes original bytes. Source-linked Markdown is excluded by default and is controlled by `includeDerivedText`, independently of `includeFiles`; editing the Markdown does not remove its source classification.

The `diagram` action of `canvas_app` is a thin preset in `src/server/diagram-presets.ts` that proxies to the hosted [Excalidraw MCP app](https://github.com/excalidraw/excalidraw-mcp) (`https://mcp.excalidraw.com/mcp`). For any other MCP Apps server, use `canvas_app` action `open-mcp-app`.

15 static canvas resources: `canvas://boards`, `canvas://pinned-context`, `canvas://schema`, `canvas://layout`, `canvas://summary`, `canvas://spatial-context`, `canvas://history`, `canvas://code-graph`, `canvas://ax`, `canvas://ax-context`, `canvas://ax-timeline`, `canvas://ax-work`, `canvas://ax-pending-steering`, `canvas://ax-delivery`, `canvas://skills`; two canvas resource templates: `canvas://context{?budget,consumer,since}` and `canvas://graph{?focus,depth}`. Bundled skills additionally register per-skill `canvas://skills/<name>` resources and the `skill://{name}/{+path}` file template.

Resource change notifications: subscribe to each live URI to receive `notifications/resources/updated` when canvas state or knowledge policies change. Notifications invalidate cached data without reading it. Subscriptions belong to the connection; subscribe again after reconnecting. See [Resource subscriptions](mcp.md#resource-subscriptions-010).

### AX Primitives (host-agnostic)

Neutral, agent-agnostic agent-experience primitives. The core never imports a host SDK (e.g. `@github/copilot-sdk`); host adapters map onto these HTTP/MCP surfaces. State lives in three partitions:

- **Canvas-bound** (`focus`, `work-item`, `approval-gate`, `review-annotation`): live in `PmxAxState`, participate in snapshots + restore, cleared by `canvas_view { action: "clear" }`. Read via `canvas_ax_state { action: "get" }` / `canvas://ax-work`.
- **Timeline** (`agent-event`, `evidence-item`, `steering-message`): persist in dedicated DB tables for diagnostics/continuity, bounded by retention (500 rows/table), NOT restored by snapshots, NOT cleared by `canvas_view { action: "clear" }`. Read via `canvas_ax_timeline { action: "read" }` / `canvas://ax-timeline`.
- **Host/session** (`host-capability`): reported by adapters into its own table, exposed for diagnostics, survives `canvas_view { action: "clear" }`. Read via `canvas_ax_state { action: "get" }`.

Approval gates implement PMX approvals first (`pending → approved/rejected/held`); host permission hooks are mapped only where low-risk. **Unattended-approval policy** (`src/server/ax-gate-ttl.ts`): every gate carries `expiresAt` (`ttlMs`, default `PMX_CANVAS_GATE_TTL_MS` = 5 min); a 1s sweeper started with the server resolves unanswered gates to `held` (non-approval), records a `policy` agent-event, and re-emits presence; `POST /api/canvas/ax/approval/:id/reopen` (HTTP/SDK only — a human action) restarts the clock. **Scope fence** (`src/server/scope-fence.ts`): `policy.scope = { nodeIds, padding }` makes `executeOperation` refuse agent-originated mutations outside the fence with 403 (`meta.fromWorkbench` exempts the human; batch inner ops are always agent writes, so the fence cannot be keyed on `suppressAutoGhost`); unknown mutating ops are refused under a fence by default — add new layout ops to `checkScopeFence`.

- **Agent presence** (`src/server/agent-presence.ts`, shape in `src/shared/agent-presence.ts`): in-memory and TTL-swept like `IntentRegistry`, never persisted. Derived from feeds that already exist — every agent-originated mutation through `executeOperation` (no `x-pmx-workbench` marker) touches its caller as `tooling`; `ax.activity.ingest` kinds `session-start`/`session-end` attach/detach and `tool-start`/`tool-result` drive the phase; `POST /api/canvas/ax/presence` (`canvas_ax_state { action: "set-presence" }`) is the explicit path for `thinking`, cursor, focus. Transport-labelled writes (`api`/`mcp`/`sdk`/`cli`, no `agentId`) are **attributed to the single attached session** so one agent writing through MCP keeps one cursor; identified writers and multi-session boards stay separate; a human-started `browser` session absorbs agent-less writes under any label and takes the writer's name (`HUMAN_STARTED_SESSION_LABEL`); an attach whose label matches an already-attached session twin-merges (one agent, two channels — Copilot's extension + its MCP server) with the channel aliased onto the session. One `agent-presence` SSE frame carries the full snapshot on every change including expiry, and it also carries `activity` — the last 50 agent writes with a `describeWrite` summary (the External Steering feed and the session panel's Update rows). An explicit `attached: false` removes the presence outright (an ended session never lingers as an external writer). **`sessionActive` (any attached presence) gates all agent chrome except presence cursors** — `AgentPresenceLayer` paints every live writer (external ones `is-external`/dashed) so a human always sees where an agent is working; panels/chips/composer still mount on `sessionActive`, and a board with no writers at all stays byte-clean. Contract: `docs/ax-state-contract.md` (Agent presence); design and build plan: `docs/design.md`.
- **Human presence + user wins** (`src/server/human-presence.ts`, shape in `src/shared/human-presence.ts`): every open workbench tab heartbeats `POST /api/canvas/human-presence` (cursor, name, `grabbingNodeId`); one `human-presence` SSE frame per change. A held node is an **edit lock**: `executeOperation` refuses an agent write to it with 409 until release or the 8 s grab TTL (membership ops — dissolving its group, `group.add` — count as writes to the member), and the client vetoes a pending explicit intent on a grabbed node and records a `yield` timeline event. Human heartbeats are in `PRESENCE_EXEMPT_OPS` — they must never count as agent activity.
- **Shared undo stack with actors** (`mutation-history.ts`): `executeOperation` tags every recorded entry `human` (workbench marker) or `agent`; `GET /api/canvas/history` exposes `top`. The session panel offers undo only while an agent edit tops the stack and posts steering when the human takes it. SDK writes bypass the registry and default to `agent`.

Additional canvas-bound primitives: `elicitation` (request structured human input → respond), `mode-request` (request a plan/execute/autonomous transition → resolve), and a single `policy` singleton (tool/prompt policy: `tools.allowed|excluded|approvalRequired`, `prompt.systemAppend|mode`). All snapshot/restore with the rest of `PmxAxState` and are read via `canvas_ax_state { action: "get" }` / `canvas://ax-work` / `canvas://ax-context`.

#### Node interactions (capability-gated)

Eligible nodes emit one normalized, zod-validated `PmxAxInteraction` envelope (`{ type, sourceNodeId, payload, sourceSurface }`) that maps onto an AX operation. `applyAxInteraction` (`src/server/ax-interaction.ts`) is the single trust boundary and re-validates every interaction regardless of transport.

- **Capabilities:** `DEFAULT_NODE_AX_CAPABILITIES` is the per-node-type ceiling; a node may opt in / narrow via `data.axCapabilities` (`{ enabled, allowed }`), clamped to the ceiling (a node can never escalate). `html`/`html-primitive`, `mcp-app`, and internal `prompt`/`response` are disabled by default.
- **`sourceSurface` scoping:** sandboxed/opaque-origin iframe surfaces (`html-node`, `mcp-app`, `json-render`) are clamped to their OWN node — caller-supplied `nodeIds` are forced to `[sourceNodeId]`. Trusted surfaces (`native-node`, `adapter`) may target explicit nodeIds. **When adding a new sandboxed surface, add it to the `scoped` predicate** or it silently takes the permissive default.
- **Transports:** native node controls call `POST /api/canvas/ax/interaction` directly; sandboxed surfaces postMessage a nonce-tagged emit to the parent canvas, which validates source + per-surface nonce + node id before submitting. `html`/`mcp-app` use `window.PMX_AX.emit(type, payload)`; the json-render/graph viewer forwards a spec action named after an AX type (e.g. `on.press → { action: "ax.work.create", params }`).
- **Commands:** `ax.command.invoke` runs a registry command (`pmx.plan`, `pmx.execute`, `pmx.promote-context`, `pmx.summarize`, `pmx.review`) via `canvas_invoke_command`; unknown names are rejected (400) and a successful call records a `command` agent-event.
- **Delivery:** steering can be claimed by adapterless MCP clients (`canvas_ax_delivery { action: "claim" }` / `canvas://ax-pending-steering`) and acknowledged (`canvas_ax_delivery { action: "mark" }`); loop-safe (a consumer never receives steering it originated).

Interactions request PMX-AX primitives only — never arbitrary shell, tool, MCP, or host execution.

#### AX flows (panel and graph)

A task flow exists in two interchangeable forms. The `ax-flow` HTML primitive draws it as a panel;
`ax.flow.materialize` lays the same steps out as native nodes joined by `flow` edges with a
loop-back rail, each step linked to a work item. It is the only interaction that creates canvas
nodes, so it is granted to the `html` ceiling alone.

- Materialized steps carry `data.axStep` and render native Start/Done/Blocked controls
  (`src/client/nodes/AxStepControls.tsx`) in both the node body and the expanded overlay — the
  flow is drivable without the panel.
- Work-item status mirrors onto node status chips (`mirrorAxWorkStatusToNodes`), which is what
  makes the in-progress node visible on the board while an agent works.
- `src/server/ax-flow-loop.ts` advances the loop server-side via `setWorkItemsChangedListener`
  (see architecture rule 8), so it survives a browser reload and keeps running with the tab closed.
  A module-level `advancing` guard prevents re-entrancy.
- Step geometry and the shared flow shape live in `src/shared/ax-flow.ts` so server and client
  cannot drift.

### Spatial Semantics Layer

The canvas exposes spatial intelligence to agents via `canvas://spatial-context`:
- **Proximity clusters**: Automatically detects nodes grouped together on the canvas
- **Reading order**: Nodes sorted top-left to bottom-right (how humans read)
- **Pinned neighborhoods**: For each pinned node, lists nearby unpinned nodes (the human's implicit context)
- **`canvas://pinned-context`** now includes neighborhood data — nearby unpinned nodes for each pin

Use `canvas_query { action: "search" }` to find nodes by title/content keywords instead of parsing the full layout.

### Time Travel (Undo/Redo + History)

Every canvas mutation is recorded in an in-memory ring buffer (last 200 operations). Each entry captures forward/inverse closures for clean undo/redo.

- **`canvas_history`** (`action: "undo" | "redo"`) — step through history, reversing operations cleanly
- **`canvas://history`** — human-readable mutation timeline with cursor position
- **`canvas_snapshot`** (`action: "diff", snapshot`) — compare current canvas vs any saved snapshot (shows added/removed/modified nodes and edges)
- HTTP: `POST /api/canvas/undo`, `POST /api/canvas/redo`, `GET /api/canvas/history`

Design notes:
- History is session-scoped (in-memory, not persisted to disk)
- `arrange()` records as a single compound mutation (not N individual moves)
- Undo/redo emit SSE events so the browser updates immediately
- The `_suppressRecording` flag prevents undo/redo from creating new history entries

### Code Graph (Auto-Dependency Detection)

When file nodes are on the canvas, the system auto-detects import dependencies and creates `depends-on` edges between related files. The code graph updates live when files change.

- **`canvas://code-graph`** MCP resource — dependency structure: central files, isolated files, import/imported-by lists
- HTTP: `GET /api/canvas/code-graph`
- Supported languages: JS/TS (`import`/`require`), Python (`import`/`from`), Go (`import`), Rust (`mod`/`use crate`)
- Auto-edges use the `codegraph-` ID prefix and are suppressed from mutation history
- Recomputation is debounced (300ms) and triggered on file node add/remove and file content change

## Integration Paths

1. **MCP Server** (recommended) — `pmx-canvas --mcp`, auto-starts on first tool call
2. **HTTP API** — REST + SSE at `localhost:4313`
3. **JavaScript/TypeScript SDK (Bun runtime)** — `import { createCanvas } from 'pmx-canvas'`
4. **Agent Skills** — `skills/pmx-canvas/SKILL.md`, `skills/web-artifacts-builder/SKILL.md`, `skills/playwright-cli/SKILL.md`, `skills/pmx-canvas-testing/SKILL.md`, `skills/pmx-canvas-orchestration/SKILL.md` (multi-agent choreography ON the canvas: host executes, canvas is the graph/state/steering surface), plus repo-local agnostic PMX skills such as `doc-coauthoring`, `data-analysis`, `frontend-design`, `web-design-guidelines`, and `json-render-*`
