# Environment variables

Every `PMX_*` variable the server, CLI, MCP transport, and build read. All are
optional; defaults are listed.

## Ports and workspace targeting

| Variable | Read by | Effect |
|---|---|---|
| `PMX_WEB_CANVAS_PORT` | server, CLI `serve` | Preferred server port (default `4313`). CLI `--port` wins over it. |
| `PMX_CANVAS_PORT` | all entry points | Client-side target port for CLI commands and the `--mcp` lookup; as of 0.4.0 the server also falls back to it when `--port`/`PMX_WEB_CANVAS_PORT` are unset, so one var can drive the whole stack. |
| `PMX_CANVAS_URL` | agent CLI, MCP transport | Full base URL target (wins over `PMX_CANVAS_PORT`). |
| `PMX_CANVAS_WORKSPACE_ROOT` | server, MCP transport | Pins the workspace root for daemon binds and the MCP same-workspace lookup, overriding the launch cwd. Set it when a host spawns `--mcp` from an incidental dir. |
| `PMX_CANVAS_ALLOW_WORKSPACE_SPLIT` | MCP transport | `1` forces a separate canvas instead of attaching to a different-workspace daemon on the preferred port. |

## Persistence

| Variable | Read by | Effect |
|---|---|---|
| `PMX_CANVAS_DB_PATH` | server | Overrides the SQLite path (default `.pmx-canvas/canvas.db`). |
| `PMX_CANVAS_STATE_FILE` | server | `.db`-path alias only as of 0.4.0 (non-`.db` values are ignored with a boot warning; the pre-0.2 JSON import was removed). |
| `PMX_CANVAS_BLOB_THRESHOLD_BYTES` | server | Node payloads above this many JSON bytes are stored as blobs (default `2048`). |

## Server behavior

| Variable | Read by | Effect |
|---|---|---|
| `PMX_CANVAS_THEME` | server | Startup theme: `dark` (default), `light`, `high-contrast`, `midnight`, `sepia`, `arctic`, `ember`, `forest`, `volt`. |
| `AMP_ORB` | server | Set by Amp orb services. When present, the served canvas page tells the browser it is running in an orb, which skips the iframe embed probe, forces `srcdoc` surface rendering when embedded (the orb portal blocks `src`-URL child iframes and the probe is unreliable there), and defaults the event transport to polling instead of SSE (the portal proxy buffers streams; `?transport=sse` overrides for diagnosis). |
| `PORT` | server | Portal-assigned service port, honored ONLY when `AMP_ORB` is also set (Amp orbs) — after `--port`, `PMX_WEB_CANVAS_PORT`, and `PMX_CANVAS_PORT`, before the 4313 default. A stray `PORT` in normal shells never changes the port. |
| `PMX_CANVAS_DISABLE_BROWSER_OPEN` | server | `1` suppresses auto-opening the browser (used by tests/CI). |
| `PMX_CANVAS_AUTO_INTENT` | server | `0` turns off the auto-ghost: agent mutations that arrive without an explicit `canvas_intent` signal stop synthesizing a short ghost cursor. Any other value (or unset) leaves it on. |
| `PMX_CANVAS_DIST` | server | Explicit client bundle directory to serve instead of the packaged `dist/canvas`. |
| `PMX_CANVAS_WEBVIEW_TIMEOUT_MS` | server | Startup timeout for the Bun.WebView automation session. |

## MCP app host (security-relevant)

| Variable | Read by | Effect |
|---|---|---|
| `PMX_MCP_APP_HOST_MODE` | server | Gates which hosted MCP app servers may be opened. |
| `PMX_MCP_APP_HOST_ALLOWLIST` | server | Additional allowed MCP app server origins. |
| `PMX_MCP_APP_HOST_STATE_FILE` | server | Overrides the app-host session state file. |

## Build and diagnostics

| Variable | Read by | Effect |
|---|---|---|
| `PMX_CANVAS_JSON_RENDER_DEVTOOLS` | server | `1` (plus `?devtools=1` on the viewer URL) enables the json-render devtools overlay. |
| `PMX_CANVAS_FORCE_JSON_RENDER_REBUILD` | json-render build | `1` forces the viewer bundle rebuild even when outputs exist. |
| `PMX_CANVAS_EXCALIDRAW_MCP_COMMAND` | server (tests) | Stdio command replacing the hosted Excalidraw MCP server for the diagram preset, e.g. `bun run tests/fixtures/mcp-app-fixture.ts`. |
| `PMX_SESSION_LOG` / `PMX_TEST_LOG` | server | Path for MCP-app host session diagnostics logging (session wins over test). |
