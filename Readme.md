# pmx-canvas

A standalone spatial canvas workbench that any coding agent can use as a visual workspace. Extracted from [PMX](https://github.com/pskoett/pmx).

PMX Canvas gives agents a 2D infinite canvas with nodes, edges, pan/zoom, minimap, and real-time updates — controlled through MCP, HTTP API, or Node.js SDK. The canvas is also the agent's **extended working memory**: humans pin nodes to curate context, and agents read that curation as structured input.

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

### Nodes (8 types)
- **markdown** — rich markdown content with rendered preview
- **status** — compact status indicator (phase, message, elapsed time)
- **context** — context cards, token usage, workspace grounding
- **ledger** — execution ledger summary
- **trace** — agent trace pills showing tool calls and subagent activity
- **prompt** — user questions with threaded conversation support
- **response** — agent responses (standalone or threaded into prompt)
- **mcp-app** — hosted MCP app iframes and ext-app frames (Chart.js, Excalidraw, etc.)

### Edges (4 types)
- **flow** — sequential steps, data flow (with optional animation)
- **depends-on** — dependencies between tasks
- **relation** — general relationships
- **references** — cross-references, evidence links
- All edges support labels, styles (solid/dashed/dotted), and animation

### Canvas as Context (MCP resources)
- **`canvas://pinned-context`** — content of all pinned nodes + their connections. The human pins nodes to tell the agent "this matters right now."
- **`canvas://layout`** — full canvas state (all nodes, edges, viewport)
- **`canvas://summary`** — compact overview: node counts by type, edge count, pinned titles

### Integration (4 paths)
- **MCP Server** — 10 tools + 3 resources, auto-starts canvas on first tool call. Zero-config for any MCP-capable agent.
- **HTTP API** — REST endpoints for all canvas operations + SSE event stream. Works from any language.
- **Node.js SDK** — `createCanvas()` for programmatic control from Bun/Node.js.
- **Agent Skill** — SKILL.md teaches agents the HTTP API. Works in Claude Code, Cowork, and any skill-aware agent.

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
```

The canvas opens at `http://localhost:4313`.

## Usage

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
| `canvas_add_node` | Add a node (markdown, status, context, etc.) |
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

**MCP Resources:**

| Resource | Description |
|----------|------------|
| `canvas://pinned-context` | Content of pinned nodes — the human's curated context for the agent |
| `canvas://layout` | Full canvas state (all nodes, edges, viewport) |
| `canvas://summary` | Compact overview: counts, pinned titles, viewport |

### CLI

```bash
pmx-canvas                      # Start canvas, open browser
pmx-canvas --demo               # Start with sample nodes
pmx-canvas --port=8080          # Custom port
pmx-canvas --no-open            # Start server only (for agents)
pmx-canvas --mcp                # Run as MCP server (stdio)
```

### HTTP API

```bash
# Get canvas state
curl http://localhost:4313/api/canvas/state

# Add a markdown node
curl -X POST http://localhost:4313/api/canvas/node \
  -H "Content-Type: application/json" \
  -d '{"type":"markdown","title":"Plan","content":"# Step 1\nDo the thing."}'

# Add an edge
curl -X POST http://localhost:4313/api/canvas/edge \
  -H "Content-Type: application/json" \
  -d '{"from":"node-1","to":"node-2","type":"flow","label":"next"}'

# Batch update node positions
curl -X POST http://localhost:4313/api/canvas/update \
  -H "Content-Type: application/json" \
  -d '{"nodes":[{"id":"node-1","position":{"x":100,"y":200}}]}'

# Auto-arrange
curl -X POST http://localhost:4313/api/canvas/arrange \
  -H "Content-Type: application/json" \
  -d '{"layout":"grid"}'

# SSE event stream (real-time updates)
curl -N http://localhost:4313/api/workbench/events

# Update context pins
curl -X POST http://localhost:4313/api/canvas/context-pins \
  -H "Content-Type: application/json" \
  -d '{"nodeIds":["node-1","node-2"]}'

# Get pinned context
curl http://localhost:4313/api/canvas/pinned-context
```

### Node.js SDK

```typescript
import { createCanvas } from 'pmx-canvas';

const canvas = createCanvas({ port: 4313 });
await canvas.start({ open: true });

const n1 = canvas.addNode({ type: 'markdown', title: 'Hello', content: '# World' });
const n2 = canvas.addNode({ type: 'status', title: 'Build', content: 'passing' });
canvas.addEdge({ from: n1, to: n2, type: 'flow' });
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
2. Human reviews, rearranges, and **pins** the important ones
3. Agent reads `canvas://pinned-context` to get the human's curated focus
4. Agent uses that context to inform its next actions
5. Repeat — the canvas becomes a shared thinking surface

### As a Claude Code skill

Copy `skills/pmx-canvas/` into your project's `.claude/skills/` directory.

## Recommended MCP integrations

PMX Canvas is most powerful when paired with MCP servers that feed it real data. These are the integrations used by the PMX project:

### Core (start here)

| MCP Server | What it gives the canvas |
|-----------|--------------------------|
| **Atlassian** (Jira/Confluence) | Issue boards, sprint status, architecture docs as canvas nodes |
| **GitHub** | PR review boards, issue investigation layouts, repo structure maps |
| **Slack** | Discussion threads as context nodes, channel activity summaries |
| **Notion** | Knowledge base pages as reference nodes |

### Analytics & metrics

| MCP Server | What it gives the canvas |
|-----------|--------------------------|
| **DX Data Cloud** | Engineering metrics dashboards, team health scorecards |
| **Google Analytics 4** | Traffic and behavior data for product canvases |
| **Mixpanel** | Funnel analysis, user journey maps |

### Design & diagrams

| MCP Server | What it gives the canvas |
|-----------|--------------------------|
| **Figma** | Design file references, component inventories |
| **Excalidraw** | Diagram generation and embedding |

### Data & infrastructure

| MCP Server | What it gives the canvas |
|-----------|--------------------------|
| **PostgreSQL** | Query results as data nodes, schema diagrams |
| **Google Drive** | Document references and links |
| **Microsoft 365** (WorkIQ) | Email threads, calendar context, Teams discussions |

### Specialized

| MCP Server | What it gives the canvas |
|-----------|--------------------------|
| **Linear** | Issue tracking boards, project timelines |
| **Intercom** | Customer conversation context for debugging |
| **Obsidian** | Local knowledge vault integration |

## Architecture

```
Agent (Claude Code / Codex / Cursor / pi / any)
  |
  |-- MCP Server ---- 10 tools + 3 resources (canvas://pinned-context, etc.)
  |-- Node.js SDK --- createCanvas()
  |-- HTTP API ------ curl localhost:4313/api/...
  |-- Skill file ---- SKILL.md
  |
  v
Bun.serve HTTP + SSE Server (localhost:4313)
  |  CanvasStateManager (authoritative state)
  |  Context pins (human curates → agent reads)
  |  SSE push → browser
  |  REST ← browser + agents
  |
  v
Browser (Preact SPA)
  |  @preact/signals reactive state
  |  SSE bridge (real-time updates)
  |  Pan/zoom canvas with nodes + edges + minimap
```

## Tech stack

- **Runtime:** Bun
- **UI:** Preact + @preact/signals
- **Styling:** CSS custom properties (dark theme)
- **Server:** Bun.serve (HTTP + SSE)
- **MCP:** @modelcontextprotocol/sdk (stdio transport)
- **Communication:** SSE (server→client) + REST (client→server, agent→server)

## License

MIT
