# pmx-canvas

A standalone spatial canvas workbench that any coding agent can use as a visual workspace. Extracted from [PMX](https://github.com/pskoett/pmx).

PMX Canvas gives agents a 2D infinite canvas with nodes, edges, pan/zoom, minimap, and real-time updates — controlled through MCP, HTTP API, or Node.js SDK. The canvas is the agent's **extended working memory**: humans pin nodes to curate context, and agents are notified instantly via MCP resource change notifications.

## Why

Coding agents work in text. But some problems — debugging, architecture, planning, status tracking — are better understood spatially. PMX Canvas gives any agent a visual workbench where it can lay out information as connected nodes on an infinite canvas, and both the agent and the human can see and interact with it in real time.

The key insight: **spatial arrangement is communication**. When a human pins nodes and draws edges on the canvas, they're telling the agent what matters. When the agent reads `canvas://pinned-context`, it gets exactly the context the human curated — no prompt engineering required.

## Features

### Canvas
- **Infinite 2D canvas** — pan, zoom, scroll in any direction
- **Minimap** — always-visible overview with click-to-navigate
- **Auto-arrange** — grid, column, and flow layouts
- **Multi-select** — select multiple nodes with selection bar
- **Keyboard shortcuts** — Cmd+0 reset, Cmd+/- zoom, Tab cycle nodes, Esc deselect
- **Context menu** — right-click nodes for actions
- **Docked panels** — pin nodes to left/right HUD for persistent visibility
- **Expanded view** — click to expand any node to full-screen overlay
- **Themes** — dark (default), light, and high-contrast
- **Persistence** — canvas state auto-saves to `.pmx-canvas.json` and restores on restart

### Nodes (8 types)
- **markdown** — rich markdown content with rendered preview
- **status** — compact status indicator (phase, message, elapsed time)
- **context** — context cards, token usage, workspace grounding
- **ledger** — execution ledger summary
- **trace** — agent trace pills showing tool calls and subagent activity
- **file** — live file viewer with auto-update when the file changes on disk
- **image** — image viewer with zoom/pan, supports file paths, data URIs, and URLs
- **mcp-app** — hosted MCP app iframes and ext-app frames (Chart.js, Excalidraw, etc.)
- **group** — spatial container/frame that visually contains other nodes (see Groups below)

### File Nodes
File nodes display project files with line numbers and language detection. When an agent edits a file through its normal tools, the canvas node updates automatically via `fs.watch()`. This gives humans a spatial, real-time view of what the agent is working on.

```typescript
// Add a file node via MCP
canvas_add_node({ type: 'file', content: 'src/server/index.ts' })
```

### Groups (Frames)

Groups are spatial containers that visually contain other nodes, enabling hierarchical organization on the canvas. They render as dashed-border frames behind their children, with a title bar and optional accent color.

- **Select 2+ nodes → click "Group"** in the selection bar to create a group around them
- **Right-click a group → "Ungroup"** to release children
- **Collapsing** a group hides its children and shows a summary (e.g., "5 nodes — 3 markdown, 2 file")
- **Custom colors** — each group can have an accent color for visual distinction
- Groups auto-size to fit their children when created via the API
- Removing a child node automatically prunes it from the parent group
- Removing a group clears `parentGroup` on all its children

```typescript
// Create a group containing existing nodes via MCP
canvas_create_group({ title: 'Authentication', childIds: ['node-1', 'node-2'], color: '#4a9eff' })

// Add more nodes to an existing group
canvas_group_nodes({ groupId: 'group-abc', childIds: ['node-3'] })

// Release all children
canvas_ungroup({ groupId: 'group-abc' })
```

```bash
# Create a group via HTTP
curl -X POST http://localhost:4313/api/canvas/group \
  -H "Content-Type: application/json" \
  -d '{"title":"Auth Module","childIds":["node-1","node-2"],"color":"#4a9eff"}'

# Add nodes to a group
curl -X POST http://localhost:4313/api/canvas/group/add \
  -H "Content-Type: application/json" \
  -d '{"groupId":"group-abc","childIds":["node-3"]}'

# Ungroup
curl -X POST http://localhost:4313/api/canvas/group/ungroup \
  -H "Content-Type: application/json" \
  -d '{"groupId":"group-abc"}'
```

### Edges (4 types)
- **flow** — sequential steps, data flow (with optional animation)
- **depends-on** — dependencies between tasks
- **relation** — general relationships
- **references** — cross-references, evidence links
- All edges support labels, styles (solid/dashed/dotted), and animation

### Persistence
Canvas state auto-saves to `.pmx-canvas.json` in the workspace root on every mutation (debounced). The file is git-committable — spatial knowledge persists across sessions and can be shared with a team.

- Saves: viewport, nodes, edges, context pins
- Auto-loads on server start (both HTTP and MCP modes)
- `--demo` only seeds when canvas is empty (won't clobber restored state)
- Override path: `PMX_CANVAS_STATE_FILE` env var

### Snapshots
Named checkpoints of the entire canvas state. Save before a refactor, restore if the approach fails, switch between workstreams.

- Stored in `.pmx-canvas-snapshots/` — no git dependency, works in any project
- Save/restore via MCP tools (`canvas_snapshot`, `canvas_restore`), HTTP API, or the toolbar UI
- Each snapshot captures: viewport, all nodes, all edges, context pins
- Toolbar button (◈) opens a dropdown panel to save, browse, restore, and delete snapshots

```typescript
// Save a snapshot via MCP
canvas_snapshot({ name: 'before refactor' })

// Restore later
canvas_restore({ id: 'snap-abc123' })
```

### Canvas as Context (MCP resources)
- **`canvas://pinned-context`** — content of all pinned nodes + their connections. The human pins nodes to tell the agent "this matters right now."
- **`canvas://layout`** — full canvas state (all nodes, edges, viewport)
- **`canvas://summary`** — compact overview: node counts by type, edge count, pinned titles

### Resource Change Notifications
The MCP server emits `notifications/resources/updated` when canvas state changes:
- **Pin changes** → `canvas://pinned-context`, `canvas://layout`, `canvas://summary`
- **Node/edge mutations** → `canvas://layout`, `canvas://summary`

This closes the human-to-agent loop: humans pin nodes in the browser, agents are notified immediately and can re-read the updated context.

### Spatial Semantics

The canvas understands spatial arrangement and exposes it to agents. When a human drags three file nodes next to a bug report, the agent knows they're grouped — not just pinned.

- **`canvas://spatial-context`** — proximity clusters, reading order, and pinned neighborhoods
- **`canvas://pinned-context`** — now includes nearby unpinned nodes for each pin (the human's implicit context)
- **`canvas_search`** — find nodes by title/content keywords instead of parsing the full layout

```bash
# Get spatial analysis via HTTP
curl http://localhost:4313/api/canvas/spatial-context

# Search nodes
curl "http://localhost:4313/api/canvas/search?q=auth"
```

### Time Travel

Every canvas mutation is recorded with undo/redo support. Explore approaches, backtrack when wrong, and understand how the canvas evolved.

- **`canvas_undo`** / **`canvas_redo`** — step through mutation history
- **`canvas://history`** — readable timeline of all mutations this session
- **`canvas_diff`** — compare current state vs any saved snapshot

```bash
# Undo the last change
curl -X POST http://localhost:4313/api/canvas/undo

# View mutation history
curl http://localhost:4313/api/canvas/history
```

### Code Graph

File nodes automatically detect import dependencies between each other. Add file nodes and watch `depends-on` edges appear as the system parses `import`/`require`/`from` statements across JS/TS, Python, Go, and Rust.

- **`canvas://code-graph`** — dependency structure with central files, isolated files, and import chains
- Auto-edges update live when files change on disk

```bash
# View auto-detected dependencies
curl http://localhost:4313/api/canvas/code-graph
```

### Integration (4 paths)
- **MCP Server** — 23 tools + 6 resources, auto-starts canvas on first tool call. Zero-config for any MCP-capable agent.
- **HTTP API** — REST endpoints for all canvas operations + SSE event stream. Works from any language.
- **Node.js SDK** — `createCanvas()` for programmatic control from Bun/Node.js.
- **Agent Skills** — `skills/pmx-canvas/` teaches the canvas API, `skills/web-artifacts-builder/` covers richer bundled HTML artifact builds, `skills/playwright-cli/` covers browser validation, `skills/pmx-canvas-testing/` defines the repo verification ladder, and repo-local agnostic PMX skills now include `doc-coauthoring`, `data-analysis`, `frontend-design`, `web-design-guidelines`, and `json-render-*`.

### Real-time sync
- **SSE push** — server broadcasts all changes to connected browsers instantly
- **Bidirectional** — browser interactions (drag, resize, pin) sync back to server
- **Auto-reconnect** — SSE reconnects with exponential backoff on disconnect
- **Session management** — session IDs for continuity across reconnects

## Quick start

```bash
# Install
bun install

# Build the client SPA
bun run build

# Start with demo content
bun run dev:demo

# Start headless (for agents)
bun run start

# Start with light theme
pmx-canvas --theme=light
```

The canvas opens at `http://localhost:4313`.

## Usage

## Verification

Common local verification commands:

```bash
bun run test
bun run test:coverage
bun run test:web-canvas
bun run test:all
bun run build
```

### MCP Server (recommended)

Add to your agent's MCP config — the canvas auto-starts on first tool call:

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

**MCP Tools:**

| Tool | Description |
|------|------------|
| `canvas_add_node` | Add a node (markdown, status, context, file, etc.) |
| `canvas_update_node` | Update content, position, size, collapsed state |
| `canvas_remove_node` | Remove a node and its edges |
| `canvas_get_layout` | Get full canvas state |
| `canvas_get_node` | Get a single node by ID |
| `canvas_add_edge` | Connect two nodes |
| `canvas_remove_edge` | Remove a connection |
| `canvas_arrange` | Auto-arrange (grid/column/flow) |
| `canvas_focus_node` | Pan viewport to a node |
| `canvas_pin_nodes` | Pin nodes to include in agent context |
| `canvas_clear` | Clear all nodes and edges |
| `canvas_snapshot` | Save current canvas as a named snapshot |
| `canvas_restore` | Restore canvas from a saved snapshot |
| `canvas_search` | Find nodes by title/content keywords (ranked by relevance) |
| `canvas_undo` | Undo the last canvas mutation |
| `canvas_redo` | Redo the last undone mutation |
| `canvas_diff` | Compare current canvas vs a saved snapshot |
| `canvas_create_group` | Create a group (frame) containing specified nodes |
| `canvas_group_nodes` | Add nodes to an existing group |
| `canvas_ungroup` | Release all children from a group |
| `canvas_build_web_artifact` | Build a bundled HTML artifact and open it on the canvas |
| `canvas_add_json_render_node` | Create a native json-render canvas node from a validated spec |
| `canvas_add_graph_node` | Create a native graph node for line, bar, and pie charts |

**MCP Resources:**

| Resource | Description |
|----------|------------|
| `canvas://pinned-context` | Content of pinned nodes + nearby unpinned neighbors |
| `canvas://layout` | Full canvas state (all nodes, edges, viewport) |
| `canvas://summary` | Compact overview: counts, pinned titles, viewport |
| `canvas://spatial-context` | Spatial intelligence: proximity clusters, reading order, pinned neighborhoods |
| `canvas://history` | Mutation history timeline with undo/redo position |
| `canvas://code-graph` | Auto-detected file dependency graph (imports between file nodes) |

### CLI

```bash
pmx-canvas                      # Start canvas, open browser
pmx-canvas --demo               # Start with sample nodes
pmx-canvas --port=8080          # Custom port
pmx-canvas --no-open            # Start server only (for agents)
pmx-canvas --theme=light        # Light theme (dark, light, high-contrast)
pmx-canvas --mcp                # Run as MCP server (stdio)
```

### HTTP API

```bash
# Get canvas state
curl http://localhost:4313/api/canvas/state

# Batch update node positions
curl -X POST http://localhost:4313/api/canvas/update \
  -H "Content-Type: application/json" \
  -d '{"nodes":[{"id":"node-1","position":{"x":100,"y":200}}]}'

# Add an edge
curl -X POST http://localhost:4313/api/canvas/edge \
  -H "Content-Type: application/json" \
  -d '{"from":"node-1","to":"node-2","type":"flow","label":"next"}'

# Update context pins
curl -X POST http://localhost:4313/api/canvas/context-pins \
  -H "Content-Type: application/json" \
  -d '{"nodeIds":["node-1","node-2"]}'

# Get pinned context
curl http://localhost:4313/api/canvas/pinned-context

# SSE event stream (real-time updates)
curl -N http://localhost:4313/api/workbench/events
```

### Node.js SDK

```typescript
import { createCanvas } from 'pmx-canvas';

const canvas = createCanvas({ port: 4313 });
await canvas.start({ open: true });

// Add nodes
const n1 = canvas.addNode({ type: 'markdown', title: 'Plan', content: '# Step 1\nDo the thing.' });
const n2 = canvas.addNode({ type: 'status', title: 'Build', content: 'passing' });
const n3 = canvas.addNode({ type: 'file', content: 'src/index.ts' }); // Live file viewer

// Connect them
canvas.addEdge({ from: n1, to: n2, type: 'flow' });

// Group related nodes
canvas.createGroup({ title: 'Build Pipeline', childIds: [n1, n2] });

canvas.arrange('grid');
console.log(canvas.getLayout()); // { viewport, nodes, edges }
```

## Agent integration

| Agent | Integration | Config |
|-------|-----------|--------|
| **Claude Code** | MCP server (best) or Skill | `"command": "bunx", "args": ["pmx-canvas", "--mcp"]` |
| **Claude Cowork** | MCP server or Skill | Same as Claude Code |
| **OpenAI Codex** | MCP server or HTTP API | Same MCP config, or `curl` commands |
| **Cursor** | MCP server | Same MCP config |
| **Windsurf** | MCP server | Same MCP config |
| **pi agent** | MCP server, Skill, or HTTP | Same MCP config, or add as pi skill |
| **Any other** | HTTP API | Any language can `fetch()` or `curl` |

### Canvas as Context workflow

1. Agent creates investigation/plan nodes on the canvas
2. Agent adds file nodes for the files it's working on — they update live as the agent edits
3. Human reviews, rearranges, and **pins** the important nodes
4. MCP server notifies the agent that pinned context changed
5. Agent reads `canvas://pinned-context` to get the human's curated focus
6. Agent uses that context to inform its next actions
7. Repeat — the canvas becomes a shared thinking surface

### As a Claude Code skill

Copy `skills/pmx-canvas/` into your project's `.claude/skills/` directory.
For richer browser-app outputs, also copy `skills/web-artifacts-builder/`.
For browser-side validation of canvas integrations and embedded artifacts, also copy `skills/playwright-cli/`.
For repo-standard verification guidance, also copy `skills/pmx-canvas-testing/`.
For native structured UI and general-purpose PMX workflows, also copy the repo-local `json-render-*`, `doc-coauthoring`, `data-analysis`, `frontend-design`, and `web-design-guidelines` skills you need.

## Architecture

```
Agent (Claude Code / Codex / Cursor / pi / any)
  |
  |-- MCP Server ---- 23 tools + 6 resources + change notifications
  |-- Node.js SDK --- createCanvas()
  |-- HTTP API ------ curl localhost:4313/api/...
  |-- Skill files --- pmx-canvas + web-artifacts-builder + playwright-cli + pmx-canvas-testing + agnostic PMX skills
  |
  v
Bun.serve HTTP + SSE Server (localhost:4313)
  |  CanvasStateManager (authoritative state)
  |  Context pins (human curates → agent notified)
  |  File watcher (fs.watch → live node updates)
  |  Persistence (.pmx-canvas.json auto-save/load)
  |  Snapshots (.pmx-canvas-snapshots/ named checkpoints)
  |  SSE push → browser
  |  REST ← browser + agents
  |
  v
Browser (Preact SPA)
  |  @preact/signals reactive state
  |  SSE bridge (real-time updates)
  |  Pan/zoom canvas with nodes + edges + minimap
  |  Theme toggle (dark/light/high-contrast)
```

## Tech stack

- **Runtime:** Bun
- **UI:** Preact + @preact/signals
- **Styling:** CSS custom properties (dark/light/high-contrast themes)
- **Server:** Bun.serve (HTTP + SSE)
- **MCP:** @modelcontextprotocol/sdk (stdio transport)
- **Communication:** SSE (server→client) + REST (client→server, agent→server)

## License

MIT
