# PMX Canvas — Project Instructions

Standalone spatial canvas workbench for coding agents. Infinite 2D canvas with nodes, edges, pan/zoom, minimap, and real-time updates — controlled through MCP, HTTP API, or a Bun-based JavaScript/TypeScript SDK. Extracted from [PMX](https://github.com/pskoett/pmx).

The canvas is the agent's extended working memory: humans pin nodes to curate context, agents read that curation via MCP resources.

Provide concise, focused responses. Skip non-essential context, and keep examples minimal.

## Core Principles

### 1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

- **State assumptions explicitly** — If uncertain, ask rather than guess
- **Present multiple interpretations** — Don't pick silently when ambiguity exists
- **Push back when warranted** — If a simpler approach exists, say so
- **Stop when confused** — Name what's unclear and ask for clarification

### 2. Simplicity First
Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked
- No abstractions for single-use code
- No "flexibility" or "configurability" that wasn't requested
- No error handling for impossible scenarios
- If 200 lines could be 50, rewrite it
- **No backwards compatibility.** This project does not code for backwards
  compatibility: no legacy shims, deprecation aliases, dual code paths, or
  migration scaffolding for old clients/configs. When a behavior changes,
  change it cleanly and update everything that depends on it.

The test: Would a senior engineer say this is overcomplicated? If yes, simplify.

### 3. Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting
- Don't refactor things that aren't broken
- Match existing style, even if you'd do it differently
- If you notice unrelated dead code, mention it — don't delete it

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused
- Don't remove pre-existing dead code unless asked

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution
Define success criteria. Loop until verified.

Transform imperative tasks into verifiable goals:

| Instead of... | Transform to... |
|---------------|-----------------|
| "Add validation" | "Write tests for invalid inputs, then make them pass" |
| "Fix the bug" | "Write a test that reproduces it, then make it pass" |
| "Refactor X" | "Ensure tests pass before and after" |

For multi-step tasks, state a brief plan:
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]

Strong success criteria let the agent loop independently. Weak criteria ("make it work") require constant clarification.

### 5. Learn and Improve
Every mistake is a learning opportunity. Log it, learn from it, prevent it.

- After ANY correction from the user: log the lesson
- Write rules for yourself that prevent the same mistake
- Log to `.learnings/ERRORS.md`, `LEARNINGS.md`, or `FEATURE_REQUESTS.md`
- Promote broadly applicable learnings to `CLAUDE.md` and `AGENTS.md`

## TypeScript Guardrails

1. **Do not introduce dynamic imports by default**: Do not add `await import(...)` or similar dynamic-loading patterns unless the user explicitly asks for them or the existing architecture requires them.
2. **Do not use `any` casts or annotations**: Avoid `as any`, `: any`, `Promise<any>`, or equivalent escape hatches. Model the real type instead.
3. **Do not add defensive noise by default**: Do not add extra defensive checks or broad `try/catch` blocks unless they are necessary for a specific runtime boundary, recovery path, or user-requested behavior.

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user

## Canvas Architecture Rules

1. **State lives in the server.** `CanvasStateManager` in `canvas-state.ts` is the singleton source of truth. All mutations go through it. The browser is a renderer. State survives browser refresh.

2. **SSE-created nodes must sync to server-side canvasState.** When `emitPrimaryWorkbenchEvent` creates nodes on the client via SSE (`workbench-open`, `ext-app-open`), also create them in the server-side `canvasState` singleton. Otherwise `canvas_query { action: "layout" }` returns 0 nodes and `canvas-layout-update` reconciliation deletes client-only nodes.

3. **Rebuild canvas bundle after client source changes.** After modifying any file under `src/client/`, run `bun run build` before testing in the browser. The dist bundle is not auto-built; stale bundles silently hide new features. **An already-open tab used to keep old JS through every dev rebuild** — `reloadIfServerUpgraded` compared the package *version* only, which a rebuild+restart never bumps; an entire debugging arc (2026-08-24) chased "still broken" reports that were a stale tab faithfully reproducing already-fixed bugs. The `connected` frame now carries a served-bundle stamp and a mismatched tab reloads itself on (re)connect — but tabs opened before the stamp shipped, and any surface you cannot force-navigate, still need one manual hard reload. Before believing a UI bug report (yours or the user's), first establish WHICH bundle the reporting surface is actually running.

4. **Canvas edits happen in place.** The web canvas is a live multi-node workspace. Flows should update the current session without evicting prior nodes (including prior document nodes). Agents must not describe the canvas as requiring reopen/replace for additional documents.

5. **MCP tools map 1:1 to PmxCanvas methods.** When adding a new canvas operation, add it to: (a) `CanvasStateManager`, (b) `PmxCanvas` class in `src/server/index.ts`, (c) HTTP endpoint in `src/server/server.ts`, (d) MCP tool in `src/mcp/server.ts`. All four layers must stay in sync.

6. **Context pins are the bridge between human and agent.** The human pins nodes in the browser, the agent reads `canvas://pinned-context`. This is the primary communication channel from human spatial curation to agent context. Preserve this flow.

7. **No HTTP server port assumptions.** Default port is 4313 but can be changed via `--port` or `PMX_WEB_CANVAS_PORT` for server startup; when both are unset the server also falls back to `PMX_CANVAS_PORT` (0.4.0), so one variable can point the client and server at the same port. Amp orbs: the portal-assigned `PORT` env is honored after those (only when `AMP_ORB` is set), so an orb service command needs no port flag. `PMX_CANVAS_PORT` otherwise remains the agent CLI's client-side default target port. The server tries fallback ports if the preferred one is taken. **`PMX_CANVAS_WORKSPACE_ROOT`** pins the workspace root for both the MCP same-workspace lookup and the daemon `startCanvasServer` binds, overriding the launch `cwd` — set it when a host spawns `--mcp` from an incidental dir (e.g. `~/.copilot`) so the canvas targets the real project. When the preferred port is held by a *different*-workspace daemon, the MCP server now attaches to it (inherits its workspace) instead of silently splitting to a fallback port; use `PMX_CANVAS_ALLOW_WORKSPACE_SPLIT=1` to force a separate canvas.

8. **Mutation listeners are single-slot.** `canvasState.onMutation` and
   `setWorkItemsChangedListener` hold exactly ONE callback each — registering a second consumer
   silently displaces the first. `server.ts` claims `onMutation` whenever a server starts, so
   whether a side effect fires depends on whether anything booted a server first. Fan out inside
   the existing registration; never add a competing one.

9. **The viewport is a SCREEN-space translate, not a world-space camera.** The canvas renders
   `matrix(scale, 0, 0, scale, x, y)`, so `screen = world * scale + viewport`. To put a node at a
   fixed screen margin, compute `margin - node.position * scale` — what `fitCanvasView` and the
   client's `focusNode` do. Writing `node.position - margin / scale` mixes conventions and lands
   the node off-screen at any scale ≠ 1 (it shipped twice: `view.focus` in 0.4.6, and `fit`'s
   world-space padding, which collapses under floating chrome at fit zoom). Margins that must
   clear overlays are screen-space constants. Since the rail-chrome restructure the canvas region
   itself excludes the rail/top bar — screen-space math anchors on `canvasArea()`
   (`src/client/canvas/canvas-area.ts`), never `window.innerWidth`.

10. **json-render / graph viewers read their spec once, at document load.** The iframe `src` is
    keyed on `nodeId + ?v=specVersion`, so any content update MUST bump `specVersion`
    (`buildJsonRenderNodeUpdate` does). Skip it and the URL is byte-identical, the iframe never
    reloads, and the node renders stale forever while the server data is correct — the live
    workboard shipped that way in 0.4.6.

## Tech Stack

- **Runtime:** Bun (build + serve)
- **UI:** Preact + @preact/signals
- **Styling:** CSS custom properties for the main canvas UI, plus a Tailwind CLI build for the json-render viewer bundle
- **Server:** Bun.serve (HTTP + SSE)
- **MCP:** @modelcontextprotocol/sdk (stdio transport)
- **Bundler:** Bun bundler for client SPA
- **Dependencies:** `preact`, `@preact/signals`, `marked`, `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `zod`

## Build & Run

```bash
bun install                    # Install dependencies
bun run build                  # Build client SPA → dist/canvas/
bun run dev                    # Start server + open browser
bun run dev:demo               # Start with the showcase demo board
bun run start                  # Start headless (no browser)
pmx-canvas serve --daemon      # Start daemonized server with pid/log tracking
pmx-canvas serve status        # Check daemon health + pid state
pmx-canvas serve stop          # Stop daemonized server
pmx-canvas --mcp               # Run as MCP server
pmx-canvas --theme=light       # Start with light theme
bun run lint                   # Biome lint + format check (lint:fix to write)
```

## Persistence

All generated files live under `.pmx-canvas/` in the workspace root:

```
.pmx-canvas/
  canvas.db            # SQLite state, snapshots, context pins, and blobs — git-committable
  artifacts/           # web-artifact HTML bundles
    .web-artifacts/    # reusable per-artifact build projects
  daemon-<port>.log    # daemon stdout/stderr (when started with `serve --daemon`)
  daemon-<port>.pid    # daemon pid file
```

State auto-saves every mutation (debounced 500ms) and auto-loads on server start. Pre-0.2 legacy layouts (`.pmx-canvas/state.json`, `.pmx-canvas.json`, snapshot dirs, blob files) are no longer imported as of 0.4.0 — restore them with a 0.3.x install first if needed.

- Override DB path: `PMX_CANVAS_DB_PATH` env var
- `PMX_CANVAS_STATE_FILE` remains only as a `.db`-path alias (non-`.db` values are ignored with a boot warning as of 0.4.0)
- `--demo` only seeds when canvas is empty (won't clobber restored state)
- State saves: viewport, nodes, edges, annotations, context pins, snapshots, and large node blobs
- Stop the server or flush/close the SDK before committing `canvas.db`; shutdown checkpoints SQLite WAL data into the DB file.

## Demo Board

`src/server/demo-state.json` is a **generated fixture — never hand-edit it.** Rebuild it with:

```bash
bun run scripts/generate-demo-board.ts
```

The generator builds the board through the real HTTP API, then rewrites live ids and timestamps
to stable ones so the output is byte-deterministic (run it twice, get the same file). Anything it
creates must go through the API — that is what keeps the fixture honest about what the product
actually produces.

The fixture embeds each HTML primitive's generated markup plus the canvas-bound AX partition, so
it goes stale the moment a renderer, primitive, or node type changes — silently, because counts
and coverage assertions are just as happy with month-old markup. `tests/unit/demo.test.ts` guards
this by rebuilding every primitive from the stored `primitiveData` and byte-comparing against the
current renderer. Regenerate and re-run that test after touching any of the above.

## Themes

Nine themes: `dark` (default), `light`, `high-contrast`, `midnight`, `sepia`, `arctic`, `ember`, `forest`, `volt`. The canonical registry is `src/shared/themes.ts`; per-theme CSS variable blocks live in `src/client/theme/global.css` + `surface-theme.css` (kept in sync by `tests/unit/surface-theme-tokens.test.ts`). Set via:
- CLI: `--theme=light`
- Env: `PMX_CANVAS_THEME=light`
- Browser: rail theme picker (sun/moon button in the left tool rail opens the theme menu)

Embedded dark/light-only viewers (json-render, MCP apps) collapse named themes to their scheme via `canvasThemeScheme` (e.g. `sepia` → light, `ember` → dark).

## Releasing

The full release recipe (pre-flight gates, version bump, tag → publish, smoke,
common gotchas) lives in [`docs/RELEASE.md`](docs/RELEASE.md). The README
intentionally does not document the release flow — it's an end-user-facing file
and the release process is maintainer-only.

## Changelog Style

Keep `CHANGELOG.md` entries simple and user-facing — short, plain sentences, no
deep technical exposition, no exhaustive migration tables. Per release:

- Optional **Highlights** — 3–5 one-line bullets of the most notable changes
- **Added** / **Changed** / **Fixed** (and **Breaking** when needed) — each
  bullet is one plain sentence describing the change from the user's
  perspective (what they can now do or what behaves differently)
- No nested sub-bullets, tool-by-tool mappings, or implementation detail; link
  to docs for anything long-form

Example bullet: "Added a `/rename` slash command to rename the current session
directly from the composer."

## Testing Conventions

Use the `pmx-canvas-testing` skill for the repo-standard verification ladder, test command
selection, and handoff expectations whenever you change code in this project.

Use the `published-consumer-e2e` skill when you need to validate PMX Canvas as an installed
package in a clean temp consumer instead of the repo dev path.

1. **Never dismiss failing tests.** Investigate every failure before declaring success. A "pre-existing" failure still needs resolution or explicit acknowledgment.

2. **Verify the full stack.** Don't just check that code compiles — start the server, hit the endpoints, confirm the SPA loads:
   ```bash
   bun run src/cli/index.ts --no-open --demo &
   curl http://localhost:4313/api/canvas/state        # Should return 3 nodes, 2 edges
   curl http://localhost:4313/canvas/index.js -o /dev/null -w "%{http_code}"  # Should be 200
   curl -N http://localhost:4313/api/workbench/events  # Should stream SSE events
   ```

3. **Test MCP server separately.** The MCP server can be tested with `bun run src/mcp/server.ts` and sending JSON-RPC over stdin.

4. **Assert the user-visible effect, not the server number.** When a feature's value IS the
   rendered result — a viewport move, a node being visible, iframe-backed content refreshing —
   assert the observable: the node's `getBoundingClientRect()` lands in the viewport, the iframe
   URL actually changed, the rendered text updated. A viewport tuple, a `panned: true`, or updated
   `node.data` is an intermediate, and asserting one locks in whatever convention the
   implementation happened to use. Three features shipped broken with green tests this way
   (`view.focus`, the live workboard, `fit`) — in two cases the wrong-convention assertions were
   added by the very commit that introduced the bug. See architecture rules 9 and 10 for the two
   traps this repo keeps hitting.

## Canvas Types

**Node types:** `markdown`, `status`, `context`, `ledger`, `trace`, `file`, `diff`, `image`, `html`, `mermaid`, `mcp-app`, `webpage`, `json-render`, `graph`, `group`, plus internal thread node types `prompt` and `response`

**Edge types:** `flow`, `depends-on`, `relation`, `references` — all support labels, styles (solid/dashed/dotted), and animation.

## MCP Server

22 tools: 16 action-discriminated composites (`canvas_node`, `canvas_render`, `canvas_edge`, `canvas_group`, `canvas_history`, `canvas_view`, `canvas_query`, `canvas_webview`, `canvas_app`, `canvas_snapshot`, `canvas_ax_state`, `canvas_ax_work`, `canvas_ax_gate`, `canvas_ax_timeline`, `canvas_ax_delivery`, `canvas_intent`) plus 6 standalone tools (`canvas_batch`, `canvas_pin_nodes`, `canvas_invoke_command`, `canvas_ax_interaction`, `canvas_ingest_activity`, `canvas_screenshot`). The 57 legacy single-purpose tools the composites replaced were removed in v0.3.0; v0.4.0 shipped the `canvas_snapshot` composite and removed the 6 deprecated snapshot standalones. Prefer composites for new MCP calls; see `docs/mcp.md` for the authoritative tool list and the legacy-to-composite migration reference. `canvas_intent` (Ghost Cursor of Intent) is composite-only — its `intent.signal`/`intent.update`/`intent.clear` ops have no standalone equivalent.

The `diagram` action of `canvas_app` is a thin preset in `src/server/diagram-presets.ts` that proxies to the hosted [Excalidraw MCP app](https://github.com/excalidraw/excalidraw-mcp) (`https://mcp.excalidraw.com/mcp`). For any other MCP Apps server, use `canvas_app` action `open-mcp-app`.

14 resources: `canvas://pinned-context`, `canvas://schema`, `canvas://layout`, `canvas://summary`, `canvas://spatial-context`, `canvas://history`, `canvas://code-graph`, `canvas://ax`, `canvas://ax-context`, `canvas://ax-timeline`, `canvas://ax-work`, `canvas://ax-pending-steering`, `canvas://ax-delivery`, `canvas://skills` (plus per-skill `canvas://skills/<name>`)

Resource change notifications: the MCP server emits `notifications/resources/updated` when canvas state changes. Pin changes notify `canvas://pinned-context`; all mutations notify `canvas://layout`, `canvas://summary`, `canvas://spatial-context`, `canvas://history`, and `canvas://code-graph`. This enables real-time human→agent collaboration — humans pin nodes in the browser, agents are notified immediately.

### AX Primitives (host-agnostic)

Neutral, agent-agnostic agent-experience primitives. The core never imports a host SDK (e.g. `@github/copilot-sdk`); host adapters map onto these HTTP/MCP surfaces. State lives in three partitions:

- **Canvas-bound** (`focus`, `work-item`, `approval-gate`, `review-annotation`): live in `PmxAxState`, participate in snapshots + restore, cleared by `canvas_view { action: "clear" }`. Read via `canvas_ax_state { action: "get" }` / `canvas://ax-work`.
- **Timeline** (`agent-event`, `evidence-item`, `steering-message`): persist in dedicated DB tables for diagnostics/continuity, bounded by retention (500 rows/table), NOT restored by snapshots, NOT cleared by `canvas_view { action: "clear" }`. Read via `canvas_ax_timeline { action: "read" }` / `canvas://ax-timeline`.
- **Host/session** (`host-capability`): reported by adapters into its own table, exposed for diagnostics, survives `canvas_view { action: "clear" }`. Read via `canvas_ax_state { action: "get" }`.

Approval gates implement PMX approvals first (`pending → approved/rejected/held`); host permission hooks are mapped only where low-risk. **Unattended-approval policy** (`src/server/ax-gate-ttl.ts`): every gate carries `expiresAt` (`ttlMs`, default `PMX_CANVAS_GATE_TTL_MS` = 5 min); a 1s sweeper started with the server resolves unanswered gates to `held` (non-approval), records a `policy` agent-event, and re-emits presence; `POST /api/canvas/ax/approval/:id/reopen` (HTTP/SDK only — a human action) restarts the clock. **Scope fence** (`src/server/scope-fence.ts`): `policy.scope = { nodeIds, padding }` makes `executeOperation` refuse agent-originated mutations outside the fence with 403 (`meta.fromWorkbench` exempts the human; batch inner ops are always agent writes, so the fence cannot be keyed on `suppressAutoGhost`); unknown mutating ops are refused under a fence by default — add new layout ops to `checkScopeFence`.

- **Agent presence** (`src/server/agent-presence.ts`, shape in `src/shared/agent-presence.ts`): in-memory and TTL-swept like `IntentRegistry`, never persisted. Derived from feeds that already exist — every agent-originated mutation through `executeOperation` (no `x-pmx-workbench` marker) touches its caller as `tooling`; `ax.activity.ingest` kinds `session-start`/`session-end` attach/detach and `tool-start`/`tool-result` drive the phase; `POST /api/canvas/ax/presence` (`canvas_ax_state { action: "set-presence" }`) is the explicit path for `thinking`, cursor, focus. Transport-labelled writes (`api`/`mcp`/`sdk`/`cli`, no `agentId`) are **attributed to the single attached session** so one agent writing through MCP keeps one cursor; identified writers and multi-session boards stay separate; a human-started `browser` session absorbs agent-less writes under any label and takes the writer's name (`HUMAN_STARTED_SESSION_LABEL`); an attach whose label matches an already-attached session twin-merges (one agent, two channels — Copilot's extension + its MCP server) with the channel aliased onto the session. One `agent-presence` SSE frame carries the full snapshot on every change including expiry, and it also carries `activity` — the last 50 agent writes with a `describeWrite` summary (the External Steering feed and the session panel's Update rows). An explicit `attached: false` removes the presence outright (an ended session never lingers as an external writer). **`sessionActive` (any attached presence) gates all agent chrome except presence cursors** — `AgentPresenceLayer` paints every live writer (external ones `is-external`/dashed) so a human always sees where an agent is working; panels/chips/composer still mount on `sessionActive`, and a board with no writers at all stays byte-clean. Plan: `design/rail-chrome-v2/PLAN.md`.
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

## Conventions

- All server-side modules live in `src/server/`
- All client-side Preact components live in `src/client/`
- The MCP server imports from `src/server/index.ts` — it does not duplicate state management
- CSS uses custom properties (`:root { --c-* }`) — no Tailwind classes
- Imports use `.js` extensions for Bun module resolution
- The `canvasState` singleton is shared across HTTP handlers, MCP tools, and the SDK class
- **Client writes go through the bridge helpers** (`requestJson` / `requestOk` /
  `requestBestEffort` in `src/client/state/intent-bridge.ts`), never a bare `fetch`: they carry
  the `X-PMX-Workbench` marker that tells the server the write is the human's. Without it the
  human's own click is booked as an anonymous `api` agent — it lights the External Steering
  indicator, shows as agent work in the session timeline, and is subject to the scope fence
  (context pins and annotations shipped that way; `tests/client/context-pin-bar.test.tsx`
  asserts the marker)
- **No native browser UI in client flows.** `window.prompt`, `window.alert`, `window.confirm`,
  and title-attribute tooltips are silent no-ops in embedded browser panes (Claude, Copilot,
  and Codex all drive the workbench through one) — a flow depending on them "does nothing"
  there, with no error. This shipped three times. Use `askText`/`TextPrompt`
  (`src/client/canvas/TextPrompt.tsx`) for input, `BarHint` for hover hints, and an in-flow
  caption where an anchored tooltip would clip inside an overflow container.

## Adding New Node Types

1. Add the type string to the union in `src/server/canvas-state.ts` (`CanvasNodeState.type`),
   plus `canvas-provenance.ts` (`CanvasNodeType`), `ax-interaction.ts`
   (`DEFAULT_NODE_AX_CAPABILITIES` — exhaustive record), `canvas-schema.ts` (create schema),
   `canvas-validation.ts` (`NODE_MIN_CREATE_SIZES` floor)
2. Create a renderer component in `src/client/nodes/YourNode.tsx`
3. Add the case to the render switches in `src/client/canvas/CanvasViewport.tsx` AND
   `ExpandedNodeOverlay.tsx`, plus the exhaustive records in `state/node-factory.ts` and
   `canvas/kind-colors.ts` (the minimap + group chips read it), `types.ts` (union, `TYPE_LABELS`,
   `EXPANDABLE_TYPES`), `icons.tsx`
4. **Add the type to `isCanvasNodeType` in `src/client/state/sse-bridge.ts`** — this runtime
   guard silently DROPS unknown types during layout apply, so a missed entry renders nothing
   in the live workbench even though every unit/client test passes
5. Add to `NODE_TYPES` + the MCP `extraShape` enum in `src/server/operations/ops/nodes.ts`
   and a `defaultNodeSize` case
6. Update `SKILL.md`, `readme.md`, and `docs/node-types.md` with the new type
7. Regenerate the demo board (`bun run scripts/generate-demo-board.ts`) and add the type to it —
   see [Demo Board](#demo-board)
8. **Open the type in a real browser before calling it done.** Steps 3–5 can all be complete and
   every unit and client test green while the node renders nothing (see step 4). A DOM check on a
   live board is the only thing that catches it.

## Adding New HTTP Endpoints

1. Add the handler function in `src/server/server.ts`
2. Add the route in the `Bun.serve` fetch handler
3. Add the corresponding method to `PmxCanvas` class in `src/server/index.ts`
4. Add the MCP tool in `src/mcp/server.ts`
5. Update `SKILL.md`, `readme.md`, and CLI help text
6. **Document it in the contract docs** — `docs/http-api.md` (and `docs/mcp.md` / `docs/cli.md`
   for a tool/action/command). `docs/api-stability.md` defines the public surface as *what those
   files document*, so an undocumented route is both invisible to agents and outside the
   stability contract. The same applies to counts and tables agents read as authoritative: the
   tool count, the composite `action` lists, the theme list, and the AX capability matrix in
   `skills/pmx-canvas/references/full-reference.md` all went stale mid-cycle at least once.

**Routes that serve raw file bytes need four separate guards** (the 0.4.7 `file-bytes` route
shipped without any of them):
- **Confine on REAL paths** — `realpathSync` the candidate *and* the workspace root before
  comparing. A lexical `resolve()`/`relative()` check stops `..` and absolute escapes but not a
  symlink inside the workspace; realpath the root too, or a symlinked root (macOS `/tmp`)
  rejects legitimate files.
- **Derive `Content-Type` from the bytes**, never from caller-writable node data, and send
  `X-Content-Type-Options: nosniff` plus a non-inline disposition for anything not deliberately
  rendered.
- **Stream** (`Bun.file`) with a size ceiling and an `isFile()` check — a directory 500s and a
  FIFO hangs a server that has no request timeout.
- **Sandbox any iframe pointing at it.** If every other iframe in the client is sandboxed, a new
  unsandboxed one is the bug.

## Creating a New Skill

1. Create folder in `skills/` with skill name (lowercase, hyphens)
2. Create `SKILL.md` with YAML frontmatter:
   ```yaml
   ---
   name: skill-name
   description: What it does and when to use it.
   ---
   ```
3. Add optional directories: `scripts/`, `references/`, `assets/`
4. Ensure folder name matches `name` field

## Validating Skills

- Frontmatter has required `name` and `description`
- `name` is lowercase, hyphens only, matches folder
- `description` explains what AND when to use
- No README.md or other auxiliary files in skill folder
- Agent-facing pipeline skills live in `.agents/skills/` and must be mirrored identically in `.claude/skills/` and `.opencode/skills/`
- Run `bun run validate:agent-skills` after changing any mirrored skill files

## Error Hygiene

When maintaining `.learnings/`:
1. Keep only high-signal entries: unresolved blockers, recurring failures, or incidents that require durable guardrails
2. Remove one-off resolved noise after extracting reusable guidance
3. Keep active learnings concise and scannable

## Agent Skill Pipeline

- Agent-facing pipeline skills are stored in `.agents/skills/` and mirrored in `.claude/skills/` and `.opencode/skills/`
- Use `skill-pipeline` as the top-level router / entrypoint for non-trivial coding tasks
- Claude Code hooks are configured in `.claude/settings.json` and point at the mirrored `.claude/skills/` scripts
- Keep the three skill trees byte-for-byte identical; verify with `bun run validate:agent-skills`
- The skill trees are local-only dev tooling and gitignored — a clean checkout does not contain them, and `validate:agent-skills` skips (exits 0) when they are absent
- Use the skill definitions under `.agents/skills/` as the canonical instructions

### How To Run It

Treat pipeline depth as task-sized:

- Trivial tasks: no pipeline
- Small tasks: run `verify-gate` then `simplify-and-harden`
- Medium tasks: run `intent-framed-agent`, then `verify-gate`, then `simplify-and-harden`
- Large or long-running tasks: run `plan-interview`, then `intent-framed-agent` with `context-surfing`, then `verify-gate`, then `simplify-and-harden`, then `self-improvement`
- Batch tasks: run `agent-teams-simplify-and-harden`, then `self-improvement`
- CI/headless review: use `simplify-and-harden-ci` and `self-improvement-ci`; use `learning-aggregator-ci` and `eval-creator-ci` for the outer loop
- Run `pre-flight-check` at session start when hooks are available; Claude hooks also wire `context-surfing` handoff detection and `self-improvement` reminders
- Use `learning-aggregator` and `eval-creator` for cross-session outer-loop improvement work

### Version

- Imported pipeline version manifest: `.agents/skills/PIPELINE_VERSIONS.md`
- Canonical imported revision: `01ae6f8b3c9a0ab96e8ec87b27fdd88677696cde` from `https://github.com/pskoett/pskoett-ai-skills`

## Browser Automation Visibility Rule

When using browser automation for UI investigation:
1. Use a visible browser window (headed mode) so the user can see what is happening
2. Do not run headless unless the user explicitly asks for it
