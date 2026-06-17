# GitHub Copilot App Adapter

Use this reference when PMX Canvas is running inside the GitHub Copilot app as a project canvas
extension. The adapter is intentionally thin: PMX Canvas remains the state owner, and the extension
maps Copilot SDK features onto PMX AX primitives.

## Adapter Identity

- Extension path: `.github/extensions/pmx-canvas/extension.mjs`
- Extension ID: `project:pmx-canvas`
- Canvas ID: `pmx-canvas`
- Display name: `PMX Canvas`

## Quick Start

1. Install the project adapter by copying the packaged extension into the repository:
   `mkdir -p .github/extensions/pmx-canvas && cp node_modules/pmx-canvas/.github/extensions/pmx-canvas/extension.mjs .github/extensions/pmx-canvas/extension.mjs`
2. Reload Copilot app extensions with `extensions_reload` so `project:pmx-canvas` is registered.
3. Start or confirm a PMX Canvas daemon for the workspace: `pmx-canvas serve --daemon`
   and `pmx-canvas serve status`. The adapter can auto-start in many local sessions, but a running
   daemon is the most reliable setup for fresh agents.
4. Open the canvas with `extensionId: "project:pmx-canvas"`, `canvasId: "pmx-canvas"`, and a stable
   `instanceId`.
5. If the first `invoke_canvas_action` immediately after `open_canvas` returns
   `Canvas instance not open`, retry the same action once. This is a known Copilot app timing race
   during panel initialization, not a PMX server failure.

Open it with:

```json
{
  "extensionId": "project:pmx-canvas",
  "canvasId": "pmx-canvas",
  "instanceId": "pmx-canvas"
}
```

Use a different `instanceId` for parallel panels. Reusing an `instanceId` focuses/reloads the same
panel.

## What the Adapter Does

- Opens the live PMX workbench directly in a native Copilot canvas panel.
- Uses PMX-served same-origin frame documents for iframe-backed nodes (`html` and hosted MCP apps).
  The Copilot app webview can leave nested `srcdoc` and `blob:` iframes blank, so PMX should route
  generated frame HTML through `/api/canvas/frame-documents/...` instead.
- Connects to a matching local PMX server for the current workspace, or starts one when needed.
- Reads `/api/canvas/ax/context` and injects pinned/focused context from
  `onUserPromptSubmitted`.
- Exposes adapter actions for status, AX context refresh, AX focus, and explicit session steering.

### Agent behavior — steering is gated, not pushed

`onUserPromptSubmitted` injects the whole `/api/canvas/ax/context` (pins, focus, work
items, approval gates, and the compact `delivery` lead block) as hidden context — but
only when the **pin/focus gate is open** (`pinned.count > 0 || focus.nodeIds.length > 0`),
and it is clipped to a char budget. Read steering from **`delivery.pendingSteering`**
(the compact, count-bearing block — newest-first, capped at 10), not the full
`timeline.pendingSteering`. Three consequences the adapter/agent must honor:

1. A steering board must **stay pinned** (or its button must also emit `ax.focus.set`
   on the board node) to hold the gate open.
2. A sandbox button click does **not** wake a turn — a human message does. The click
   only enqueues the steer.
3. The agent must **act on injected `delivery.pendingSteering` / `pendingActivity` and
   then ack** (`canvas_ax_delivery { action: "mark" }`), or it re-injects every gated turn.

To be robust to the char clip, prefer injecting that compact loop-safe lead block from
`GET /api/canvas/ax/context?consumer=copilot` (`delivery.pendingSteering` +
`delivery.totalPending` / `delivery.omittedPending` + `delivery.pendingActivity`)
**above** the full dump. When `omittedPending > 0`, drain the full FIFO backlog from
`canvas_ax_delivery { action: "claim", consumer: "copilot" }` (oldest-first).

#### Waking the agent from a canvas steer (#59) — adapter-owned

Recording a browser-origin `ax.steer` does **not** wake the active session by itself
(report #59); PMX only queues it (the `ok:true` emit ack = "recorded", not "delivered").
To make a canvas **Steer** button actually create a visible turn, the adapter must, on
its own cadence (e.g. an SSE subscription or poll), **drain**
`canvas_ax_delivery { action: "claim", consumer: "copilot" }`, call the host's native
send (`copilotSession.send` / the working `send_instruction` path) with each steer, then
`canvas_ax_delivery { action: "mark" }` it (loop-safe). This wake is intentionally
host-owned — PMX never imports the host SDK. Until the adapter wires it, a steering
button must be labeled "queued for the agent's next turn", not "steer now".

### Closing the loop (optional, recommended)

- **Forward tool/session hooks** (`onPreToolUse` / `onPostToolUse` /
  `onPostToolUseFailure` / `onSessionStart` / `onSessionEnd` / `onErrorOccurred`) to
  `POST /api/canvas/ax/activity` (`canvas_ingest_activity`) so the board reflects the
  agent's real work automatically (a failed tool → a blocked work item + review +
  evidence).
- **Await gates** with `canvas_ax_gate { kind, action: "await", id }` (or surface a native modal
  and await the PMX result) so an approval gate actually blocks the agent until the human resolves it.

See [`docs/ax-host-adapter-contract.md`](../../../docs/ax-host-adapter-contract.md).
- Keeps all persistent PMX state in `.pmx-canvas/canvas.db`; the extension does not own canvas
  state.

## Open Input

All fields are optional:

```json
{
  "serverUrl": "http://127.0.0.1:4313",
  "port": 4313,
  "autoStart": true,
  "allowWorkspaceMismatch": false,
  "workspaceRoot": "/path/to/repo"
}
```

Default discovery order:

1. `serverUrl` input.
2. `PMX_CANVAS_URL`.
3. `PMX_CANVAS_PORT` / `PMX_WEB_CANVAS_PORT` / `4313` on loopback.
4. Managed server startup for the current workspace when `autoStart` is not `false`.

The adapter rejects an unrelated running PMX server unless `serverUrl` is explicit or
`allowWorkspaceMismatch` is true.

## Actions

| Action | Purpose |
|---|---|
| `status` | Return PMX server health and persisted AX state. |
| `get_ax_context` | Return current pinned + focused AX context. |
| `focus_nodes` | Set AX focus with `source: "copilot"`. |
| `send_instruction` | Send an explicit prompt into the active Copilot session. |
| `add_work_item` | Create a canvas-bound AX work item. |
| `request_approval` | Open an approval gate (`pending`) before a high-impact action. |
| `resolve_approval` | Resolve an approval gate as approved/rejected. |
| `add_review_annotation` | Record a review comment/finding anchored to a node/file/region. |
| `get_timeline` | Read the bounded AX timeline (events, evidence, steering). |
| `report_capability` | Report host capabilities for diagnostics. |

Example focus action:

```json
{
  "nodeIds": ["node-123"]
}
```

Use `nodeIds: []` to clear adapter-set AX focus after a live test.

## Live-Test Checklist

After changing the adapter:

1. Reload extensions.
2. Inspect `pmx-canvas` and confirm status is `running`.
3. Call `list_canvas_capabilities` for `extensionId: "project:pmx-canvas"` and
   `canvasId: "pmx-canvas"`.
4. Open the canvas with a stable `instanceId`.
5. Invoke `status`.
6. Invoke `get_ax_context`.
7. If at least one node exists, invoke `focus_nodes` for one node ID and confirm
   `get_ax_context.focus.nodeIds` includes it.
8. Clear the focus with `focus_nodes` and `nodeIds: []`.
9. Add or reuse one `html` node and one hosted MCP app node and confirm both render visibly in the
   native PMX panel, not only in an external browser.
10. Inspect the extension log tail and confirm there are no runtime errors.

## Agent Behavior

When this adapter is loaded, the next user prompt may include hidden AX context generated from PMX
pins and focus. Treat pinned nodes and focused nodes as human-selected working context, not as a
global instruction to ignore the rest of the repository.

For non-Copilot agents, use the same core primitives directly:

- HTTP: `/api/canvas/ax`, `/api/canvas/ax/context`, `/api/canvas/ax/focus`
- MCP: `canvas://ax`, `canvas://ax-context`, `canvas_ax_state { action: "get" }`, `canvas_ax_state { action: "set-focus" }`
- CLI: `pmx-canvas ax status|context|focus`
