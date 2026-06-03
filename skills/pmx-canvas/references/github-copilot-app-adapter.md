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
- MCP: `canvas://ax`, `canvas://ax-context`, `canvas_get_ax`, `canvas_set_ax_focus`
- CLI: `pmx-canvas ax status|context|focus`
