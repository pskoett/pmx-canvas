# CLI reference

The CLI is the shell-native way to run and control PMX Canvas. It targets
`http://localhost:4313` by default — override with `PMX_CANVAS_URL` or
`PMX_CANVAS_PORT` when the server runs elsewhere.

## Server lifecycle

```bash
pmx-canvas                            # Start canvas, open browser
pmx-canvas --demo                     # Start with the saved dashboard demo board
pmx-canvas --port=8080                # Custom port
pmx-canvas --no-open                  # Headless (for agents/CI)
pmx-canvas --theme=light              # dark | light | high-contrast
pmx-canvas --mcp                      # Run as MCP server (stdio)
pmx-canvas --webview-automation       # Start headless Bun.WebView session
pmx-canvas open                       # Open the current workbench in a browser
```

### Daemon mode

Run detached with pid/log tracking instead of holding a terminal:

```bash
pmx-canvas serve --daemon --no-open --wait-ms=20000   # Start detached, wait for health
pmx-canvas serve status                               # Inspect daemon health + pid
pmx-canvas serve stop                                 # Stop the daemon for this port
```

## Nodes and edges

```bash
pmx-canvas node add --type webpage --url https://example.com/docs
pmx-canvas node add --type web-artifact --title "Dashboard" --app-file ./App.tsx
pmx-canvas node add --type graph --graph-type bar --data-file ./metrics.json --x-key label --y-key value
pmx-canvas node add --type graph --graph-type bar --data '[{"x":"a","y":1}]' --x-key x --y-key y
pmx-canvas graph add --graph-type bar --data '[{"x":"a","y":1}]' --x-key x --y-key y   # Alias
pmx-canvas html primitive add --kind choice-grid --data-file ./options.json --title "Options"
pmx-canvas html primitive schema --summary
pmx-canvas node add --help --type webpage --json                                        # Schema for one type

pmx-canvas external-app add --kind excalidraw --title "Diagram"

pmx-canvas edge add --from-search "DVT O3 — GitOps" --to-search "deep work trend" --type relation
```

`--from-search` / `--to-search` must each resolve to exactly one node — broad
queries fail rather than guess. Use the full visible title.

CLI create commands return the created node shape with normalized title,
content, and geometry, which makes scripting stacked layouts and batch
follow-ups easier.

### Graph height flags

Graph height flags split by target:

- `--node-height` / `--nodeHeight` — the canvas node frame
- `--chart-height` — the chart content inside the node
- `--height` — accepted as a frame-height compatibility alias

For MCP/HTTP payloads, use `nodeHeight` for the frame and `height` for chart
content.

## Discovery and validation

```bash
pmx-canvas node schema --type json-render --component Table --summary
pmx-canvas validate                                                      # Layout validation
pmx-canvas validate spec --type json-render --spec-file ./dashboard.json --summary
pmx-canvas validate spec --type html-primitive --kind choice-grid --data-json '{"items":[{"title":"A"}]}' --summary
```

The schema commands surface the running server's data, which is strictly
better than guessing flags or payloads.

## Batch and arrange

```bash
pmx-canvas batch --file ./canvas-ops.json
```

See [HTTP API → batch](http-api.md#batch-operations) for the operation
schema; the same JSON works for the CLI batch file.

## Web artifacts

```bash
pmx-canvas web-artifact build --title "Dashboard" --app-file ./App.tsx --deps recharts --include-logs
```

Failed or empty CLI bundles print `ok: false`, exit non-zero, and do not
create a canvas node.

## Watch (semantic deltas)

`pmx-canvas watch` consumes the SSE stream and emits compact semantic deltas
for agents that need low-token updates instead of full layout snapshots. It
filters noise from harmless moves and reports meaningful events such as pins,
node additions/removals, group changes, edge connections, and moves that
change spatial clustering.

```bash
pmx-canvas watch --events context-pin,move-end
pmx-canvas watch --json --events context-pin --max-events 1
```

## Focus

```bash
pmx-canvas focus <node-id>            # Pan viewport to a node
pmx-canvas focus <node-id> --no-pan   # Select/raise without panning
```

## WebView automation

Drive a headless Bun.WebView (Chromium or WebKit) pointed at the workbench:

```bash
pmx-canvas webview status
pmx-canvas webview start --backend chrome --width 1440 --height 900
pmx-canvas webview evaluate --expression "document.title"
pmx-canvas webview resize --width 1280 --height 800
pmx-canvas webview screenshot --output ./canvas.png
pmx-canvas webview stop
```

Use WebView for visual annotation inspection. Agent-readable canvas context only
reports annotation targets and bounds; it does not describe whether the human
drew an arrow, line, circle, or other shape. Inspect `.annotation-layer path` or
take a screenshot when the drawn form matters.

Humans draw with the pen toolbar button and remove marks with the eraser button.
If an agent already knows the annotation ID from context, it can remove it through
MCP with `canvas_remove_annotation`.

## When to reach for the CLI

- Direct terminal control without MCP wiring
- Shell scripts and CI-friendly automation
- Schema-driven discovery from the running server
- Local debugging of canvas, webview, and screenshot flows
- A control surface that covers normal canvas work without MCP wiring
