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

# PMX Canvas — Agent Skill

PMX Canvas is a spatial canvas workbench you control through MCP tools or HTTP API. It renders an
infinite 2D canvas in the browser with nodes, edges, groups, pan/zoom, and a minimap. State lives
on the server and survives browser refresh.

The canvas is your extended working memory. Humans pin nodes to curate context; you read that
curation through MCP resources. Spatial arrangement is communication — proximity means
relatedness, clusters imply grouping, reading order (top-left to bottom-right) implies sequence.

## When to Use

- **Investigation boards** — lay out files, logs, stack traces, and findings spatially while debugging
- **Architecture diagrams** — show system components and their relationships
- **Plans & task tracking** — create task nodes with dependencies and color-coded status
- **Status dashboards** — display build results, test output, deployment state
- **Context maps** — show how code, configs, and data flow connect
- **Code dependency graphs** — visualize file imports and module relationships
- **Comparison views** — place options side by side for the human to evaluate
- **Any time spatial layout helps** — when a flat list or text wall is not enough

## Starting the Canvas

The canvas auto-starts on first MCP tool call when running in MCP mode (`pmx-canvas --mcp`).
For manual start:

```bash
pmx-canvas                     # Start and open browser (port 4313)
pmx-canvas --no-open           # Start without opening browser (for agents)
pmx-canvas --port=8080         # Custom port
pmx-canvas --demo              # Start with sample content
pmx-canvas --theme=light       # Light theme
```

Start the canvas once per session, then reuse it. Use `--no-open` when running as an agent — the
human can open the browser URL themselves.

## Core Concepts

### Node Types

| Type | Purpose | When to use |
|------|---------|-------------|
| `markdown` | Rich formatted content | Explanations, documentation, notes, findings |
| `status` | Compact color-coded indicator | Progress tracking, build/test results, task state |
| `file` | Live file viewer (auto-watches) | Show source code with live updates on file change |
| `image` | Image display | Screenshots, diagrams, charts |
| `context` | Context card | Key context the human should see |
| `ledger` | Log/ledger viewer | Structured log data, audit trails |
| `trace` | Trace/timeline viewer | Execution traces, timelines |
| `group` | Spatial container/frame | Visually group related nodes together |

### Edge Types

| Type | Purpose | Example label |
|------|---------|---------------|
| `flow` | Sequential/directional | "then", "calls", "triggers" |
| `depends-on` | Dependency | "requires", "blocks" |
| `relation` | General relationship | "related to", "similar to" |
| `references` | Cross-reference | "see also", "documented in" |

Edges support `style` (solid/dashed/dotted) and `animated` flag. Always use descriptive labels.

**Edge direction convention:** `from` is the source/dependent, `to` is the target/dependency.
So `from: A, to: B, type: "depends-on"` means "A depends on B." For `flow` edges, the arrow
points from `from` to `to`, indicating sequence or data flow direction.

**Style conventions:** Use `solid` for active/satisfied relationships, `dashed` for blocked or
pending dependencies, and `dotted` for weak/optional relationships. Use `animated: true` to
draw visual attention to critical paths.

### Colors (Semantic)

Use color consistently to convey meaning:
- **Green** (`#22c55e`) — success, done, healthy
- **Yellow** (`#eab308`) — in progress, warning, attention needed
- **Red** (`#ef4444`) — error, blocked, failing
- **Blue** (`#3b82f6`) — informational, neutral highlight
- **Gray** (`#6b7280`) — queued, pending, inactive, not yet started
- **Purple** (`#a855f7`) — special, notable, review needed

## MCP Tools Reference

### Node Operations

**`canvas_add_node`** — Add a node to the canvas
- `type` (required): node type (see table above)
- `title`: short, scannable title
- `content`: for most types, this is markdown text. For `file` type, pass the **file path**
  (e.g., `"src/auth/login.ts"`) — the server auto-loads the file content and watches for changes.
  For `image` type, pass a file path, URL, or data URI.
- `x`, `y`: position (auto-placed if omitted — prefer omitting for auto-layout)
- `width`, `height`: dimensions (sensible defaults provided)
- `color`: semantic color
- `metadata`: arbitrary JSON
- Returns: `{ id: "<node-id>" }` — capture this ID for edges and groups

**`canvas_update_node`** — Update an existing node
- `id` (required): node to update
- Any of: `title`, `content`, `color`, `x`, `y`, `width`, `height`, `collapsed`, `metadata`
- Use to update status nodes as work progresses

**`canvas_remove_node`** — Remove a node and all its connected edges
- `id` (required): node to remove
- Clean up nodes that are no longer relevant

**`canvas_get_node`** — Get a single node's full data
- `id` (required): node to retrieve

### Edge Operations

**`canvas_add_edge`** — Connect two nodes
- `from`, `to` (required): source and target node IDs
- `type`: edge type (default: `relation`)
- `label`: descriptive relationship label
- `style`: `solid`, `dashed`, or `dotted`
- `animated`: boolean for visual emphasis

**`canvas_remove_edge`** — Remove a connection
- `id` (required): edge to remove

### Layout & Navigation

**`canvas_get_layout`** — Get full canvas state (all nodes, edges, viewport)
- Use to understand current canvas state before making changes

**`canvas_arrange`** — Auto-arrange all nodes
- `layout`: `grid` (default), `column`, or `flow`
- Use `grid` for dashboards and architecture overviews, `column` for vertical lists, `flow`
  for horizontal sequences and dependency chains
- Call after adding multiple nodes
- For tiered/layered layouts (e.g., gateway → services → data stores), use `canvas_update_node`
  with explicit `x`/`y` coordinates after auto-arrange to fine-tune the topology

**`canvas_focus_node`** — Pan viewport to center on a specific node
- `id` (required): node to focus
- Good for drawing the human's attention

### Groups

**`canvas_create_group`** — Create a visual container
- `title`: group label
- `childIds`: array of node IDs to include
- `color`: group border/background color
- Auto-sizes to fit children

**`canvas_group_nodes`** — Add nodes to an existing group
- `groupId`, `childIds` (required)

**`canvas_ungroup`** — Release children from a group
- `groupId` (required): group to dissolve

### Search & Discovery

**`canvas_search`** — Find nodes by title or content keywords
- `query` (required): search text
- Returns matches with relevance ranking and content snippets
- Use instead of parsing full layout when looking for specific nodes

### Context Pinning

**`canvas_pin_nodes`** — Manage pinned context
- `nodeIds` (required): array of node IDs
- `mode`: `set` (replace all pins), `add` (add to pins), `remove` (remove from pins)
- Pinned nodes are the primary human-to-agent communication channel
- When a human pins nodes in the browser, they're telling you "pay attention to these"

### History & Snapshots

**`canvas_undo`** — Undo the last canvas mutation
**`canvas_redo`** — Redo the last undone mutation
**`canvas_snapshot`** — Save a named snapshot to disk
- `name` (required): descriptive snapshot name (e.g., "before-refactor")
**`canvas_restore`** — Restore canvas from a saved snapshot
- `id` or `name`: snapshot to restore
**`canvas_diff`** — Compare current canvas against a saved snapshot
- Shows added, removed, and modified nodes/edges
- Useful for reviewing what changed during a work session

### Canvas Management

**`canvas_clear`** — Remove all nodes and edges
- **Always call `canvas_snapshot` first** to save a backup before clearing
- This is irreversible without a prior snapshot

## MCP Resources

These resources give you read access to canvas intelligence. Read them to understand
what the human has set up and what they're focusing on.

| Resource | What it provides |
|----------|-----------------|
| `canvas://pinned-context` | Content of pinned nodes + nearby unpinned neighbors |
| `canvas://layout` | Full canvas state (viewport, nodes, edges) |
| `canvas://summary` | Compact overview: node counts by type, pinned titles |
| `canvas://spatial-context` | Proximity clusters, reading order, pinned neighborhoods |
| `canvas://history` | Human-readable mutation timeline |
| `canvas://code-graph` | Auto-detected file import dependencies |

### Reading Spatial Intent

The `canvas://spatial-context` resource reveals how the human has organized information:

- **Proximity clusters** — Nodes placed near each other form implicit groups. If the human
  placed three files next to each other, those files are related in their mental model.
- **Reading order** — Nodes sorted top-left to bottom-right, following natural reading flow.
  This implies sequence or priority.
- **Pinned neighborhoods** — For each pinned node, nearby unpinned nodes are listed. These
  are the human's implicit context — things they consider related to what they pinned.

Use this spatial intelligence to understand what the human is thinking without them having to
explain it explicitly.

## HTTP API Reference

All POST/PATCH endpoints accept `Content-Type: application/json`. Default base URL: `http://localhost:4313`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/canvas/state` | Full canvas state |
| POST | `/api/canvas/node` | Add node |
| PATCH | `/api/canvas/node/<id>` | Update node |
| DELETE | `/api/canvas/node/<id>` | Remove node |
| POST | `/api/canvas/edge` | Add edge |
| DELETE | `/api/canvas/edge/<id>` | Remove edge |
| POST | `/api/canvas/group` | Create group |
| POST | `/api/canvas/group/add` | Add nodes to group |
| POST | `/api/canvas/group/ungroup` | Ungroup |
| POST | `/api/canvas/arrange` | Auto-arrange |
| POST | `/api/canvas/update` | Batch update positions |
| POST | `/api/canvas/undo` | Undo |
| POST | `/api/canvas/redo` | Redo |
| GET | `/api/canvas/history` | Mutation history |
| GET | `/api/canvas/code-graph` | File dependency graph |
| GET | `/api/workbench/events` | SSE event stream |

## Workflow Patterns

### Responding to Pinned Context

When the human pins nodes, they're telling you what matters. This is the most important
collaboration pattern:

1. Read `canvas://pinned-context` — get the content of pinned nodes and their neighborhoods
2. Read `canvas://spatial-context` — understand how the whole canvas is organized
3. Optionally read `canvas://summary` — see pinned nodes in the context of the full canvas
4. Interpret what you find:
   - What types are the pinned nodes? (files = code focus, status = progress, markdown = concepts)
   - Are they clustered together (single focus) or spread across the canvas (multi-topic)?
   - What unpinned nodes are nearby? These are the human's implicit context
   - What's the reading order? Top-left to bottom-right suggests sequence or priority
5. Respond by summarizing what you see, what you think the human is focusing on, and ask
   if they'd like you to act on it (add related nodes, investigate further, etc.)

**When to use `pinned-context` vs `spatial-context`:**
- `canvas://pinned-context` — "what did the human explicitly pin, and what's near those pins?"
- `canvas://spatial-context` — "how is the entire canvas organized spatially?"
- Read both when you need the full picture; read just `pinned-context` for quick pin checks.

### Investigation Board

When debugging, lay out evidence spatially to see connections:

1. Create a root node describing the bug/issue
2. Add evidence nodes: logs, stack traces, relevant code files (use `file` nodes for source)
3. Connect evidence to root with `references` edges
4. Add a hypothesis node, connect with `flow` edge
5. As you investigate, add findings and update connections
6. Use `status` nodes to track what you've checked
7. Group evidence nodes together, and investigation tasks together
8. Arrange with `flow` layout, then fine-tune positions if needed

```
Bug Report ──references──> Error Logs
    │                         │
    │                    references
    │                         ▼
    └──flow──> Hypothesis ──flow──> Fix
                                     │
                                   flow
                                     ▼
                               Verification
```

### Architecture Diagram

Show system components and how they interact:

1. Create `markdown` nodes for each service/component (include port, tech stack in content)
2. Use `flow` edges for data flow, `depends-on` for dependencies — always label edges
3. Group related services with `canvas_create_group` (e.g., "Application Services", "Data Layer")
4. Use colors: green for healthy, yellow for degraded, red for down
5. Arrange with `grid` layout initially
6. For tiered architectures, fine-tune with explicit `x`/`y` via `canvas_update_node` to show
   layers (e.g., gateway at top, services in middle, data stores at bottom)
7. Connect pipeline stages with `flow` edges where applicable

### Task Plan with Dependencies

Track work items and their relationships:

1. Create `status` nodes for each task
2. Color-code: green=done, yellow=in-progress, red=blocked, gray=queued, blue=ready/available
3. Connect with `depends-on` edges — use `dashed` style for blocked dependencies, `solid` for
   satisfied ones
4. Update status nodes as work progresses using `canvas_update_node`
5. Arrange with `flow` layout to show the dependency chain left-to-right
6. Group related tasks if the plan has distinct phases

### Code Exploration

Understand a codebase by visualizing file relationships:

1. Add `file` nodes for key source files (content auto-loads and live-updates)
2. The code graph auto-detects imports and creates `depends-on` edges automatically — you
   don't need to manually add import-based edges. You can still add manual edges for
   conceptual relationships beyond imports (e.g., "middleware validates using jwt")
3. Read `canvas://code-graph` for dependency analysis: central files, isolated files
4. Group related files with `canvas_create_group` (e.g., "Auth Module", "API Routes")
5. Pin important files so the human sees them highlighted
6. Arrange with `grid` layout after adding files

### Status Dashboard

Monitor ongoing processes:

1. Create `status` nodes for each metric/process
2. Use semantic colors: green=passing, yellow=running, red=failing, gray=queued
3. Connect sequential pipeline stages with `flow` edges (label: "then", "triggers")
4. Update nodes in-place as state changes using `canvas_update_node` — never delete and recreate,
   as that loses position and edges
5. Arrange with `grid` layout
6. The human sees real-time updates via SSE

### Before/After Comparison

Show two states side by side for the human to compare:

1. Take a snapshot before changes: `canvas_snapshot` with name "before-X"
2. Make changes to the canvas
3. Use `canvas_diff` to show what changed
4. Or: create two groups ("Before" and "After") with corresponding nodes

### Save and Start Fresh

When the human wants to explore a different approach without losing current work:

1. **First**, save the current state: `canvas_snapshot` with a descriptive name
2. **Then** clear: `canvas_clear` (never clear without snapshotting first)
3. Set up the new workspace with initial nodes
4. Tell the human the snapshot name and that `canvas_restore` can bring everything back

## Best Practices

1. **Start once, reuse always.** Don't restart the canvas for each task. Build on the
   existing canvas state.

2. **Titles are scannable.** Keep titles short (3-6 words). Put details in content.

3. **Label every edge.** Unlabeled edges lose meaning. "depends on", "calls", "blocks"
   are all more useful than a bare arrow.

4. **Auto-arrange after batch adds.** When adding multiple nodes, call `canvas_arrange`
   once at the end, not after each node.

5. **Update in place.** Use `canvas_update_node` to change status, content, or color.
   Don't delete and recreate — that loses position and edges.

6. **Clean up.** Remove nodes that are no longer relevant. A cluttered canvas is worse
   than no canvas.

7. **Read before writing.** Check `canvas://layout` or `canvas_get_layout` before adding
   nodes to avoid duplicates and understand the current state.

8. **Use pinning.** When you want the human to focus on specific nodes, pin them.
   When the human pins nodes, read `canvas://pinned-context` to see what they care about.

9. **Snapshot before destructive changes.** Before clearing or major reorganization,
   save a snapshot so you can restore if needed.

10. **Prefer MCP tools over HTTP.** When running as an MCP server, use the canvas tools
    directly rather than shelling out to curl. The tools handle all the details.

11. **Use groups for visual organization.** When 3+ nodes are related, wrap them in a
    group to make the relationship visible at a glance.

12. **Use file nodes for source code.** File nodes auto-watch for changes and update
    live. This is better than pasting code into markdown nodes.

## Persistence

Canvas state auto-saves to `.pmx-canvas.json` on every mutation (debounced 500ms). State
loads automatically on server start. The file is git-committable — spatial knowledge
persists across sessions.

Snapshots save to `.pmx-canvas-snapshots/` directory.

## Real-Time Collaboration

The canvas supports real-time human-agent collaboration:

- **Human pins nodes in browser** → agent reads `canvas://pinned-context`
- **Agent adds/updates nodes** → human sees changes instantly via SSE
- **Human moves/groups nodes** → spatial arrangement communicates intent
- **Agent reads spatial context** → understands implicit relationships

This bidirectional flow means the canvas is a shared workspace, not just an output display.
Pay attention to what the human is doing on the canvas — their spatial choices are meaningful.
