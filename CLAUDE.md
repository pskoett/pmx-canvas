# PMX Canvas — Project Instructions

## Project Overview

PMX Canvas is a standalone spatial canvas workbench for coding agents. It provides an infinite 2D canvas with nodes, edges, pan/zoom, minimap, and real-time updates — controlled through MCP, HTTP API, or Node.js SDK.

Extracted from [PMX](https://github.com/pskoett/pmx). The canvas is also the agent's extended working memory: humans pin nodes to curate context, and agents read that curation via MCP resources.

## Tech Stack

- **Runtime:** Bun (build + serve)
- **UI:** Preact + @preact/signals
- **Styling:** CSS custom properties (dark theme, no Tailwind build step)
- **Server:** Bun.serve (HTTP + SSE)
- **MCP:** @modelcontextprotocol/sdk (stdio transport)
- **Bundler:** Bun bundler for client SPA

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
    nodes/           # Node type renderers (8 types)
    state/           # State management (canvas-store, sse-bridge, intent-bridge)
    theme/           # global.css, tokens.ts
    utils/           # Shared pure functions (placement, ext-app-tool-result)
  cli/
    index.ts         # CLI entry point (--port, --demo, --no-open, --mcp)
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
```

## Key Architecture Rules

1. **State lives in the server.** `CanvasStateManager` in `canvas-state.ts` is the single source of truth. The browser is a client. State survives browser refresh.

2. **SSE-created nodes must sync to server-side canvasState.** When `emitPrimaryWorkbenchEvent` creates nodes on the client via SSE (`workbench-open`, `ext-app-open`), they are also created in the server-side `canvasState` singleton. Otherwise `canvas_get_layout` returns 0 nodes and `canvas-layout-update` reconciliation deletes client-only nodes.

3. **Rebuild canvas bundle after client source changes.** After modifying any file under `src/client/`, run `bun run build` before testing in the browser. The dist bundle is not auto-built.

4. **Canvas edits happen in place.** The web canvas is a live multi-node workspace. Flows should update the current canvas session without evicting prior nodes.

5. **No HTTP server port assumptions.** Default port is 4313 but can be changed via `--port` or `PMX_CANVAS_PORT` env var. The server tries fallback ports if the preferred one is taken.

## Node Types

`markdown`, `status`, `context`, `ledger`, `trace`, `prompt`, `response`, `mcp-app`

## Edge Types

`flow`, `depends-on`, `relation`, `references` — all support labels, styles (solid/dashed/dotted), and animation.

## MCP Server

10 tools: `canvas_add_node`, `canvas_update_node`, `canvas_remove_node`, `canvas_get_layout`, `canvas_get_node`, `canvas_add_edge`, `canvas_remove_edge`, `canvas_arrange`, `canvas_focus_node`, `canvas_pin_nodes`, `canvas_clear`

3 resources: `canvas://pinned-context`, `canvas://layout`, `canvas://summary`

## Integration Paths

1. **MCP Server** (recommended) — `pmx-canvas --mcp`, auto-starts on first tool call
2. **HTTP API** — REST + SSE at `localhost:4313`
3. **Node.js SDK** — `import { createCanvas } from 'pmx-canvas'`
4. **Agent Skill** — `skills/pmx-canvas/SKILL.md`

## Testing

```bash
# Start server and verify
bun run src/cli/index.ts --no-open --demo &
curl http://localhost:4313/api/canvas/state        # Should return 3 nodes, 2 edges
curl http://localhost:4313/canvas/index.js -o /dev/null -w "%{http_code}"  # Should be 200
curl -N http://localhost:4313/api/workbench/events  # Should stream SSE events
```

## Conventions

- All server-side modules live in `src/server/`
- All client-side Preact components live in `src/client/`
- The MCP server imports from `src/server/index.ts` — it does not duplicate state management
- CSS uses custom properties (`:root { --c-* }`) — no Tailwind classes
- Imports use `.js` extensions for Bun module resolution
- The `canvasState` singleton is shared across HTTP handlers, MCP tools, and the SDK class

## Dependencies

- `preact`, `@preact/signals` — UI framework
- `marked` — Markdown rendering
- `@modelcontextprotocol/sdk` — MCP server
- `@modelcontextprotocol/ext-apps` — External app bridge for MCP app nodes
- `zod` — Schema validation for MCP tool parameters
