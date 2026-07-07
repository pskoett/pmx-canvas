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

3. **Rebuild canvas bundle after client source changes.** After modifying any file under `src/client/`, run `bun run build` before testing in the browser. The dist bundle is not auto-built; stale bundles silently hide new features.

4. **Canvas edits happen in place.** The web canvas is a live multi-node workspace. Flows should update the current session without evicting prior nodes (including prior document nodes). Agents must not describe the canvas as requiring reopen/replace for additional documents.

5. **MCP tools map 1:1 to PmxCanvas methods.** When adding a new canvas operation, add it to: (a) `CanvasStateManager`, (b) `PmxCanvas` class in `src/server/index.ts`, (c) HTTP endpoint in `src/server/server.ts`, (d) MCP tool in `src/mcp/server.ts`. All four layers must stay in sync.

6. **Context pins are the bridge between human and agent.** The human pins nodes in the browser, the agent reads `canvas://pinned-context`. This is the primary communication channel from human spatial curation to agent context. Preserve this flow.

7. **No HTTP server port assumptions.** Default port is 4313 but can be changed via `--port` or `PMX_WEB_CANVAS_PORT` for server startup. `PMX_CANVAS_PORT` is only the agent CLI's client-side default target port. The server tries fallback ports if the preferred one is taken. **`PMX_CANVAS_WORKSPACE_ROOT`** pins the workspace root for both the MCP same-workspace lookup and the daemon `startCanvasServer` binds, overriding the launch `cwd` — set it when a host spawns `--mcp` from an incidental dir (e.g. `~/.copilot`) so the canvas targets the real project. When the preferred port is held by a *different*-workspace daemon, the MCP server now attaches to it (inherits its workspace) instead of silently splitting to a fallback port; use `PMX_CANVAS_ALLOW_WORKSPACE_SPLIT=1` to force a separate canvas.

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
bun run dev:demo               # Start with the saved dashboard demo board
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

State auto-saves every mutation (debounced 500ms) and auto-loads on server start. Legacy files (`.pmx-canvas/state.json`, `.pmx-canvas.json`, `.pmx-canvas/snapshots/`, `.pmx-canvas-snapshots/`, and blob files) are imported into SQLite and renamed to `.bak` on first boot.

- Override DB path: `PMX_CANVAS_DB_PATH` env var
- Backward-compatible legacy JSON path: `PMX_CANVAS_STATE_FILE` env var
- `--demo` only seeds when canvas is empty (won't clobber restored state)
- State saves: viewport, nodes, edges, annotations, context pins, snapshots, and large node blobs
- Stop the server or flush/close the SDK before committing `canvas.db`; shutdown checkpoints SQLite WAL data into the DB file.

## Themes

Three themes: `dark` (default), `light`, `high-contrast`. Set via:
- CLI: `--theme=light`
- Env: `PMX_CANVAS_THEME=light`
- Browser: toolbar toggle button (sun/moon icon)

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

## Canvas Types

**Node types:** `markdown`, `status`, `context`, `ledger`, `trace`, `file`, `image`, `html`, `mcp-app`, `webpage`, `json-render`, `graph`, `group`, plus internal thread node types `prompt` and `response`

**Edge types:** `flow`, `depends-on`, `relation`, `references` — all support labels, styles (solid/dashed/dotted), and animation.

## MCP Server

27 tools: 15 action-discriminated composites (`canvas_node`, `canvas_render`, `canvas_edge`, `canvas_group`, `canvas_history`, `canvas_view`, `canvas_query`, `canvas_webview`, `canvas_app`, `canvas_ax_state`, `canvas_ax_work`, `canvas_ax_gate`, `canvas_ax_timeline`, `canvas_ax_delivery`, `canvas_intent`) plus 12 standalone tools (`canvas_batch`, `canvas_pin_nodes`, `canvas_invoke_command`, `canvas_ax_interaction`, `canvas_ingest_activity`, `canvas_screenshot`, plus the 6 snapshot tools — deprecated, pending a `canvas_snapshot` composite in v0.4). The 57 legacy single-purpose tools the composites replaced were removed in v0.3.0. Prefer composites for new MCP calls; see `docs/mcp.md` for the authoritative tool list and the legacy-to-composite migration reference. `canvas_intent` (Ghost Cursor of Intent) is composite-only — its `intent.signal`/`intent.update`/`intent.clear` ops have no standalone equivalent.

The `diagram` action of `canvas_app` is a thin preset in `src/server/diagram-presets.ts` that proxies to the hosted [Excalidraw MCP app](https://github.com/excalidraw/excalidraw-mcp) (`https://mcp.excalidraw.com/mcp`). For any other MCP Apps server, use `canvas_app` action `open-mcp-app`.

14 resources: `canvas://pinned-context`, `canvas://schema`, `canvas://layout`, `canvas://summary`, `canvas://spatial-context`, `canvas://history`, `canvas://code-graph`, `canvas://ax`, `canvas://ax-context`, `canvas://ax-timeline`, `canvas://ax-work`, `canvas://ax-pending-steering`, `canvas://ax-delivery`, `canvas://skills` (plus per-skill `canvas://skills/<name>`)

Resource change notifications: the MCP server emits `notifications/resources/updated` when canvas state changes. Pin changes notify `canvas://pinned-context`; all mutations notify `canvas://layout`, `canvas://summary`, `canvas://spatial-context`, `canvas://history`, and `canvas://code-graph`. This enables real-time human→agent collaboration — humans pin nodes in the browser, agents are notified immediately.

### AX Primitives (host-agnostic)

Neutral, agent-agnostic agent-experience primitives. The core never imports a host SDK (e.g. `@github/copilot-sdk`); host adapters map onto these HTTP/MCP surfaces. State lives in three partitions:

- **Canvas-bound** (`focus`, `work-item`, `approval-gate`, `review-annotation`): live in `PmxAxState`, participate in snapshots + restore, cleared by `canvas_view { action: "clear" }`. Read via `canvas_ax_state { action: "get" }` / `canvas://ax-work`.
- **Timeline** (`agent-event`, `evidence-item`, `steering-message`): persist in dedicated DB tables for diagnostics/continuity, bounded by retention (500 rows/table), NOT restored by snapshots, NOT cleared by `canvas_view { action: "clear" }`. Read via `canvas_ax_timeline { action: "read" }` / `canvas://ax-timeline`.
- **Host/session** (`host-capability`): reported by adapters into its own table, exposed for diagnostics, survives `canvas_view { action: "clear" }`. Read via `canvas_ax_state { action: "get" }`.

Approval gates implement PMX approvals first (`pending → approved/rejected`); host permission hooks are mapped only where low-risk.

Additional canvas-bound primitives: `elicitation` (request structured human input → respond), `mode-request` (request a plan/execute/autonomous transition → resolve), and a single `policy` singleton (tool/prompt policy: `tools.allowed|excluded|approvalRequired`, `prompt.systemAppend|mode`). All snapshot/restore with the rest of `PmxAxState` and are read via `canvas_ax_state { action: "get" }` / `canvas://ax-work` / `canvas://ax-context`.

#### Node interactions (capability-gated)

Eligible nodes emit one normalized, zod-validated `PmxAxInteraction` envelope (`{ type, sourceNodeId, payload, sourceSurface }`) that maps onto an AX operation. `applyAxInteraction` (`src/server/ax-interaction.ts`) is the single trust boundary and re-validates every interaction regardless of transport.

- **Capabilities:** `DEFAULT_NODE_AX_CAPABILITIES` is the per-node-type ceiling; a node may opt in / narrow via `data.axCapabilities` (`{ enabled, allowed }`), clamped to the ceiling (a node can never escalate). `html`/`html-primitive`, `mcp-app`, and internal `prompt`/`response` are disabled by default.
- **`sourceSurface` scoping:** sandboxed/opaque-origin iframe surfaces (`html-node`, `mcp-app`, `json-render`) are clamped to their OWN node — caller-supplied `nodeIds` are forced to `[sourceNodeId]`. Trusted surfaces (`native-node`, `adapter`) may target explicit nodeIds. **When adding a new sandboxed surface, add it to the `scoped` predicate** or it silently takes the permissive default.
- **Transports:** native node controls call `POST /api/canvas/ax/interaction` directly; sandboxed surfaces postMessage a nonce-tagged emit to the parent canvas, which validates source + per-surface nonce + node id before submitting. `html`/`mcp-app` use `window.PMX_AX.emit(type, payload)`; the json-render/graph viewer forwards a spec action named after an AX type (e.g. `on.press → { action: "ax.work.create", params }`).
- **Commands:** `ax.command.invoke` runs a registry command (`pmx.plan`, `pmx.execute`, `pmx.promote-context`, `pmx.summarize`, `pmx.review`) via `canvas_invoke_command`; unknown names are rejected (400) and a successful call records a `command` agent-event.
- **Delivery:** steering can be claimed by adapterless MCP clients (`canvas_ax_delivery { action: "claim" }` / `canvas://ax-pending-steering`) and acknowledged (`canvas_ax_delivery { action: "mark" }`); loop-safe (a consumer never receives steering it originated).

Interactions request PMX-AX primitives only — never arbitrary shell, tool, MCP, or host execution.

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
- **`canvas_diff`** — compare current canvas vs any saved snapshot (shows added/removed/modified nodes and edges)
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
4. **Agent Skills** — `skills/pmx-canvas/SKILL.md`, `skills/web-artifacts-builder/SKILL.md`, `skills/playwright-cli/SKILL.md`, `skills/pmx-canvas-testing/SKILL.md`, plus repo-local agnostic PMX skills such as `doc-coauthoring`, `data-analysis`, `frontend-design`, `web-design-guidelines`, and `json-render-*`

## Conventions

- All server-side modules live in `src/server/`
- All client-side Preact components live in `src/client/`
- The MCP server imports from `src/server/index.ts` — it does not duplicate state management
- CSS uses custom properties (`:root { --c-* }`) — no Tailwind classes
- Imports use `.js` extensions for Bun module resolution
- The `canvasState` singleton is shared across HTTP handlers, MCP tools, and the SDK class

## Adding New Node Types

1. Add the type string to the union in `src/server/canvas-state.ts` (`CanvasNodeState.type`)
2. Create a renderer component in `src/client/nodes/YourNode.tsx`
3. Add the case to `src/client/canvas/CanvasNode.tsx` switch statement
4. Add to the MCP tool's `type` enum in `src/mcp/server.ts`
5. Update `SKILL.md` and `readme.md` with the new type

## Adding New HTTP Endpoints

1. Add the handler function in `src/server/server.ts`
2. Add the route in the `Bun.serve` fetch handler
3. Add the corresponding method to `PmxCanvas` class in `src/server/index.ts`
4. Add the MCP tool in `src/mcp/server.ts`
5. Update `SKILL.md`, `readme.md`, and CLI help text

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
