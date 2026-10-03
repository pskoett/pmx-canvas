# PMX Canvas agent plugin

`plugins/pmx-canvas/` is a self-contained [Agent Plugins 1.0](https://agent-plugins.org/)
package. It contains only PMX Canvas: the portable MCP server configuration and a native
canvas extension for the GitHub Copilot app. It does not include frame integrations,
general-purpose skills, or custom agents.

## Client support

| Client | Experience |
| --- | --- |
| GitHub Copilot app | PMX MCP tools and the native PMX Canvas side panel |
| Other Agent Plugins-compatible clients | PMX MCP tools; open the workbench in a browser or the client's browser surface |
| Clients without Agent Plugins support | Configure the MCP launcher manually using the client's MCP settings |

The native Copilot canvas is **not** a portable capability. Other clients ignore the
`com.github.copilot/` namespace. Supporting the package format also does not guarantee a
client has an embedded browser, canvas panel, or host-specific steering adapter.

## Install

The local package can be loaded without changing the user's installed plugins:

```bash
copilot --plugin-dir /absolute/path/to/pmx-canvas/plugins/pmx-canvas
```

Once the plugin directory is published in the GitHub repository, install it with:

```bash
copilot plugin install pskoett/pmx-canvas:plugins/pmx-canvas
```

In the Copilot app, enable the plugin and start a new project session. Open the **PMX Canvas**
canvas. Ask the agent to connect PMX to the active project; it calls `canvas_connect_workspace`
with the project's absolute directory before using board tools. Do not separately install its
project adapter or configure a second PMX MCP server.
An existing project adapter can coexist with the plugin canvas. If both declare `pmx-canvas`,
select the provider explicitly when opening: `plugin:pmx-canvas:pmx-canvas` for this plugin,
or `project:pmx-canvas` for the project extension. An unqualified open can be ambiguous.

Other clients should install the same plugin directory using their Agent Plugins support.
For a manual MCP setup, invoke `bun /absolute/path/to/plugin/start-mcp.mjs` from the intended
project directory. The launcher returns MCP JSON-RPC on stdout; diagnostics go to stderr.

## Connect the workspace

Agent Plugins launches MCP processes from the **plugin installation directory**, not the active
project. Installing or initializing this plugin therefore does not create a board or start a
daemon. Before any board operation, the agent calls:

```json
{
  "name": "canvas_connect_workspace",
  "arguments": { "workspaceRoot": "/absolute/path/to/project" }
}
```

The result contains `serverUrl` and `workbenchUrl`. Other harnesses can open `workbenchUrl`
in a browser. Copilot's native panel resolves the same workspace server.

Board tools are advertised from a generated catalog so clients with a fixed initial tool list
can discover them, but refuse execution until connected. Relative roots and the plugin
installation directory are rejected. A connected MCP session cannot silently switch projects;
start a new session for a different workspace.

Clients advertising exactly one standard MCP file root can connect automatically. An explicit
absolute `PMX_CANVAS_WORKSPACE_ROOT` in the MCP process environment also permits auto-connection.
Neither `process.cwd()` nor an inherited `PWD` is used to guess the project.

## Runtime and workspace ownership

[Bun](https://bun.sh/) must be installed and available on the host's `PATH`. No globally
installed `pmx-canvas` executable is required. The first workspace connection downloads the exact package
version in `runtime.json` using `bun x --bun pmx-canvas@<version>`; it therefore needs npm
access unless that version is already cached.

Both the native canvas and the MCP launcher use the same resolver. It discovers the
workspace's daemon port from `.pmx-canvas/daemon-<port>.pid` filenames, checks `/health`
ownership, and serializes concurrent startup with `.pmx-canvas/plugin-start.lock`.
The MCP subprocess receives the selected `PMX_CANVAS_URL` and an absolute workspace root.
A foreign server on the preferred port is never treated as this project's server. Each forwarded
MCP request rechecks ownership; a server replaced by another workspace is refused.

The adapter uses the session's **working directory**, not Copilot's session-state
`workspacePath` or the plugin installation directory. Boards remain in the project's
`.pmx-canvas/canvas.db`.

The daemon belongs to the workspace and stays running when one client closes, so closing
the native panel cannot break another MCP client. Stop it explicitly from the project:

```bash
bun x --bun pmx-canvas@<version> serve stop --port=<port>
```

Use the exact version from `runtime.json` and the port from the panel's `status` action.
`PMX_CANVAS_PORT` selects a preferred port; `PMX_CANVAS_URL` targets an existing server.
An explicit URL that fails ownership checks is reported rather than silently replaced.

## Package maintenance

The plugin's adapter copies are generated from `.github/extensions/pmx-canvas/`:

```bash
bun run build:plugin
bun test tests/unit/agent-plugin.test.js tests/unit/agent-plugin-mcp.test.ts tests/unit/copilot-runtime.test.js
```

The build bundles the MCP bootstrap with the existing SDK, generates its initial tool catalog
through the real MCP `tools/list` API, and copies the canonical adapter and shared resolver into
the plugin boundary. It pins their runtime to `package.json`'s version. No plugin code
imports files outside the installed package. `bun run build` also regenerates the plugin,
and drift tests byte-compare the distributed files against their canonical sources.

The portable root contains `plugin.json`, `mcp.json`, `start-mcp.mjs`, `tools.json`, `runtime.mjs`,
`runtime.json`, and license notices for the bundled dependencies. Copilot auto-discovers the native adapter at
`com.github.copilot/extensions/pmx-canvas/extension.mjs`.

The marketplace preview is copied from `docs/screenshot.png` to `assets/preview.png` on each
plugin build. The manifest's `extensions.com.github.copilot.logo` points to that packaged PNG.

Publishing a repository package does not register it in a curated marketplace or make it
Featured in the Copilot app. Those are separate submission and review steps.
