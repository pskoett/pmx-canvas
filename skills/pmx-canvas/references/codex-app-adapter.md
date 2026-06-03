# Codex App Adapter

Use this reference when PMX Canvas is running natively in the Codex app. The adapter is intentionally
thin: PMX Canvas remains the state owner, Codex uses MCP for agent operations/context, and the Codex
in-app Browser renders the live PMX workbench.

## Adapter Identity

- Host: Codex app
- Visual surface: Codex in-app Browser opened to the PMX `/workbench` URL
- Agent surface: PMX Canvas MCP server (`pmx-canvas --mcp`)
- Fallback surface: PMX Canvas CLI for manual scripts when MCP is unavailable
- AX source label: `codex`

This is not a separate PMX renderer and does not require a Codex extension API. Codex already has
the two native surfaces PMX needs: MCP resources/tools for the agent, and the in-app Browser for the
human-visible canvas. Prefer MCP over the CLI for Codex-native use because MCP exposes structured
tools, resources, and `canvas://ax-context`; use the CLI only as a fallback or for shell scripts.

## What The Adapter Does

- Opens the live PMX workbench in the Codex in-app Browser.
- Uses MCP tools/resources for all agent-side operations.
- Reads `canvas://ax-context` or `canvas_get_ax` for pinned and focused context.
- Sets AX focus through `canvas_set_ax_focus` with `source: "codex"` when the focus change comes
  from Codex-hosted steering.
- Keeps all persistent PMX state in `.pmx-canvas/canvas.db`; Codex does not own canvas state.

## Setup

Use MCP as the primary Codex adapter path.

Add the PMX MCP server to the Codex workspace config:

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

For local repo development, use the source entrypoint instead:

```json
{
  "mcpServers": {
    "canvas": {
      "command": "bun",
      "args": ["run", "src/mcp/server.ts"]
    }
  }
}
```

The MCP server auto-starts the HTTP workbench on first tool call. Open the returned workbench URL
in the Codex in-app Browser, usually `http://127.0.0.1:4313/workbench` or
`http://localhost:4313/workbench`.

## Codex-Native Workflow

1. Start or connect to the PMX MCP server.
2. Open `/workbench` in the Codex in-app Browser.
3. Use the browser canvas for human spatial curation: pin nodes, move nodes, group nodes, and
   inspect rendered artifacts.
4. Use MCP tools for agent operations: create/update nodes, pin nodes, read layout, and read AX
   context.
5. When Codex wants to mark the current attention target, call:

```json
{
  "nodeIds": ["node-123"],
  "source": "codex"
}
```

against `canvas_set_ax_focus`.

## Context Contract

Codex agents should treat PMX AX context as host-native working context:

- `canvas://pinned-context` is the explicit human-curated node set.
- `canvas://ax-context` combines pins, focus, and surface metadata.
- `canvas_get_ax` returns both persisted AX state and agent-ready context.
- Focus is a current attention target, not a command to ignore the rest of the repository.

## Live-Test Checklist

1. Confirm the PMX MCP server is configured for the workspace.
2. Call `canvas_get_ax` and confirm it returns `ok: true`.
3. Open `http://127.0.0.1:4313/workbench` in the Codex in-app Browser.
4. Add or reuse a node, then pin it from the browser or with `canvas_pin_nodes`.
5. Read `canvas://ax-context` and confirm the pinned node appears.
6. Call `canvas_set_ax_focus` with `source: "codex"` and a real node ID.
7. Read `canvas_get_ax` again and confirm `state.focus.source` is `codex`.
8. Refresh the browser and confirm the workbench still shows the same state.

## Adapter Boundary

Do not add Codex-specific APIs to PMX Canvas core. Core owns neutral AX primitives; Codex maps them
through MCP and the in-app Browser. If Codex later exposes a dedicated extension or prompt-injection
hook, implement that as a separate adapter layer that reads the same `/api/canvas/ax/context` or
`canvas://ax-context` contract.
