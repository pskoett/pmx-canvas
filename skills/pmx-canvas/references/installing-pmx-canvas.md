# Installing PMX Canvas

Use this reference when the `pmx-canvas` skill is installed but the `pmx-canvas` command is not available yet.

## Prerequisites and version

The examples pin **PMX Canvas 0.8.0**, which requires **Bun >=1.4.2** even when
installed through npm: the CLI runs through Bun, not Node. Check `bun --version`
first. If missing or older, follow the [Bun installation instructions](https://bun.sh/docs/installation)
with the user's authorization. Ensure Bun is on the MCP host's PATH as well as the
interactive shell's; use an absolute `bun`/`bunx` executable path if needed.

Install/configure only when requested. After an intentional runtime upgrade, sync the
skill from that installed package and restart existing server/MCP processes as described
in `SKILL.md`. Do not pair newer checkout guidance with an older runtime unknowingly.

## Install from npm

```bash
npm install -g pmx-canvas@0.8.0
pmx-canvas --version
```

Without a global install, use `bunx pmx-canvas@0.8.0` in place of `pmx-canvas` in
the commands below. Do not use unpinned `bunx pmx-canvas` for a version-specific check.

## Choose the workspace and target

Select an existing absolute root and a dedicated free port. These shell examples use
POSIX syntax; supply equivalent environment variables on other platforms.

```bash
export PMX_CANVAS_WORKSPACE_ROOT=/absolute/path/to/project
export PMX_CANVAS_PORT=14313 # Example only: choose a free port for this workspace.
unset PMX_CANVAS_URL # A stale URL overrides the environment's CLI port target.
```

Use **both root and port**. Root pinning alone does not align the CLI, MCP, and browser
if a server falls back to another port. Without an explicit root, MCP may attach to a
different workspace on the preferred port. `PMX_CANVAS_ALLOW_WORKSPACE_SPLIT=1` opts
out of that heuristic but is not a substitute for checking the actual target.

For server startup, precedence is `--port`, then `PMX_WEB_CANVAS_PORT`, then
`PMX_CANVAS_PORT` (then `PORT` in Amp orbs), then the default 4313. For CLI queries and
mutations, explicit `--server-url`/`--port` override environment targeting; otherwise
`PMX_CANVAS_URL` wins over `PMX_CANVAS_PORT`. URL targeting does not set the bind port.

## Start the server

On an ordinary local machine:

```bash
pmx-canvas serve --daemon --no-open --port="$PMX_CANVAS_PORT" --wait-ms=20000
```

In a managed environment, use the host's supervised-service mechanism with foreground
`pmx-canvas serve --no-open --port=<chosen-port>`, passing the selected environment.
Do not daemonize inside a supervisor or rely on `nohup`, background shell jobs, or tmux
to survive an orb restart. In an Amp orb, prefer declared services with
`amp orb services ensure`; otherwise use `amp orb service start` with the foreground
command. Use the host's authenticated portal/preview for remote viewing, not a raw
loopback URL. Verify health below before opening the workbench or making writes.

CLI query/mutation commands do not auto-start a server; `serve` or `--mcp` does.

## From a local checkout (development)

```bash
git clone https://github.com/pskoett/pmx-canvas.git
cd pmx-canvas
bun install
bun run build
bun run src/cli/index.ts --version
```

This uses the checked-out source, not necessarily the published package. Follow
that checkout's `package.json` Bun requirement and bundled skill. Set the same root/port
environment above; substitute `bun run /absolute/path/to/pmx-canvas/src/cli/index.ts`
for `pmx-canvas` in startup and verification commands. The target workspace can be
different from the source checkout. Build the client before browser verification.

## MCP Config

For agents that support MCP, configure the pinned package as a stdio server. Replace
the root and port with your selections; ensure the port is dedicated to this workspace.
The empty URL overrides a stale inherited value (empty is treated as unset). If the host
discards empty env values, remove `PMX_CANVAS_URL` from its launch environment instead.

```json
{
  "mcpServers": {
    "canvas": {
      "command": "bunx",
      "args": ["pmx-canvas@0.8.0", "--mcp"],
      "env": {
        "PMX_CANVAS_WORKSPACE_ROOT": "/absolute/path/to/project",
        "PMX_CANVAS_PORT": "14313",
        "PMX_CANVAS_URL": ""
      }
    }
  }
}
```

If you are using a local checkout instead of the published package, point the command at the CLI entry:

```json
{
  "mcpServers": {
    "canvas": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/pmx-canvas/src/cli/index.ts", "--mcp"],
      "env": {
        "PMX_CANVAS_WORKSPACE_ROOT": "/absolute/path/to/project",
        "PMX_CANVAS_PORT": "14313",
        "PMX_CANVAS_URL": ""
      }
    }
  }
}
```

Restart the host's MCP process after changing configuration. Inspect startup output for
fallback ports; do not assume the configured port is the one the MCP server bound.

## Amp: connect the agent separately from the portal

PMX does not ship a dedicated Amp lifecycle adapter. Amp can use the native MCP tools;
the portal is only the human's browser UI. Configure MCP inside the orb or runner where
Amp executes, not only on the user's laptop. Merge this into that workspace's
`.amp/settings.json`, preserving other settings (Amp does not use the generic `.mcp.json`):

```json
{
  "amp.mcpServers": {
    "canvas": {
      "command": "bunx",
      "args": ["pmx-canvas@0.8.0", "--mcp"],
      "includeTools": ["canvas_*"],
      "env": {
        "PMX_CANVAS_WORKSPACE_ROOT": "/absolute/path/to/project",
        "PMX_CANVAS_PORT": "14313",
        "PMX_CANVAS_URL": "",
        "PMX_CANVAS_AGENT_SOURCE": "amp"
      }
    }
  }
}
```

Replace root and port with the **existing portal service's actual workspace and local
listening port**. A supervised service may use an assigned `PORT`, not 4313 or 14313;
inspect its status/logs and `/health`. Do not put the public portal URL in the stdio
command or copy another test run's absolute paths. Use an absolute executable path if
the MCP process cannot find Bun. The `canvas_*` filter exposes the Canvas tool family.

### Workspace trust is a human approval

Run `amp mcp doctor` from this workspace to distinguish `awaiting approval` from a
missing executable or connection failure. A new workspace MCP command requires the
user to review and approve it. Give the user this command to run in that workspace's
orb Terminal or runner terminal (replace `canvas` if the configured server name differs):

```bash
amp mcp approve canvas
```

The agent must not run this approval itself or move the command to global settings or
`--mcp-config` to bypass workspace trust. Approval authorizes execution of this MCP
command; it is not a new Canvas import consent or permission to mutate arbitrary boards.
After approval, reload MCP connections (`reload_mcp` in Amp) and require `connected`.
Discover `canvas` tools with `tool_search`; for the full unfiltered 0.8.0 server there
are 24 tools. If still absent, inspect the server status, command/PATH and target instead
of reinstalling blindly. See [Amp MCP documentation](https://ampcode.com/docs/customize/mcp).

### Verify native tools, then steering

1. Check `/health` for the expected package version and canonical workspace. Through
   Amp's discovered tools, read `canvas_board { action: "get" }` and
   `canvas_query { action: "context" }`; verify the board matches the visible portal.
   A CLI smoke check or SDK-spawned MCP client does not establish native Amp discovery.
2. For a requested end-to-end check, use a disposable board. Pin a known card in the
   portal and require a native context read to return that card as pinned. Use one
   stable presence/steering identity (`amp` above, or a unique source per independent
   agent); reuse any adapter-owned session instead of attaching a duplicate.
3. Send a fresh browser message addressed to that identity. The running agent claims
   it with `canvas_ax_delivery` using the same `consumer`, reads the relevant card,
   signals intent, and performs the requested edit through native Canvas tools.
4. Verify the visible result in the browser before marking the message delivered for
   that consumer. A subsequent claim should omit it. Detach only test-owned sessions.

This proves an **active agent can poll and act**, not automatic wake-up of an idle Amp
thread, background polling, or automatic agent launch for imports. An MCP connection
does not install a steering pump. Only configure a pump/host integration when requested;
its startup backlog rules are in the main skill. Tool discovery and resource reads also
do not establish Amp support for native MCP Skills-extension discovery or activation.

## Verify the actual target before writes

For the local target selected above:

```bash
pmx-canvas --version
curl --fail --silent --show-error "http://localhost:${PMX_CANVAS_PORT}/health"
pmx-canvas serve status --port="$PMX_CANVAS_PORT"
```

Require healthy `ok`, the expected running `version`, and a **`workspace`** matching the
intended canonical absolute root (resolve symlinks on both paths). Inspect persistence
health too. `serve status` checks a local port, not an arbitrary `PMX_CANVAS_URL`.
When deliberately targeting a URL or a fallback port, fetch `/health` there instead,
then align CLI, MCP, and browser to it. Never print a credential-bearing URL.
On mismatch, stop: leave the other server alone, choose a free port, and repeat.

Only after confirming the target:

```bash
pmx-canvas layout
pmx-canvas open
```

Inside an orb, open the registered portal rather than asking the user to open localhost.

## Disposable smoke verification

`smoke` creates/searches/removes a temporary node and can leave history/activity records.
It reports the workspace but does **not** compare it with your intended root. Do not run
it on a valuable board as an identity check. Use a new disposable workspace and its own
free port, start it with the appropriate startup method above, and verify `/health` first:

```bash
export PMX_CANVAS_WORKSPACE_ROOT="$(mktemp -d)"
export PMX_CANVAS_PORT=14314 # Choose another free port.
unset PMX_CANVAS_URL
# Start this workspace's server, then verify its actual health workspace/version.
# Only after that verification succeeds:
pmx-canvas smoke
```

Inspect the JSON report and exit status: health, MCP initialize, node lifecycle, and
validation should pass; failures exit 1. Version skew is reported in details and is not
necessarily a failing check. Smoke proves neither `tools/list` discovery nor browser
rendering: verify those separately when testing the complete onboarding experience.
Stop only the test server (service-manager stop, or `serve stop --port=<test-port>` for
your local daemon) before removing its disposable directory. Never clear a user's board
or stop an unrelated listener to make a smoke test pass.
