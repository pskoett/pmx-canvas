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
- Reads `canvas://ax-context` or `canvas_ax_state { action: "get" }` for pinned and focused context.
- Sets AX focus through `canvas_ax_state { action: "set-focus" }` with `source: "codex"` when the
  focus change comes from Codex-hosted steering.
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

1. Open `/workbench` in the Codex in-app Browser as the first visible action. If PMX is not running
   yet, start/connect the MCP server first only long enough to get the workbench URL, then open the
   browser before mutating the board.
2. Start or keep using the PMX MCP server for agent operations.
3. Use the browser canvas for human spatial curation: pin nodes, move nodes, group nodes, and
   inspect rendered artifacts.
4. Use MCP tools for agent operations: create/update nodes, pin nodes, read layout, and read AX
   context.
5. When Codex wants to mark the current attention target, call
   `canvas_ax_state { action: "set-focus", … }` with:

```json
{
  "nodeIds": ["node-123"],
  "source": "codex"
}
```

## Context Contract

Codex agents should treat PMX AX context as host-native working context:

- `canvas://pinned-context` is the explicit human-curated node set.
- `canvas://ax-context` combines pins, focus, and surface metadata, plus a compact
  loop-safe `delivery: { pendingSteering, pendingActivity }` lead block
  (`GET /api/canvas/ax/context?consumer=codex` filters out Codex-originated items).
- `canvas_ax_state { action: "get" }` returns both persisted AX state and agent-ready context.
- Focus is a current attention target, not a command to ignore the rest of the repository.

The adapterless MCP+Browser path is poll-based: there is no automatic prompt injection,
so a board click does not wake the current turn. Codex agents poll
`canvas_ax_delivery { action: "claim" }` (steering + `pendingActivity`) and act/ack explicitly. The
loop-closing surfaces work over MCP today even without a dedicated extension:

- **Self-report work** with `canvas_ingest_activity` (the board auto-reacts: a failed
  tool → a blocked work item + review + evidence). Automatic forwarding of Codex's own
  tool hooks would need a Codex adapter; manual ingestion works now.
- **Block on a decision** with `canvas_ax_gate { kind, action: "await", id }` (it long-polls PMX
  until the human resolves the gate in the Browser or the timeout elapses) instead of looping on
  `canvas_ax_state { action: "get" }`.

## Live-Test Checklist

1. Open `http://127.0.0.1:4313/workbench` in the Codex in-app Browser first so the user can see
   all later canvas mutations.
2. Confirm the PMX MCP server is configured for the workspace.
3. Call `canvas_ax_state { action: "get" }` and confirm it returns `ok: true`.
4. Add or reuse a node, then pin it from the browser or with `canvas_pin_nodes`.
5. Read `canvas://ax-context` and confirm the pinned node appears.
6. Call `canvas_ax_state { action: "set-focus", source: "codex" }` with a real node ID.
7. Read `canvas_ax_state { action: "get" }` again and confirm `state.focus.source` is `codex`.
8. Refresh the browser and confirm the workbench still shows the same state.

## Adapter Boundary

Do not add Codex-specific APIs to PMX Canvas core. Core owns neutral AX primitives; Codex maps them
through MCP and the in-app Browser. If Codex later exposes a dedicated extension or prompt-injection
hook, implement that as a separate adapter layer that reads the same `/api/canvas/ax/context` or
`canvas://ax-context` contract.
