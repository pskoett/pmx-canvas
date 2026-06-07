# Node types

Canvas nodes are typed. Each type has a dedicated renderer, schema, and (for
structured types) a dedicated MCP tool. This page is the user-facing reference
for what each type is for and how to create one. For tool/HTTP/SDK signatures,
see [MCP tools](mcp.md), [HTTP API](http-api.md), and [SDK](sdk.md).

## Overview

| Type | Purpose |
|------|---------|
| `markdown` | Rich markdown with rendered preview |
| `status` | Compact status indicator (phase, message, elapsed time) |
| `context` | Context cards, token usage, workspace grounding |
| `ledger` | Execution ledger summary |
| `trace` | Agent trace pills (tool calls, subagent activity) |
| `file` | Live file viewer with auto-update on disk changes |
| `image` | Image viewer (file paths, data URIs, URLs) |
| `webpage` | Persisted webpage snapshot with stored URL, extracted text, refresh |
| `mcp-app` | Tool-backed hosted MCP App iframes (Excalidraw, etc.) |
| `json-render` | Structured UI from JSON specs (cards, tables, forms) |
| `graph` | Charts (line, bar, pie, area, scatter, radar, stacked-bar, composed, plus Tufte primitives: sparkline, dot-plot, bullet, slopegraph) |
| `html` | Self-contained HTML/JS in a sandboxed iframe |
| `web-artifact` | Bundled React/Tailwind artifact (full single-file app) |
| `group` | Spatial container/frame around other nodes |

Thread node types `prompt` and `response` exist internally for agent
conversation rendering and are not created through public APIs.

## Choosing the right visual tier

Three rendering tiers cover increasing levels of complexity. Pick the lowest
that fits the work — each step adds capability and bundle weight.

| Tier | Type | Use when | Bundle weight |
|------|------|----------|---------------|
| 1 | `json-render` | You can describe the UI as a spec (forms, tables, dashboards from a component catalog) | None — runtime already loaded |
| 2 | `html` | You have/can write self-contained HTML+JS (Chart.js, D3, custom widgets, interactive demos) | None — sandboxed iframe |
| 3 | `web-artifact` | You need a full React/Tailwind app with shadcn components, routing, or shared state | Build step |

## File nodes

File nodes display project files with line numbers and language detection.
When an agent edits a file through its normal tools, the canvas node updates
automatically via `fs.watch()`.

```ts
canvas_add_node({ type: 'file', content: 'src/server/index.ts' })
```

## Image nodes

Image nodes display local paths, remote URLs, and data URIs. File-backed and
HTTP(S)-backed images preserve provenance so agents can tell where evidence
came from. Nodes can carry validation status or warnings.

```ts
canvas_add_node({
  type: 'image',
  content: 'artifacts/dashboard.png',
  data: {
    validationStatus: 'passed',
    validationMessage: 'Screenshot matches the requested dashboard state.',
  },
})
```

## Webpage nodes

Webpage nodes store the source URL on the node, fetch the page server-side,
and cache extracted text for search, pins, and agent context. Saved canvases
keep enough information for an agent to refresh the node from the original
URL later.

```ts
canvas_add_node({ type: 'webpage', url: 'https://example.com/docs' })
canvas_refresh_webpage_node({ id: 'node-abc123' })
```

## MCP App nodes

`mcp-app` nodes embed other MCP servers' UI resources (`ui://...`) directly
on the canvas as sandboxed iframes. Any server implementing the
[MCP Apps extension](https://modelcontextprotocol.io/docs/extensions/apps)
can be opened with `canvas_open_mcp_app`.

Generic `pmx-canvas node add --type mcp-app` is intentionally rejected —
these nodes need tool/session metadata. Use `canvas_open_mcp_app` (or the
`canvas_add_diagram` Excalidraw preset) instead.

### Excalidraw preset (hand-drawn diagrams)

[Excalidraw](https://github.com/excalidraw/excalidraw-mcp) ships a hosted MCP
server at `https://mcp.excalidraw.com/mcp`. PMX Canvas exposes a one-call
preset:

```ts
canvas_add_diagram({
  elements: [
    { type: 'rectangle', id: 'a', x: 80, y: 120, width: 180, height: 80,
      roundness: { type: 3 }, backgroundColor: '#a5d8ff', fillStyle: 'solid',
      label: { text: 'Agent', fontSize: 18 } },
    { type: 'rectangle', id: 'b', x: 380, y: 120, width: 180, height: 80,
      roundness: { type: 3 }, backgroundColor: '#d0bfff', fillStyle: 'solid',
      label: { text: 'PMX Canvas', fontSize: 18 } },
    { type: 'arrow', id: 'a1', x: 260, y: 160, width: 120, height: 0,
      startBinding: { elementId: 'a' }, endBinding: { elementId: 'b' },
      label: { text: 'adds nodes' } },
  ],
  title: 'Agent → Canvas',
});
```

For any other MCP App, call `canvas_open_mcp_app` directly with the server's
transport, tool name, and arguments.

## json-render nodes

`json-render` nodes turn structured JSON specs into rendered UI panels
(dashboards, tables, forms, cards) without writing HTML. PMX Canvas ships the
[`@json-render/*`](https://www.npmjs.com/package/@json-render/core) runtime
and component catalog (core + react + shadcn).

```ts
canvas_add_json_render_node({
  title: 'Deploy status',
  spec: {
    root: 'card',
    elements: {
      card: { type: 'Card', props: { title: 'Deploy' }, children: ['status'] },
      status: { type: 'Badge', props: { variant: 'default', text: 'Healthy' } },
    },
  },
});
```

`Badge` uses shadcn variants: `default`, `secondary`, `destructive`,
`outline`. Older saved specs using `label` or status variants such as
`success`/`warning` are normalized during validation.

Elements may carry an `on` map (`on.press`, `on.change`, …) binding events to
actions (`{ action, params }`) — built-in actions (`setState`, `pushState`, …) or
host-provided handlers. PMX wires AX handlers named after interaction types, so a
spec action named `ax.*` becomes a capability-gated AX interaction:

```ts
canvas_add_json_render_node({
  title: 'Approve plan',
  spec: {
    root: 'btn',
    elements: {
      btn: {
        type: 'Button',
        props: { label: 'Track as work', variant: 'primary' },
        on: { press: { action: 'ax.work.create', params: { title: 'Ship the plan' } } },
      },
    },
  },
});
```

The viewer forwards the emit to the parent canvas, which validates it (iframe
source + per-viewer nonce + node id) and submits it server-side; `json-render` /
`graph` viewers are sandboxed surfaces, so caller-supplied `nodeIds` are clamped
to the node's own id. See the [MCP reference](mcp.md#node-interactions-capability-gated).

Use `canvas_describe_schema` / `canvas_validate_spec` to introspect the
component catalog before building a spec.

## HTML nodes

`html` nodes render a normal self-contained HTML/JS document in a sandboxed iframe.
They sit between `json-render` (no custom JS) and `web-artifact` (full bundled
React app) — perfect for Chart.js, D3, custom widgets, and any HTML you can
write or paste.

The sandbox runs with `allow-scripts` only — no same-origin access, no
top-level navigation, no form submission. Inline `<script>` and CDN
`<script src>` both work. The canvas auto-injects its theme tokens
(`--c-*` and `--color-*` aliases) into the iframe `<head>` so artifacts can
match the active theme. Theme updates are posted into sandboxed HTML iframes,
so theme-aware HTML can follow dark/light switches without reopening the node.

```ts
canvas_add_html_node({
  title: 'Cost projection',
  html: '<canvas id="c"></canvas><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><script>...</script>',
})
```

A fragment without `<html>`/`<head>` is wrapped in a full document
automatically. Default size is 720×640.

Presentation mode is opt-in. Raw HTML nodes do not show the browser `Present`
button unless callers set `presentation: true`; prefer the `presentation`
primitive when the user explicitly asks for a PowerPoint-like deck, pitch,
briefing, workshop walkthrough, or fullscreen story.

HTML nodes also store an agent-readable semantic sidecar. Callers can pass
`summary`, `agentSummary`, `embeddedNodeIds`, or `embeddedUrls`; when no summary
is provided, PMX derives `data.contentSummary` from visible HTML text and stores
`data.agentSummary` for search, pinned context, and spatial context. Scripts and
styles are ignored during extraction.

### HTML primitives

`html-primitive` is a virtual schema type that creates a normal sandboxed
`html` node from a reusable communication template. Use it when a long markdown
answer would be easier to review as an option grid, implementation timeline,
review sheet, PR writeup, code walkthrough, system map, design sheet,
component gallery, interaction prototype, flowchart, SVG illustration set,
presentation, explainer, status report, incident report, triage board, config
editor, or prompt tuner.

```ts
canvas_add_html_primitive({
  kind: 'choice-grid',
  title: 'Implementation options',
  data: {
    items: [
      { title: 'Small patch', summary: 'Least disruption.', pros: ['Fast'], cons: ['Less flexible'] },
    ],
  },
});
```

HTTP callers may post either `{ "type": "html-primitive", "kind": "choice-grid", "data": ... }`
or `{ "type": "html", "primitive": "choice-grid", "data": ... }`. The stored
node remains `type: "html"` with `data.htmlPrimitive`, `data.primitiveData`, and
the generated `data.html` payload. Generated primitives also get an
agent-readable summary sidecar.

Only presentation-marked HTML nodes expose a `Present` button in the browser.
Use the `presentation` primitive for PowerPoint-like decks; it persists
`presentation`, `slideCount`, `slideTitles`, optional `speakerNotes`, and
optional `presentationTheme` metadata while the iframe handles
Arrow/Space/Page Up/Page Down slide navigation. Presentation data supports
`theme: "canvas" | "midnight" | "paper" | "aurora"` or a custom color object with
`bg`, `panel`, `surface`, `border`, `text`, `textSecondary`, `textMuted`,
`accent`, and `colorScheme`.

## Web artifacts

A **web artifact** is a single-file, fully bundled HTML app (React + Tailwind
+ shadcn) the agent builds from TSX source. Use it when the work calls for a
real interactive app — charts, forms, mini-dashboards — beyond what a static
node or `html` snippet can express.

`canvas_build_web_artifact` takes source strings (`App.tsx`, optional
`index.css`, `main.tsx`, `index.html`, plus extra files), runs the bundled
web-artifacts-builder scripts, writes the self-contained HTML to
`.pmx-canvas/artifacts/<slug>.html`, and (by default) opens it in the canvas.

```bash
pmx-canvas web-artifact build --title "Dashboard" --app-file ./App.tsx --deps recharts --include-logs
```

The scaffold includes `recharts`. Pass `--deps name,name2` for additional
package dependencies. Failed or empty CLI bundles print `ok: false`, exit
non-zero, and do not create a canvas node.

The matching agent skill is at
[`skills/web-artifacts-builder/SKILL.md`](../skills/web-artifacts-builder/SKILL.md).

## Groups

Groups are spatial containers that visually contain other nodes. They render
as dashed-border frames with a title bar and optional accent color.

- Select 2+ nodes and click "Group" in the selection bar
- Right-click a group to ungroup
- Collapsing a group hides children and shows a summary
- By default, group creation preserves the children's current positions and
  expands the frame around them
- Pass `childLayout` to auto-pack children (`grid`, `column`, `flow`)
- Pass explicit `x`, `y`, `width`, and `height` to create a manual frame and
  lay children out inside it

```ts
canvas_create_group({ title: 'Auth Module', childIds: ['node-1', 'node-2'], color: '#4a9eff' })
```

## Edge types

All edges support labels, styles (solid/dashed/dotted), and animation.

| Type | Use case |
|------|----------|
| `flow` | Sequential steps, data flow |
| `depends-on` | Dependencies between tasks |
| `relation` | General relationships |
| `references` | Cross-references, evidence links |

## Schema-driven discovery

Agents don't have to guess node shapes. The running server exposes its create
schemas, json-render component catalog, and node-type examples:

- `canvas_describe_schema` / `GET /api/canvas/schema` — list all node-create
  schemas, required fields, json-render components, HTML primitives, and sample payloads
- `canvas_validate_spec` / `POST /api/canvas/schema/validate` — validate a
  json-render spec, graph payload, or HTML primitive payload **without** creating a node
- `canvas_validate` / `GET /api/canvas/validate` — validate the current
  layout for collisions, containment, and missing edge endpoints
- `canvas://schema` — the same data as an MCP resource

The CLI's `node schema` / `validate spec` subcommands surface the same data
from the terminal.

MCP node creation uses dedicated tools for structured node families. Read
`mcp.nodeTypeRouting` from `canvas_describe_schema` when in doubt:
`json-render` → `canvas_add_json_render_node`,
`graph` → `canvas_add_graph_node`,
`html-primitive` → `canvas_add_html_primitive`,
`html` → `canvas_add_html_node`,
`web-artifact` → `canvas_build_web_artifact`,
`mcp-app` → `canvas_open_mcp_app`,
`group` → `canvas_create_group`.
Basic nodes (`markdown`, `status`, `file`, `image`, `webpage`) use
`canvas_add_node`.
