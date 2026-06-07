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

# PMX Canvas - Agent Skill

PMX Canvas is a spatial canvas workbench you control through MCP tools or HTTP API. It renders an
infinite 2D canvas in the browser with nodes, edges, groups, pan/zoom, and a minimap. State lives
on the server and survives browser refresh.

The canvas is your extended working memory. Humans pin nodes to curate context; you read that
curation through MCP resources. Spatial arrangement is communication — proximity means
relatedness, clusters imply grouping, reading order (top-left to bottom-right) implies sequence.

## When to Use

The canvas is **agnostic about what you do with it**. Reach for it whenever a
flat conversation, a list, or a single document hides the relationships
between pieces of information. The total reach of any session is the union
of pmx-canvas's own node types and whatever your harness already has access
to — MCP servers, MCP apps, shell commands and CLIs, files in the working
directory, web fetch, anything else in your toolbelt. The canvas does not
care where the data came from; it cares about getting it on the surface as
the right node type.

The README has a non-exhaustive list of example use cases (idea generation,
validation, research, analysis, mind mapping, investigation boards,
architecture diagrams, status dashboards, comparison views, plus whatever
your toolbelt unlocks). This skill stays focused on the operational
mechanics. If a flat list or text wall is not enough to hold the
relationships you're working with, the canvas is the right tool — the rest
of this document is how to drive it.

### When the connected tool is unfamiliar

When the human asks you to use a data source or tool you have not used
before — an MCP server, an MCP app, a CLI, a script, an arbitrary file
tree:

1. List the tools / commands available; sample one or two outputs to see
   the actual shape.
2. Decide which canvas node type best matches each output:
   - Long-form / narrative results → `markdown`
   - Structured records, tables, dashboards → `json-render` or `graph`
   - Rich reusable communication artifacts → `html-primitive`
   - Interactive tool surfaces with their own UI → `mcp-app` (open with
     `canvas_open_mcp_app`)
   - Local source files → `file` (live-watched)
   - URLs that need cached fetches → `webpage`
   - Stream of state events → `status` or `ledger`
3. Propose the mapping to the human before bulk-creating nodes; let them
   confirm or adjust before you commit a layout.

## Starting the Canvas

If this skill is installed before the `pmx-canvas` command exists, install the project first. See
`references/installing-pmx-canvas.md` for local development, npm/global install, and MCP config
options.

## Adapter References

PMX Canvas core is host-agnostic. When a host-specific adapter is available, read the matching
reference before using adapter-native features:

- `references/github-copilot-app-adapter.md` — GitHub Copilot app project extension, native canvas
  panel, AX context injection, and live-test checklist.
- `references/codex-app-adapter.md` — Codex app native Browser + MCP adapter, AX context reading,
  focus labeling, and live-test checklist.

Open the canvas first — always:
The canvas is the shared human↔agent surface. **Before you create or mutate any nodes, make the
workbench visible.** Do **not** assume the host opened it for you — some hosts (e.g. the Codex app)
do not open it on their own. Take the action to open it yourself, whatever the host:
- **Native adapter/panel available** (the GitHub Copilot app `pmx-canvas` canvas extension, or the
  Codex in-app Browser): open/focus that panel to the server's `/workbench` route.
- **Any other browser** (Chrome, Safari, Arc, Edge, …) **or a generic/CLI agent** with no native
  panel: open the server's `/workbench` URL in a browser.

Then reuse that **single** surface for the rest of the session — do **not** open a second panel to
the same workbench (it wastes space and confuses which surface is authoritative). If you genuinely
cannot open any browser (headless/CI), say so and proceed, but still print the `/workbench` URL so a
human can open it.
- External URLs in `mcp-app` nodes show the "Unverified domain" interstitial by design. Only
  same-origin `/api/canvas/frame-documents/<id>` URLs are auto-trusted. For external tools, use a
  bundled `web-artifact`, same-origin frame document, or set `data.trustedDomain: true` only when the
  user accepts the risk.

The canvas auto-starts on first MCP tool call when running in MCP mode (`pmx-canvas --mcp`).
For manual start:

```bash
pmx-canvas                     # Start and open browser (port 4313)
pmx-canvas --no-open           # Start without opening browser (for agents)
pmx-canvas --port=8080         # Custom port
pmx-canvas --demo              # Start with sample content
pmx-canvas --theme=light       # Light theme
pmx-canvas --version           # Print installed version and exit
```

`--theme` accepts `dark` (default), `light`, or `high-contrast`. Same value can be set via
the `PMX_CANVAS_THEME` environment variable, or toggled live in the browser toolbar.

Start the canvas once per session, then reuse it. Use `--no-open` when running as an agent — the
human can open the browser URL themselves.

### Daemon mode (long-running background server)

When you need the canvas to outlive the current shell or agent session — e.g. so a follow-up
agent run can attach to the same state — start it as a daemon:

```bash
pmx-canvas serve --daemon --no-open --wait-ms=20000   # Detach, wait for /health
pmx-canvas serve status                                # Print daemon health + pid state
pmx-canvas serve stop                                  # Stop the daemon for this port
```

`serve --daemon` writes a pid file (`.pmx-canvas/daemon-<port>.pid`) and a log file
(`.pmx-canvas/daemon-<port>.log`); the wait flag blocks until `/health` returns OK so a script
can rely on the server being responsive when the command returns. `serve stop` reads the pid
file, sends SIGTERM, and cleans up on exit.

## Browser Workflows

The browser is not just a passive view. Human interactions on the canvas persist back to the
server and become part of the authoritative canvas state.

- Double-click empty canvas — create a markdown note at that position
- Shift+drag on empty canvas — lasso-select multiple nodes
- Selection bar actions — when nodes are selected, the browser exposes `Pin as context`,
  `Group`, `Connect`, and `Clear`
- Right-click a node — open the node context menu for focus, collapse, pinning, connecting,
  refresh/open actions, and other type-specific operations
- Right-click a group node — recolor the group using preset swatches or a custom color picker,
  and ungroup its children
- Drag-and-drop files or URLs — add file, image, markdown, or webpage nodes directly
- Paste URLs — create webpage nodes from the clipboard

Use browser interactions when the human is actively curating spatial layout. Use MCP or the CLI
when you need deterministic scripted changes or you are acting without a visible browser.

## Agent CLI

PMX Canvas also ships an agent-native CLI that talks to the running HTTP server and returns JSON.
Use it when MCP is not available but you still want structured, scriptable canvas operations.

```bash
pmx-canvas --help                           # Top-level help
pmx-canvas serve --daemon --no-open        # Detached daemon with health output
pmx-canvas serve status                    # Daemon health + pid status
pmx-canvas serve stop                      # Stop the daemon for this port/pid file
pmx-canvas layout                          # Full canvas state
pmx-canvas status                          # Quick summary
pmx-canvas node add --type markdown --title "Plan"
pmx-canvas node add --type webpage --url https://example.com/docs
pmx-canvas node add --type graph --graph-type bar --data '[{"x":"a","y":1}]' --x-key x --y-key y
pmx-canvas node add --type graph --graphType bar --data '[{"x":"a","y":1}]' --xKey x --yKey y
pmx-canvas graph add --graph-type bar --data '[{"x":"a","y":1}]' --x-key x --y-key y
pmx-canvas external-app add --kind excalidraw --title "Diagram"
pmx-canvas node add --help --type webpage --json
pmx-canvas node schema --type json-render --component Table --summary
pmx-canvas node list --type file --ids
pmx-canvas edge add --from node-a --to node-b --type depends-on
pmx-canvas search "auth"
pmx-canvas open
pmx-canvas arrange --layout flow
pmx-canvas focus <node-id> --no-pan             # Select/raise without moving the user's viewport
pmx-canvas fit --width 1440 --height 900        # Fit the whole board for screenshots/review
pmx-canvas screenshot --output ./canvas.png     # Shorthand for `webview screenshot`
pmx-canvas json-render --schema --summary       # Inspect json-render component catalog
pmx-canvas json-render --example --component Table
pmx-canvas node add --type markdown --title "Long doc" --strict-size  # Scroll instead of auto-fit
pmx-canvas node add --type graph --graphType pie --data-file metrics.json --show-legend false --show-labels false
pmx-canvas node update <node-id> --spec-file ./dashboard.json
pmx-canvas validate spec --type json-render --spec-file ./dashboard.json --summary
pmx-canvas web-artifact build --title "Dashboard" --app-file ./App.tsx --deps recharts --include-logs
pmx-canvas node list --type web-artifact --summary
pmx-canvas node list --type external-app --summary
pmx-canvas pin --list
pmx-canvas ax context
pmx-canvas ax focus <node-id>
pmx-canvas ax work add --title "Wire up auth" --status in-progress <node-id>
pmx-canvas ax approval request --title "Deploy to prod"
pmx-canvas ax steer "focus on the failing test first"
pmx-canvas ax timeline --limit 50
pmx-canvas snapshot save --name "before-refactor"
pmx-canvas code-graph
pmx-canvas spatial
```

### CLI command groups

- `node add|list|get|update|remove` — manage nodes
- `node schema` — inspect running-server create schemas and canonical examples, with `--summary`, `--field`, and `--component` filters
- `graph add` — convenience alias for graph nodes; `node add --type graph` remains the canonical form
- Graph CLI fields accept both kebab-case flags and camelCase schema names, e.g. `--graph-type`/`--graphType`, `--x-key`/`--xKey`, and `--bar-color`/`--barColor`.
- Graph CLI height flags are split: use `--node-height`/`--nodeHeight` for the
  canvas frame and `--chart-height` for the chart content. CLI `--height`
  remains a frame-height compatibility alias.
- `edge add|list|remove` — manage edges
- Search-based edge selectors must be specific enough to resolve exactly one node. Queries like
  `"DVT O3"` can be ambiguous; prefer the full visible title such as `"DVT O3 — GitOps"`.
- `search`, `layout`, `status`, `arrange`, `focus` — inspect and navigate the canvas. Prefer
  `focus --no-pan` when you only need to select/raise a node without hijacking the human's camera.
- `ax status|context|focus` — inspect the host-agnostic AX layer; `ax context`
  combines pinned context and AX focus for adapter prompt injection.
- `ax event add`, `ax steer`, `ax evidence add`, `ax timeline` — the AX timeline
  (agent-events, steering messages, evidence). Persisted for diagnostics,
  retention-bounded, and excluded from snapshots.
- `ax work add|update|list`, `ax approval request|resolve|list`,
  `ax review add|list` — canvas-bound AX state (work items, approval gates,
  review annotations) that rides snapshots and restore and is cleared by `clear`.
- `ax host report|status` — report/read the host/session capability (own partition).
- `copilot install-extension [--dry-run] [--yes]` — install the bundled GitHub
  Copilot adapter into a repo; the core stays host-agnostic.
- `fit [id ...]` — set the server viewport to fit the whole canvas or selected nodes before screenshots or whole-board review
- `screenshot --output <path>` — top-level shortcut for `webview screenshot`; supports `--format png|jpeg|webp` and `--quality`
- `json-render --schema|--examples` — inspect the json-render component catalog with `--component`/`--field` filters; same data as `node schema --type json-render` in a more direct shape
- `--strict-size` (alias `--scroll-overflow`) on `node add`/`node update` — keep explicit width/height fixed and scroll overflowing content instead of letting the renderer auto-fit. Useful for long markdown, dense webpages, and dashboards that should fit a tile-sized frame.
- `--show-legend false` / `--show-labels false` on `node add --type graph` and `graph add` — hide chart legends and pie slice labels for compact graph nodes in tile-style boards.
- `open` — open the current workbench in the browser
- `pin --list|--clear|<ids...>` — manage context pins
- `undo`, `redo`, `history` — time travel
- `snapshot save|list|restore|delete` — manage snapshots
- `group create|add|remove` — manage groups
- `clear --yes` — destructive clear with explicit confirmation
- `validate spec` — validate json-render specs and graph payloads without creating nodes
- `web-artifact build` — build bundled React/Tailwind HTML artifacts; use `--deps` for extra packages and `--include-logs` only when raw logs are useful
- `external-app add --kind excalidraw` — create the hosted Excalidraw preset; response includes `id` and `nodeId` aliases for the same canvas node
- `serve status|stop` — inspect and stop daemonized servers started with `serve --daemon`
- `code-graph`, `spatial` — analysis commands

Current caveat:
- `mcp-app` grouping is not fully uniform yet. Web artifact app nodes have grouped reliably, but
  Excalidraw app nodes have shown inconsistent `group add` behavior and weaker rediscoverability
  through search later in the session. When you plan to curate an app-heavy comparison area,
  capture node IDs immediately after creation and verify membership with `node get --summary`,
  `layout --summary`, or the browser selection state instead of relying on search alone.
- App-like nodes persist as `type: "mcp-app"` internally but serialized results include `kind`:
  `web-artifact`, `external-app`, or `mcp-app`. Prefer `node list --type web-artifact` or
  `node list --type external-app` when you need the operational subtype.
- Generic `pmx-canvas node add --type mcp-app` is intentionally not supported because app nodes
  need app/session metadata. Use `pmx-canvas web-artifact build` for bundled React artifacts or
  `pmx-canvas external-app add --kind excalidraw` for the Excalidraw preset.
- For local `image` nodes on macOS, iCloud/OneDrive cloud-only placeholder files are rejected with
  a download-first hint. Download the image locally before adding it to the canvas.

The CLI targets `http://localhost:4313` by default. Override with `PMX_CANVAS_URL` or
`PMX_CANVAS_PORT` when the canvas is running elsewhere.

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
| `mcp-app` | Hosted app/embed frame | Tool-backed MCP apps or external app content; not generic CLI-created notes |
| `json-render` | Native structured UI panel | Dashboards, forms, tables, interactive layouts from json-render specs |
| `graph` | Native chart panel | Line, bar, pie, area, scatter, radar, stacked-bar, composed, plus Tufte primitives (sparkline, dot-plot, bullet, slopegraph) rendered inside the canvas |
| `html` | Sandboxed HTML+JS document | Self-contained HTML with optional inline `<script>` and CDN imports rendered in a sandbox-restricted iframe; canvas theme tokens are auto-injected |
| `group` | Spatial container/frame | Visually group related nodes together |
| `prompt` | Prompt thread root | Canvas-native prompt entry points for agent conversations. **Internal type — surfaces in `canvas://layout` for thread rendering but is not created via the public `canvas_add_node` API. Don't try to add one directly.** |
| `response` | Prompt reply / streamed answer | Agent responses linked to prompt threads. **Same internal-only restriction as `prompt`.** |

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

### Layout: spacing and groups

Agents tend to pack boards too tightly. Give nodes room to breathe — readability beats density.

- **Default spacing:** leave a clear gap between neighbors — roughly half a node's width
  horizontally and half its height vertically. A 280×180 node reads well with ~360px between
  column origins and ~260px between row origins.
- **When nodes are connected by edges, space them further apart** so the edge line, its arrowhead,
  and its label are clearly visible in the gap between nodes. Crowded nodes hide the flow — this is
  the most common cause of an unreadable board.
- **Inside a group, keep the same breathing room** (groups no longer auto-pack children, so the
  spacing you set is what the human sees). Edges between grouped children especially need the gap.
- **Size a group frame larger than its children's bounding box** so the group header — including the
  node-count badge — stays visible and isn't hidden under the top-left child. For an explicit
  (manual) group frame, add margin on every side (≈56px) plus room at the top for the header rather
  than hugging the children. Auto-fit groups (created without an explicit width/height) already
  reserve this margin.

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

MCP node-type routing:

| Node category | MCP creation tool |
|---------------|-------------------|
| Basic nodes (`markdown`, `status`, `context`, `ledger`, `trace`, `file`, `image`, `webpage`) | `canvas_add_node` |
| `json-render` | `canvas_add_json_render_node` |
| `graph` | `canvas_add_graph_node` |
| `html-primitive` | `canvas_add_html_primitive` |
| `html` | `canvas_add_html_node` |
| `web-artifact` | `canvas_build_web_artifact` |
| `external-app` / tool-backed `mcp-app` | `canvas_open_mcp_app` |
| `group` | `canvas_create_group` |

If a node type is rejected by `canvas_add_node`, call `canvas_describe_schema` and read
`mcp.nodeTypeRouting`; do not keep retrying the generic tool.

**`canvas_add_node`** — Add a node to the canvas
- `type` (required): basic node type only; structured/app/group nodes use the routing table above
- `title`: short, scannable title
- `content`: for most types, this is markdown text. For `file` type, pass the **file path**
  (e.g., `"src/auth/login.ts"`) — the server auto-loads the file content and watches for changes.
  For `image` type, pass a file path, URL, or data URI.
- `path`: compatibility alias for image paths only; prefer `content` for new image calls
- `x`, `y`: position (auto-placed if omitted — prefer omitting for auto-layout)
- `width`, `height`: dimensions (sensible defaults provided)
- `color`: semantic color
- `metadata`: arbitrary JSON
- Returns: `{ id: "<node-id>" }` — capture this ID for edges and groups

**`canvas_update_node`** — Update an existing node
- `id` (required): node to update
- Any of: `title`, `content`, `x`, `y`, `width`, `height`, `collapsed`, `arrangeLocked`, `data`
- For `json-render`, pass `spec` to update the rendered spec in place while preserving node ID, edges, pins, and position
- For `graph`, pass graph fields such as `graphType`, `data`, `xKey`, `yKey`, `color`, and `chartHeight` to rebuild the chart in place; use `height`/`nodeHeight` for frame geometry and `chartHeight` for chart content in CLI flows
- Use to update status nodes as work progresses

**`canvas_remove_node`** — Remove a node and all its connected edges
- `id` (required): node to remove
- Clean up nodes that are no longer relevant

**`canvas_remove_annotation`** — Remove a human-drawn annotation
- `id` (required): annotation to remove
- Use when context gives you the annotation ID; use WebView first if you need to identify a mark by shape or location.

**`canvas_get_node`** — Get a single node's full data
- `id` (required): node to retrieve

**`canvas_refresh_webpage_node`** — Re-fetch the URL stored on a `webpage` node
- `id` (required): webpage node to refresh
- Optional `url`: replace the stored URL before refreshing (use when the human moved the page)
- Returns the refreshed node with updated `pageTitle` and cached extracted text
- Use this when a saved canvas is reopened and the agent needs fresh page content without
  losing the node's identity, position, or pins. Example flow:

  ```typescript
  // Add the page once
  canvas_add_node({ type: 'webpage', url: 'https://example.com/docs' })
  // → returns { id: 'node-abc' }

  // …later, after the human reopens the canvas…
  canvas_refresh_webpage_node({ id: 'node-abc' })
  // → re-fetches the URL, updates pageTitle + extracted text, keeps the node ID and position
  ```

**`canvas_add_json_render_node`** — Add a native json-render node
- Required: `spec`; `title` is optional and inferred from the root element when omitted
- Prefer a complete json-render object with `root`, `elements`, and optional `state`
- Legacy bare component specs like `{ type: "Badge", props: {...} }` are accepted and wrapped into a one-element document for compatibility
- Use this when you want a structured UI panel rendered directly inside PMX Canvas
- For shadcn `Badge`, prefer `props.text` with variants `default`, `secondary`, `destructive`, or
  `outline`. Legacy `props.label` and status variants (`success`, `info`, `warning`, `error`,
  `danger`) are normalized for saved-spec compatibility.

**`canvas_stream_json_render_node`** — Build a json-render node progressively (live)
- Omit `nodeId` on the first call to create a new streaming node — it returns the node `id`
- Pass that same `nodeId` on later calls to append more `patches`; set `done: true` on the final call
- `patches` are SpecStream JSON-Patch ops applied server-side (the canvas accumulates the spec):
  `{ "op": "add", "path": "/elements/card", "value": { "type": "Card", "props": { "title": "Live" }, "children": [] } }`,
  `{ "op": "replace", "path": "/root", "value": "card" }`,
  `{ "op": "add", "path": "/elements/card/children/-", "value": "row1" }`
- Build incrementally: set `/root`, add container elements, then append child element ids and elements
- Each call re-renders the live node; partial specs render what they can. Use for dashboards/reports
  that should fill in as you generate them rather than appearing all at once.

**`canvas_add_graph_node`** — Add a native graph/chart node
- Required: `graphType`, `data`
- Supports `line`, `bar`, `pie`, `area`, `scatter`, `radar`, `stacked-bar`, `composed`,
  and the Tufte primitives `sparkline`, `dot-plot`, `bullet`, `slopegraph` (aliases accepted)
- Use `xKey`/`yKey` for line, bar, area, and scatter graphs
- Use `zKey` for scatter bubble size
- Use `nameKey`/`valueKey` for pie graphs
- Use `axisKey` plus `metrics` for radar graphs
- Use `series` for stacked-bar graphs
- Use `barKey`/`lineKey` plus optional `barColor`/`lineColor` for composed graphs
- Bar charts: `colorBy` (`series` default = one accent + a highlighted bar, `category`, `value`, `none`) and `highlight` (`max`/`min`/index)
- Use `valueKey` for `sparkline` (plus `fill`/`showEndDot`/`showMinMax`/`showValue`)
- Use `labelKey`/`valueKey` (plus `sort`) for `dot-plot`
- Use `labelKey`/`valueKey`/`targetKey`/`rangesKey` for `bullet`
- Use `labelKey`/`beforeKey`/`afterKey` (plus `beforeLabel`/`afterLabel`/`colorByDirection`) for `slopegraph`
- Use `nodeHeight` for the canvas frame height and `height` for chart content height
- Uses the native json-render chart catalog under the hood

**Tufte-aware charting** — color must encode data, not decorate. For chart design and critique, use
the `tufte-viz` skill (`skills/tufte-viz/SKILL.md`). Key rules:
- Single-series `bar` charts use `colorBy`: default `series` (one accent + one highlighted bar),
  `category` (opt-in palette), `value` (sequential shade by magnitude), or `none` (flat). Do not
  rainbow categorical bars by default.
- Prefer the Tufte primitives where they fit: `sparkline` (inline trend), `dot-plot` (ranked single
  metric vs. a bar forest), `bullet` (measure vs. target, replaces a gauge), `slopegraph`
  (before/after across many categories).
- Direct-label data (`showLegend: false`) instead of a legend when one or two series are identifiable.
- For more than ~4 overlapping series, build small multiples (several small graph nodes on a shared
  scale, arranged in a grid/group) instead of one multi-color chart.

**`canvas_build_web_artifact`** — Build and optionally open a bundled web artifact
- Required: `title`, `appTsx` (source string contents, not a file path)
- CLI `--app-file` reads a file before calling the same build path; MCP callers must pass the source contents
- Cold builds commonly take 45-60 seconds; use a long client timeout such as 300000 ms or more
- Returns both `id` and `nodeId` for the created artifact node when `openInCanvas` is true

ID extraction for mixed tool responses:
- Most add-style tools return a flat `id`; web artifacts return `id` plus `nodeId`; snapshots return `id` plus nested `snapshot.id`.
- Defensive extractor: `const getId = (r) => r.id ?? r.nodeId ?? r.snapshot?.id;`

**`canvas_open_mcp_app`** — Open a tool-backed external MCP app node
- Required: `toolName`, `transport`
- `transport` is either `{ type: "stdio", command, args?, cwd?, env? }` or `{ type: "http", url, headers? }`
- This is lower-level than `pmx-canvas external-app add --kind excalidraw`; use `canvas_add_diagram` for the built-in Excalidraw preset

**`canvas_pin_nodes`** — Set, add, or remove pinned context nodes
- Use `{ nodeIds: [...] }`; the field is `nodeIds`, not `ids`

**`canvas_diff`** — Compare current canvas state with a saved snapshot
- Requires `{ snapshot: "<snapshot-id-or-name>" }`; there is no implicit previous-snapshot default

**`canvas_describe_schema`** — Inspect the running server's create schemas and canonical examples
- Use this before generating structured payloads when you need the authoritative current shape
- Read `mcp.nodeTypeRouting` to choose the right MCP creation tool for each node category

**`canvas_validate_spec`** — Validate a json-render spec or graph payload without creating a node
- Returns the normalized json-render spec the server would accept
- Use this when you want a dry run before creating a `json-render` or `graph` node

**`canvas_fit_view`** — Fit viewport to all nodes or selected nodes
- Optional: `width`, `height`, `padding`, `maxScale`, `nodeIds`
- Use before screenshot workflows or whole-board review so the server viewport matches the intended camera

**Batch graph creation**
- Use `graph.add` inside `canvas_batch` / `pmx-canvas batch` when you need a graph node as part of
  a larger one-shot build.
- It accepts the same shape as `canvas_add_graph_node`: `graphType`, `data`, optional `title`,
  `xKey`, `yKey`, `zKey`, `nameKey`, `valueKey`, `axisKey`, `metrics`, `series`, `barKey`,
  `lineKey`, `aggregate`, `color`, `barColor`, `lineColor`, `height`, `x`, `y`, `width`, and
  `nodeHeight`.
- In batch/MCP/HTTP payloads, `height` is chart content height and `nodeHeight` is the canvas frame height.

### Edge Operations

**`canvas_add_edge`** — Connect two nodes
- `from`, `to` (required): source and target node IDs
- `fromSearch`, `toSearch`: optional search-based selectors when you do not have IDs. Each search
  query must resolve to exactly one node or the edge creation fails with an ambiguity error.
- `type`: `flow`, `depends-on`, `relation`, or `references` (default: `relation`)
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
- Avoid focusing every node in a batch. Focus only the final result or use CLI `focus --no-pan`
  when the goal is selection/raising without camera movement.

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

### Group Layout Guidance

Use groups as spacious semantic regions, not as tight containers.

- Size the child nodes first, especially `graph`, `json-render`, `mcp-app`, image, and webpage
  nodes whose rendered content may need more height than their visible title suggests.
- Give every group generous interior padding. Reserve extra top padding for the group header, then
  keep children clear of the frame edges so headers, glow, resize handles, and node chrome do not
  visually collide.
- If creating a group manually, compute its frame from the final child bounds plus padding. If the
  group exists first, expand it before adding large children rather than shrinking children to fit.
- Use groups to label major regions of a board. Avoid wrapping every small relationship; too many
  tight groups make the canvas harder to read than no groups.
- Keep edges local to a group where possible. Long cross-board edges can look like they come from
  nowhere; use a nearby bridge/context node or split the relationship into shorter labeled edges.
- After grouping, verify the result in `canvas_get_layout` or the browser: child nodes should be
  fully inside the group with padding, visible nodes should not overlap, and group headers should
  not cover content.
- If a group makes important content less visible, enlarge the group, split it into clearer
  regions, or remove the group. Visibility is more important than preserving a frame.

### Grouped Comparison Boards

Use groups as named comparison areas, not just visual boxes.

- Create the comparison frame first with `canvas_create_group` or `pmx-canvas group create`, then
  add charts, artifacts, and diagrams into that area deliberately.
- Prefer graph nodes for fast capability demos and side-by-side comparisons. They are lightweight,
  validate quickly, and are easier to regenerate.
- Prefer web artifacts when the board needs a richer narrative UI, custom interaction, or a more
  polished presentation layer than a graph or json-render node can provide.
- Use Excalidraw for sketching and flow diagrams, but treat it as less reliable than web-artifact
  app nodes for grouping and rediscovery until `mcp-app` grouping parity is fixed.
- Native node types are still the most agent-friendly. Graph nodes are the strongest comparison
  primitive today, web artifacts are good but heavier, and Excalidraw / other `mcp-app` nodes are
  useful but still the weakest operationally for create, rediscover, group, and reconnect flows.
- Leave larger spacing between major regions than you think you need. The spatial analyzer still
  tends to read dense boards as one giant cluster unless groups and gaps are both clear.
- If you are expanding a board incrementally, verify each add-to-group step instead of assuming
  the node joined the area. Comparison workflows depend on reliable “add this thing to the region
  I’m already building.”

Current product caveats for grouped comparison boards:
- `mcp-app` grouping parity is inconsistent. Web artifacts have grouped cleanly; Excalidraw has
  not always behaved the same way.
- Search/discoverability for external app nodes can degrade over time in-session, so node IDs are
  safer than title-based rediscovery for follow-up grouping or focus operations.
- `mcp-app` nodes are less inspectable than native nodes. For graph nodes you can reason from
  structured config, but app nodes often only tell you that an app exists unless you also inspect
  nearby markdown, file, or graph context.
- Long-running web artifact builds can exceed a short command timeout. When using them in an
  agent workflow, prefer progress-aware handling and avoid assuming a timeout means failure.

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
- Best default pin set for agent collaboration: one intent-setting markdown node plus 1-3 concrete
  output nodes
- Graph, file, and markdown pins usually carry richer usable context than `mcp-app` pins
- Artifact and Excalidraw pins still matter as intent signals, but pair them with a markdown or
  graph pin when you want the agent to understand what is inside the app, not just that it matters

### History & Snapshots

**`canvas_undo`** — Undo the last canvas mutation
**`canvas_redo`** — Redo the last undone mutation
**`canvas_snapshot`** — Save a named snapshot to disk
- `name` (required): descriptive snapshot name (e.g., "before-refactor")
- Returns `{ ok, id, snapshot }`; the flat `id` is an alias for `snapshot.id`
**`canvas_restore`** — Restore canvas from a saved snapshot
- `id`: snapshot to restore
**`canvas_diff`** — Compare current canvas against a saved snapshot
- Shows added, removed, and modified nodes/edges
- Useful for reviewing what changed during a work session

### Canvas Management

**`canvas_clear`** — Remove all nodes and edges
- **Always call `canvas_snapshot` first** to save a backup before clearing
- This is irreversible without a prior snapshot

### Browser Automation (WebView)

The canvas exposes a headless browser session over MCP for self-inspection and
automated screenshotting. Use this when you want to (a) verify what the live
canvas actually looks like after a sequence of mutations, (b) capture an image
of a freshly-built artifact for the human to review, or (c) drive arbitrary
JavaScript inside the workbench page.

The WebView automation runs on Bun's WebKit-based WebView (macOS) or a headless
Chromium fallback (Linux). It does **not** open a visible window; it's an
additional headless renderer attached to the same canvas server, so all five
tools below operate on the live canvas state.

**`canvas_webview_status`** — Inspect the current automation session
- Returns `{ supported, active, backend, viewportWidth, viewportHeight, url, lastError }`
- Call before `start` to check whether a session is already alive

**`canvas_webview_start`** — Start (or replace) the automation session
- Optional: `backend` (`webkit` macOS-only, or `chrome`), `width`, `height`
- The session opens `/workbench` at the canvas URL, waits for the SPA to
  hydrate, and reports back via `canvas_webview_status`

**`canvas_webview_stop`** — Tear down the automation session

**`canvas_evaluate`** — Run JavaScript inside the workbench page and return the result
- Required: exactly one of `expression` (single JS expression) or `script` (multi-statement body)
- `script` is wrapped in an async IIFE, so top-level `await` works inside script bodies
- Useful for asserting DOM state after a sequence of canvas mutations
- Do not use `fetch()` inside `canvas_evaluate` to call PMX HTTP APIs; WebView security/CORS
  restrictions can block those requests. Use the matching MCP tools instead.
- Example: read the count of rendered `.canvas-node` elements:

  ```typescript
  canvas_evaluate({ expression: 'document.querySelectorAll(".canvas-node").length' })
  ```

Useful workbench selectors:
- Nodes: `.canvas-node`, `.canvas-node.active`, `.canvas-node.context-pinned`, `.canvas-node.group-node`
- Node internals: `.node-title`, `.node-titlebar`, `.node-body`, `.node-type-badge`, `.node-controls`
- Annotations: `.annotation-layer path` renders human-drawn freehand ink. Use WebView
  to inspect or screenshot annotation shapes; MCP/context resources only expose compact
  annotation target summaries, not the raw visual shape. Humans can remove marks with
  the eraser toolbar button; agents can remove a known annotation ID with
  `canvas_remove_annotation`.
- Canvas chrome: `.hud-layer`, `.canvas-toolbar`, `.connection-dot`, `.canvas-bootstrap-card`
- Nodes do not expose stable `data-node-id` attributes. Use `canvas_get_layout`, `canvas_search`, or MCP resource data for exact node IDs.

Async script example:

```typescript
canvas_evaluate({
  script: 'const title = await Promise.resolve(document.title); return title;',
})
```

**`canvas_resize`** — Change the WebView viewport
- Required: `width`, `height`
- Use before `canvas_screenshot` when the human needs a specific aspect ratio

**`canvas_screenshot`** — Capture a PNG of the current workbench
- Optional: `format` (`png` default), `fullPage` (boolean)
- Returns both an MCP image payload (renderable inline by capable agents) and
  a path under `.pmx-canvas/screenshots/` so the human can view the file
- Pair with `canvas_resize` to control the framing

Typical flow when you want to show a result:

```typescript
canvas_webview_start({ width: 1440, height: 900 });
// …mutations…
canvas_screenshot({ fullPage: true });
canvas_webview_stop();
```

### Diagrams (Excalidraw MCP app preset)

**`canvas_add_diagram`** — Draw a hand-drawn diagram on the canvas via the hosted
[Excalidraw MCP app](https://github.com/excalidraw/excalidraw-mcp)
- Required: `elements` — an array of Excalidraw elements (rectangles, ellipses, diamonds, arrows,
  text). Can also be a JSON-array string.
- `elements` must be Excalidraw element objects, not Mermaid/DOT/source-text diagrams. Convert source diagrams to Excalidraw elements first or use a markdown/web-artifact node.
- Optional: `title`, `x`, `y`, `width`, `height`
- The diagram opens inside an `mcp-app` node with fullscreen editing and draw-on animations
- CLI equivalent: `pmx-canvas external-app add --kind excalidraw --title "Diagram"`
- Edits made in expanded/fullscreen mode are persisted back into the node model context and replayed
  when the app iframe remounts.
- Use this when the human needs a quick sketch, architecture diagram, or flowchart and a
  geometric `graph` node would feel too rigid
- Prefer labeled shapes (`"label": { "text": "..." }` on rectangle/ellipse/diamond) over
  separate text elements — fewer tokens and auto-centered
- Do not use separate `text` elements with `containerId`/`boundElements` to place centered text
  inside shapes. The hosted SVG preview does not auto-position those; PMX normalizes imported
  canonical bound text back into shape labels for hosted app calls.
- For detailed sizing, camera, and label-fit rules, read `references/excalidraw-diagram-authoring.md`
  before creating dense diagrams.
- Prefer the pastel fill palette in the Excalidraw `read_me` (light blue/green/orange/...) for
  a consistent look across diagrams

### External MCP apps (bring your own)

**`canvas_open_mcp_app`** — Open any external [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps)
server's `ui://` resource as an iframe node on the canvas
- Required: `toolName`, `transport` (`http` URL or `stdio` command)
- Optional: `serverName`, `toolArguments`, `title`, `x`, `y`, `width`, `height`
- Use when no dedicated preset exists yet. The Excalidraw preset (`canvas_add_diagram`) is the
  only one today

### Web Artifacts

**`canvas_build_web_artifact`** — Build a single-file HTML artifact from React/Tailwind source
- Required: `title`, `appTsx`
- Optional: `indexCss`, `mainTsx`, `indexHtml`, extra `files`, `projectPath`, `outputPath`, `deps`, `includeLogs`
- By default it opens the result on the canvas as an embedded app node
- By default it returns compact log summaries; set `includeLogs: true` when you need raw stdout/stderr
- `recharts` is available in the scaffold. For additional libraries, pass CLI `--deps name,name2`
  or MCP/API `deps: ["name"]` before bundling.
- Failed or empty CLI bundles print `ok: false`, exit non-zero, and do not create a canvas node.
- Use this when the output should be a richer interactive UI than a simple markdown/file/image node
- Prefer the dedicated `web-artifacts-builder` skill when you need the full React + shadcn workflow
- Use the `playwright-cli` skill when you need to validate the built artifact in a live browser

### HTML Nodes (Sandboxed iframe)

**`canvas_add_html_node`** — Add a normal self-contained HTML document rendered in a sandboxed iframe
- Required: `html` (full document or fragment; inline `<script>` and CDN `<script src="...">` are allowed). If `html` is a bare path to an existing local `.html`/`.htm` file, the server reads that file's contents; otherwise it is treated as raw HTML.
- Optional: `title`, `summary`, `agentSummary`, `presentation`, `slideTitles`, `embeddedNodeIds`, `embeddedUrls`, `x`, `y`, `width` (default 720), `height` (default 640), `strictSize`
- Iframe sandbox is `allow-scripts` only — no same-origin access, no top-navigation, no forms
- Canvas theme tokens are auto-injected as CSS custom properties (both `--c-*` and common `--color-*` aliases such as `--color-text-primary`, `--color-bg`, `--color-accent`) and updated live when the canvas theme changes
- Use for moderate-complexity visualizations and interactive widgets that need real JS but do not warrant a full React build (Chart.js demos, D3 sketches, custom HTML report views)
- Normal HTML is the default. Only pass `presentation: true` when the user explicitly asks for a deck/fullscreen presentation; otherwise do not mark raw HTML as presentable.
- Only presentation-marked HTML nodes expose a browser `Present` button. Use it when the HTML is a deck, briefing, or fullscreen review surface; the PMX shell owns the fullscreen overlay and exits via `Esc` or `Exit presentation`.
- PMX stores a semantic sidecar (`agentSummary`, `contentSummary`, embedded references) so HTML nodes remain understandable in search, pinned context, and spatial context

**`canvas_add_html_primitive`** — Generate a reusable HTML communication primitive as a sandboxed `html` node
- Required: `kind`; run `canvas_describe_schema` and read `htmlPrimitives` for the current catalog
- Optional: `title`, `data`, `x`, `y`, `width`, `height`, `strictSize`
- Use when markdown would be too dense and a structured visual artifact is clearer: tradeoff grids, implementation plans, PR reviews, module maps, design sheets, explainers, reports, and lightweight human-editable boards/editors
- When the human asks for a PowerPoint-like output, pitch deck, briefing, or presentation, use `kind: "presentation"` unless a bespoke raw HTML deck is required. Include `slides` with short titles, one idea per slide, optional `metrics`, `note` fields for speaker notes, and optional `theme: "canvas" | "midnight" | "paper" | "aurora"` or a custom theme object.
- Read `htmlPrimitives` from `canvas_describe_schema` for the data shape and examples before constructing a payload
- For payload patterns, export loops, and the primitive catalog, read `references/html-primitives.md` before creating dense or editable artifacts

### Open as Site (standalone surfaces)

Any renderable surface node can be opened full-page in its own browser tab — the same
document it shows in the canvas, just without the node chrome. In the workbench, use the
↗ **Open as site** button in the node title bar (or the expanded overlay).

- Works for `html` / `html-primitive`, bundled `web-artifact`, `json-render` / `graph`,
  `webpage`, and hosted ext-app `mcp-app` nodes.
- The tab loads the node's stable surface URL, `/api/canvas/surface/<nodeId>`. The
  in-canvas iframe loads the **exact same URL**, so there is one render path and no
  separate "preview" version — what you see in the canvas is what opens. The URL reflects
  current node state and survives a refresh.
- Agents can read this URL from any node payload (`canvas_get_node` / `canvas_get_layout`)
  as `surfaceUrl` — a reliable way to tell a human "open the artifact" without disturbing
  the canvas.
- Served HTML stays sandboxed (opaque origin via a `Content-Security-Policy: sandbox`
  response header), so opening author code top-level cannot reach the canvas origin.
- ext-app `mcp-app` nodes open their UI, but interactive tool-calls only work inside the
  canvas (the host bridge has no peer in a bare tab). `webpage` and URL-backed `mcp-app`
  nodes redirect to their external site.
- This is additive — opening a site never evicts or replaces canvas nodes.

### Choosing the Right Visual Tier

When the output is more than markdown, pick the lightest tier that fits:

| Tier | Tool | Build cost | When to pick it |
|------|------|------------|-----------------|
| Declarative UI | `canvas_add_json_render_node` / `canvas_add_graph_node` | None | Schema-driven dashboards, forms, charts; agent-friendly to read back via `canvas_get_node` |
| Generated HTML primitive | `canvas_add_html_primitive` | None | Reusable communication artifacts such as choices, plans, reviews, maps, reports, presentations/decks, and lightweight editors |
| Sandboxed HTML+JS | `canvas_add_html_node` | None | Self-contained HTML with inline JS or CDN scripts; one-off visualizations or report views |
| Hosted MCP app | `canvas_open_mcp_app` / `canvas_add_diagram` | None | Interactive editors backed by an external MCP server (e.g. Excalidraw) |
| Bundled React app | `canvas_build_web_artifact` | Heavy (npm install + bundle) | Multi-component UIs needing React state, routing, shadcn/ui, or Tailwind class composition |

### Native Structured UI

Use native `json-render` and `graph` nodes when the output should stay fully inside PMX Canvas:

1. Use `canvas_add_json_render_node` for dashboards, forms, summaries, and interactive UI panels
2. Use `canvas_add_graph_node` for charts and trend visualizations
3. Use the repo-local `json-render-*` skills when you need help authoring or refining the spec itself
4. Use `canvas_build_web_artifact` instead when the result needs a full custom React app rather than a schema-driven UI

## MCP Resources

These resources give you read access to canvas intelligence. Read them to understand
what the human has set up and what they're focusing on.

| Resource | What it provides |
|----------|-----------------|
| `canvas://pinned-context` | Content of pinned nodes + nearby unpinned neighbors |
| `canvas://schema` | Running-server create schemas and json-render catalog metadata |
| `canvas://layout` | Full canvas state (viewport, nodes, edges) |
| `canvas://summary` | Compact overview: node counts by type, pinned titles |
| `canvas://spatial-context` | Proximity clusters, reading order, pinned neighborhoods |
| `canvas://history` | Human-readable mutation timeline |
| `canvas://code-graph` | Auto-detected file import dependencies (JS/TS, Python, Go, Rust) |
| `canvas://ax` | Host-agnostic AX state: focus, work items, approval gates, review annotations, host capability |
| `canvas://ax-context` | Agent-ready AX context: pinned context + current focus |
| `canvas://ax-work` | Canvas-bound AX work: work items, approval gates, review annotations |
| `canvas://ax-timeline` | Bounded AX timeline: recent agent events, evidence, and steering messages |
| `canvas://skills` | Index of bundled agent skills shipped with the install. Each skill is also addressable as `canvas://skills/<name>` (e.g. `canvas://skills/web-artifacts-builder`) and returns the full SKILL.md. Read this resource first to discover companion workflows the canvas is built to support. |

### Reading Spatial Intent

The `canvas://spatial-context` resource reveals how the human has organized information:

- **Proximity clusters** — Nodes placed near each other form implicit groups. If the human
  placed three files next to each other, those files are related in their mental model.
- **Reading order** — Nodes sorted top-left to bottom-right, following natural reading flow.
  This implies sequence or priority.
- **Pinned neighborhoods** — For each pinned node, nearby unpinned nodes are listed. These
  are the human's implicit context — things they consider related to what they pinned.
- **Annotations** — Human-drawn markup is summarized by target/bounds only, e.g. an
  annotation over a node or empty canvas region. Use WebView (`canvas_webview_start` +
  `canvas_evaluate`/`canvas_screenshot`) when you need to see whether the mark is an
  arrow, line, circle, or other drawn shape. Remove known annotations with
  `canvas_remove_annotation`; otherwise use WebView to identify the mark first.
- **Board density matters** — On a dense board, spatial context can still read like one large
  gallery unless groups and spacing separate the major regions clearly.

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
| DELETE | `/api/canvas/edge` | Remove edge (`{ "edge_id": "..." }`) |
| GET | `/api/canvas/snapshots` | List snapshots |
| POST | `/api/canvas/snapshots` | Save snapshot |
| POST | `/api/canvas/snapshots/<id>` | Restore snapshot |
| DELETE | `/api/canvas/snapshots/<id>` | Delete snapshot |
| POST | `/api/canvas/context-pins` | Replace pinned nodes |
| GET | `/api/canvas/pinned-context` | Get current pins with neighborhood context |
| GET | `/api/canvas/search?q=...` | Search nodes |
| POST | `/api/canvas/json-render` | Create a native json-render node |
| POST | `/api/canvas/json-render/stream` | Create/append a streaming json-render node (SpecStream patches) |
| POST | `/api/canvas/graph` | Create a native graph node |
| GET | `/api/canvas/schema` | Get running-server create schemas, examples, and json-render catalog metadata |
| POST | `/api/canvas/schema/validate` | Validate a json-render spec or graph payload without creating a node |
| GET | `/api/canvas/json-render/view?nodeId=...` | View a native json-render or graph node |
| POST | `/api/canvas/diagram` | Create an Excalidraw external app node |
| POST | `/api/canvas/mcp-app/open` | Open a tool-backed MCP app node |
| POST | `/api/canvas/web-artifact` | Build a bundled web artifact and optionally open it on canvas |
| POST | `/api/canvas/group` | Create group |
| POST | `/api/canvas/group/add` | Add nodes to group |
| POST | `/api/canvas/group/ungroup` | Ungroup |
| POST | `/api/canvas/arrange` | Auto-arrange |
| POST | `/api/canvas/focus` | Center viewport on node |
| POST | `/api/canvas/fit` | Fit viewport to canvas bounds or selected nodes |
| POST | `/api/canvas/clear` | Clear canvas |
| POST | `/api/canvas/update` | Batch update positions |
| GET | `/api/canvas/spatial-context` | Spatial clusters and reading order |
| POST | `/api/canvas/undo` | Undo |
| POST | `/api/canvas/redo` | Redo |
| GET | `/api/canvas/history` | Mutation history |
| GET | `/api/canvas/code-graph` | File dependency graph |
| GET | `/api/workbench/events` | SSE event stream |

## Workflow Patterns

These are **operational recipes** — how to sequence canvas calls for a few
recurring shapes of work. They are not the project's use cases (those live
in the README and are intentionally non-exhaustive). The patterns here exist
to make the agent's tool-call sequencing concrete: which MCP tool fires
when, what to pin, when to read `canvas://pinned-context`, when to snapshot.

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
   - If an `mcp-app` node is pinned, treat it as “important but partially opaque” and use nearby
     graph/file/markdown nodes to recover the missing semantic detail
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

### Interactive Artifact Builds

When the user wants a real browser app instead of static notes:

1. Use the `web-artifacts-builder` skill if the UI needs React state, routing, or shadcn-style components
2. Build with `canvas_build_web_artifact`
3. Keep `openInCanvas` enabled unless the user explicitly wants only the output file
4. Use the returned `projectPath` as the reusable source workspace for iterations
5. Use the returned `path` for sharing or for opening the generated artifact outside the canvas
6. Use the `playwright-cli` skill if you need to verify the artifact route or embedded app behavior in a browser

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
   Prefer one intent-setting markdown pin plus a small set of concrete output pins over pinning a
   whole gallery.

9. **Snapshot before destructive changes.** Before clearing or major reorganization,
   save a snapshot so you can restore if needed.

10. **Prefer MCP tools over HTTP.** When running as an MCP server, use the canvas tools
    directly rather than shelling out to curl. The tools handle all the details.

11. **Use groups for visual organization.** When 3+ nodes are related, wrap them in a
    group to make the relationship visible at a glance.

12. **Use file nodes for source code.** File nodes auto-watch for changes and update
    live. This is better than pasting code into markdown nodes.

13. **Comparison boards need structure, not just content.** For galleries and evaluations, use a
    named group, give the area breathing room, and keep related charts/artifacts inside that
    region instead of letting them drift into the main cluster.

14. **Capture external app IDs immediately.** For Excalidraw and other `mcp-app` nodes, store the
    returned node ID or pin the node right away. Search/title rediscovery is less reliable there
    than for markdown, graph, or file nodes.

15. **Pair app nodes with explainers.** If you create or pin a web artifact or Excalidraw node,
    add a nearby markdown, graph, or file node that explains what the app is for. This makes
    pinned context far more useful to later agents.

## Persistence

Canvas state auto-saves to `.pmx-canvas/canvas.db` on every mutation (debounced 500ms). State
loads automatically on server start. The SQLite DB is git-committable — spatial knowledge
persists across sessions.

Snapshots, context pins, and large node blobs are stored in the same DB. Web artifacts land in
`.pmx-canvas/artifacts/`. Legacy JSON state, snapshot, and blob files are auto-imported into
SQLite and renamed to `.bak` on first boot.

Stop the server or flush/close the SDK before committing `canvas.db`; shutdown checkpoints SQLite
WAL data into the DB file.

## Real-Time Collaboration

The canvas supports real-time human-agent collaboration:

- **Human pins nodes in browser** → agent reads `canvas://pinned-context`
- **Agent adds/updates nodes** → human sees changes instantly via SSE
- **Human moves/groups nodes** → spatial arrangement communicates intent
- **Agent reads spatial context** → understands implicit relationships

This bidirectional flow means the canvas is a shared workspace, not just an output display.
Pay attention to what the human is doing on the canvas — their spatial choices are meaningful.
