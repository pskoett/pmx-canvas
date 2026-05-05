# MCP reference

PMX Canvas ships an MCP stdio server with **41 tools** + **8 core resources**,
plus per-skill resources at `canvas://skills/<name>`. The server emits
`notifications/resources/updated` when canvas state changes — humans pin
nodes in the browser, agents are notified immediately.

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

## Tools

| Tool | Description |
|------|-------------|
| `canvas_add_node` | Add a node (markdown, status, context, file, webpage, html, etc.) |
| `canvas_add_html_node` | Create an `html` node from a self-contained HTML/JS document (sandboxed iframe) |
| `canvas_add_diagram` | Hand-drawn diagram via the hosted Excalidraw MCP App (preset alias for `canvas_open_mcp_app`) |
| `canvas_open_mcp_app` | Open any [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) server's `ui://` resource as an iframe node |
| `canvas_describe_schema` | Describe the running server's create schemas, examples, and json-render catalog |
| `canvas_validate_spec` | Validate a json-render spec or graph payload without creating a node |
| `canvas_refresh_webpage_node` | Re-fetch and update a webpage node from its stored URL |
| `canvas_add_json_render_node` | Create a native json-render node from a validated spec |
| `canvas_add_graph_node` | Create a native graph node (line, bar, pie, area, scatter, radar, stacked-bar, composed) |
| `canvas_build_web_artifact` | Build a bundled HTML artifact and open it on the canvas |
| `canvas_update_node` | Update content, position, size, collapsed state |
| `canvas_remove_node` | Remove a node and its edges |
| `canvas_get_layout` | Get full canvas state |
| `canvas_get_node` | Get a single node by ID |
| `canvas_remove_annotation` | Remove a human-drawn annotation by ID |
| `canvas_add_edge` | Connect two nodes |
| `canvas_remove_edge` | Remove a connection |
| `canvas_arrange` | Auto-arrange (grid/column/flow) |
| `canvas_validate` | Validate collisions, containment, and missing edge endpoints |
| `canvas_focus_node` | Pan viewport to a node; use CLI `focus --no-pan` when you only need to select/raise |
| `canvas_pin_nodes` | Pin nodes to include in agent context |
| `canvas_clear` | Clear all nodes and edges |
| `canvas_snapshot` | Save current canvas as a named snapshot |
| `canvas_list_snapshots` | List saved snapshots, bounded to the newest 20 by default |
| `canvas_gc_snapshots` | Delete old snapshots while keeping the newest N |
| `canvas_restore` | Restore canvas from a saved snapshot |
| `canvas_delete_snapshot` | Delete a saved snapshot |
| `canvas_search` | Find nodes by title/content keywords |
| `canvas_undo` | Undo the last canvas mutation |
| `canvas_redo` | Redo the last undone mutation |
| `canvas_diff` | Compare current canvas vs a saved snapshot |
| `canvas_create_group` | Create a group containing specified nodes |
| `canvas_group_nodes` | Add nodes to an existing group |
| `canvas_ungroup` | Release all children from a group |
| `canvas_batch` | Run a batch of canvas operations with `$ref` support |
| `canvas_webview_status` | Get Bun.WebView automation status for the workbench |
| `canvas_webview_start` | Start or replace the Bun.WebView automation session |
| `canvas_webview_stop` | Stop the active Bun.WebView automation session |
| `canvas_evaluate` | Evaluate JavaScript in the active workbench automation session |
| `canvas_resize` | Resize the active workbench automation viewport |
| `canvas_screenshot` | Capture a screenshot from the active workbench automation session |

## Resources

Individual bundled skills are also readable at `canvas://skills/<name>`.

| Resource | Description |
|----------|-------------|
| `canvas://pinned-context` | Content of pinned nodes + nearby unpinned neighbors |
| `canvas://schema` | Running-server create schemas and json-render catalog metadata |
| `canvas://layout` | Full canvas state (all nodes, edges, viewport) |
| `canvas://summary` | Compact overview: counts, pinned titles, viewport |
| `canvas://spatial-context` | Proximity clusters, reading order, pinned neighborhoods |
| `canvas://history` | Mutation history timeline with undo/redo position |
| `canvas://code-graph` | Auto-detected file dependency graph (JS/TS, Python, Go, Rust) |
| `canvas://skills` | Index of bundled agent skills + per-skill content at `canvas://skills/<name>` |

## Change notifications

The MCP server emits `notifications/resources/updated` whenever canvas state
changes:

- Pin changes notify `canvas://pinned-context`
- All mutations notify `canvas://layout`, `canvas://summary`,
  `canvas://spatial-context`, `canvas://history`, and `canvas://code-graph`

This closes the human-to-agent loop: spatial curation in the browser becomes
an immediate signal in the agent's context.

## Annotation Visibility

Human-drawn canvas annotations are rendered as browser SVG ink. MCP resources
keep annotation context compact: agents see annotation counts, bounds, and target
summaries such as the node or empty canvas region that was marked, but not the
raw stroke geometry or visual shape.

Annotations are a browser-visible markup layer. Use the pen toolbar button to
draw and the eraser toolbar button to remove an annotation again; agents can also
remove a known annotation ID with `canvas_remove_annotation`.

Use WebView automation when an agent needs to actually see annotations as drawn.
For example, inspect `.annotation-layer path` with `canvas_evaluate` or capture a
`canvas_screenshot` to distinguish an arrow from a line, circle, or highlight.

## Node-type routing

MCP node creation uses dedicated tools for structured node families. Read
`mcp.nodeTypeRouting` from `canvas_describe_schema` / `canvas://schema` when
in doubt:

- `json-render` → `canvas_add_json_render_node`
- `graph` → `canvas_add_graph_node`
- `html` → `canvas_add_html_node`
- `web-artifact` → `canvas_build_web_artifact`
- `mcp-app` → `canvas_open_mcp_app`
- `group` → `canvas_create_group`
- Basic nodes (`markdown`, `status`, `file`, `image`, `webpage`) →
  `canvas_add_node`

## CLI/MCP alignment

CLI and MCP are kept aligned for the main canvas operations: node and edge
creation, graph/json-render/html nodes, web artifacts, external apps, groups,
batch builds, layout validation, snapshots, search, focus, pins, undo/redo,
semantic watch streams, WebView automation, and daemon/server control where
it applies. A few agent-native capabilities — resource subscriptions and
`canvas_diff` — remain MCP-only.
