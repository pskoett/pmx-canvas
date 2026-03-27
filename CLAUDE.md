# PMX Canvas — Project Instructions

Standalone spatial canvas workbench for coding agents. Infinite 2D canvas with nodes, edges, pan/zoom, minimap, and real-time updates — controlled through MCP, HTTP API, or Node.js SDK. Extracted from [PMX](https://github.com/pskoett/pmx).

The canvas is the agent's extended working memory: humans pin nodes to curate context, agents read that curation via MCP resources.

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
- **Learn and Improve**: Every mistake is a learning opportunity. Log it, learn from it, prevent it.

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: log the lesson
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Log to `.learnings/ERRORS.md`, `LEARNINGS.md`, or `FEATURE_REQUESTS.md`
- Promote broadly applicable learnings to `CLAUDE.md` and `AGENTS.md`

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run the server, check endpoints, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user

## Canvas Architecture Rules

1. **State lives in the server.** `CanvasStateManager` in `canvas-state.ts` is the singleton source of truth. All mutations go through it. The browser is a renderer. State survives browser refresh.

2. **SSE-created nodes must sync to server-side canvasState.** When `emitPrimaryWorkbenchEvent` creates nodes on the client via SSE (`workbench-open`, `ext-app-open`), also create them in the server-side `canvasState` singleton. Otherwise `canvas_get_layout` returns 0 nodes and `canvas-layout-update` reconciliation deletes client-only nodes.

3. **Rebuild canvas bundle after client source changes.** After modifying any file under `src/client/`, run `bun run build` before testing in the browser. The dist bundle is not auto-built; stale bundles silently hide new features.

4. **Canvas edits happen in place.** The web canvas is a live multi-node workspace. Flows should update the current session without evicting prior nodes. Agents must not describe the canvas as requiring reopen/replace for additional documents.

5. **MCP tools map 1:1 to PmxCanvas methods.** When adding a new canvas operation, add it to: (a) `CanvasStateManager`, (b) `PmxCanvas` class in `src/server/index.ts`, (c) HTTP endpoint in `src/server/server.ts`, (d) MCP tool in `src/mcp/server.ts`. All four layers must stay in sync.

6. **Context pins are the bridge between human and agent.** The human pins nodes in the browser, the agent reads `canvas://pinned-context`. This is the primary communication channel from human spatial curation to agent context. Preserve this flow.

7. **No HTTP server port assumptions.** Default port is 4313 but can be changed via `--port` or `PMX_CANVAS_PORT` env var. The server tries fallback ports if the preferred one is taken.

## Tech Stack

- **Runtime:** Bun (build + serve)
- **UI:** Preact + @preact/signals
- **Styling:** CSS custom properties (dark theme, no Tailwind build step)
- **Server:** Bun.serve (HTTP + SSE)
- **MCP:** @modelcontextprotocol/sdk (stdio transport)
- **Bundler:** Bun bundler for client SPA
- **Dependencies:** `preact`, `@preact/signals`, `marked`, `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `zod`

## Project Structure

```
src/
  server/           # HTTP/SSE server, state management, canvas tools
    index.ts        # PmxCanvas class, createCanvas() export
    server.ts       # Bun.serve HTTP + SSE server, all REST endpoints
    canvas-state.ts # CanvasStateManager singleton (authoritative state)
    placement.ts    # Collision-aware auto-positioning
    trace-manager.ts
    chart-template.ts
    context-cards.ts
    mcp-app-host.ts
    ext-app-*.ts    # External app hosting
  client/           # Preact SPA (served at /workbench)
    App.tsx          # Root component (toolbar, HUD, keyboard shortcuts)
    index.tsx        # Entry point
    types.ts         # Shared TypeScript types
    canvas/          # Canvas interaction components (viewport, nodes, edges, minimap)
    nodes/           # Node type renderers (7 types)
    state/           # State management (canvas-store, sse-bridge, intent-bridge)
    theme/           # global.css, tokens.ts
    utils/           # Shared pure functions (placement, ext-app-tool-result)
  cli/
    index.ts         # CLI entry point (--port, --demo, --no-open, --theme, --mcp)
  mcp/
    server.ts        # MCP server (10 tools + 3 resources)
skills/
  pmx-canvas/
    SKILL.md         # Agent skill file
dist/
  canvas/            # Built client SPA (index.js + global.css)
```

## Build & Run

```bash
bun install                    # Install dependencies
bun run build                  # Build client SPA → dist/canvas/
bun run dev                    # Start server + open browser
bun run dev:demo               # Start with sample nodes
bun run start                  # Start headless (no browser)
pmx-canvas --mcp               # Run as MCP server
pmx-canvas --theme=light       # Start with light theme
```

## Persistence

Canvas state auto-saves to `.pmx-canvas.json` in the workspace root on every mutation (debounced 500ms). Auto-loads on server start. The file is git-committable — spatial knowledge persists across sessions.

- Override path: `PMX_CANVAS_STATE_FILE` env var
- `--demo` only seeds when canvas is empty (won't clobber restored state)
- Saves: viewport, nodes, edges, context pins

## Themes

Three themes: `dark` (default), `light`, `high-contrast`. Set via:
- CLI: `--theme=light`
- Env: `PMX_CANVAS_THEME=light`
- Browser: toolbar toggle button (sun/moon icon)

## Testing Conventions

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

**Node types:** `markdown`, `status`, `context`, `ledger`, `trace`, `file`, `mcp-app`

**Edge types:** `flow`, `depends-on`, `relation`, `references` — all support labels, styles (solid/dashed/dotted), and animation.

## MCP Server

17 tools: `canvas_add_node`, `canvas_update_node`, `canvas_remove_node`, `canvas_get_layout`, `canvas_get_node`, `canvas_add_edge`, `canvas_remove_edge`, `canvas_arrange`, `canvas_focus_node`, `canvas_pin_nodes`, `canvas_clear`, `canvas_snapshot`, `canvas_restore`, `canvas_search`, `canvas_undo`, `canvas_redo`, `canvas_diff`

5 resources: `canvas://pinned-context`, `canvas://layout`, `canvas://summary`, `canvas://spatial-context`, `canvas://history`

Resource change notifications: the MCP server emits `notifications/resources/updated` when canvas state changes. Pin changes notify `canvas://pinned-context`; all mutations notify `canvas://layout`, `canvas://summary`, `canvas://spatial-context`, and `canvas://history`. This enables real-time human→agent collaboration — humans pin nodes in the browser, agents are notified immediately.

### Spatial Semantics Layer

The canvas exposes spatial intelligence to agents via `canvas://spatial-context`:
- **Proximity clusters**: Automatically detects nodes grouped together on the canvas
- **Reading order**: Nodes sorted top-left to bottom-right (how humans read)
- **Pinned neighborhoods**: For each pinned node, lists nearby unpinned nodes (the human's implicit context)
- **`canvas://pinned-context`** now includes neighborhood data — nearby unpinned nodes for each pin

Use `canvas_search` to find nodes by title/content keywords instead of parsing the full layout.

### Time Travel (Undo/Redo + History)

Every canvas mutation is recorded in an in-memory ring buffer (last 200 operations). Each entry captures forward/inverse closures for clean undo/redo.

- **`canvas_undo`** / **`canvas_redo`** — step through history, reversing operations cleanly
- **`canvas://history`** — human-readable mutation timeline with cursor position
- **`canvas_diff`** — compare current canvas vs any saved snapshot (shows added/removed/modified nodes and edges)
- HTTP: `POST /api/canvas/undo`, `POST /api/canvas/redo`, `GET /api/canvas/history`

Design notes:
- History is session-scoped (in-memory, not persisted to disk)
- `arrange()` records as a single compound mutation (not N individual moves)
- Undo/redo emit SSE events so the browser updates immediately
- The `_suppressRecording` flag prevents undo/redo from creating new history entries

## Integration Paths

1. **MCP Server** (recommended) — `pmx-canvas --mcp`, auto-starts on first tool call
2. **HTTP API** — REST + SSE at `localhost:4313`
3. **Node.js SDK** — `import { createCanvas } from 'pmx-canvas'`
4. **Agent Skill** — `skills/pmx-canvas/SKILL.md`

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

## Task Management

1. **Plan First**: Write plan with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Capture Lessons**: Update `.learnings` files after corrections
6. **Review Before Done**: Final review to ensure everything is clear and robust

## Error Hygiene

When maintaining `.learnings/`:
1. Keep only high-signal entries: unresolved blockers, recurring failures, or incidents that require durable guardrails
2. Remove one-off resolved noise after extracting reusable guidance
3. Keep active learnings concise and scannable

## Browser Automation Visibility Rule

When using browser automation for UI investigation:
1. Use a visible browser window (headed mode) so the user can see what is happening
2. Do not run headless unless the user explicitly asks for it
