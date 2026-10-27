# Amp plugin foundation

This is the first increment of Wave 5's Amp integration. It opens the workspace Canvas and
remembers an explicit board binding for each Amp thread. It does **not** yet inject context,
route writes, deliver steering, run Jev, or add guest name entry.

## Install locally

Requires Bun >=1.4.4 and Amp with directory-plugin skills. The tested baseline is
`0.0.1793119929-g574f34` (2026-10-27). Source: `plugins/amp/`; build: `bun run build:plugin`.
The npm package includes the generated directory at `dist/amp-plugin/pmx-canvas`.

Copy that complete directory to your project's `.amp/plugins/pmx-canvas`. For an installed
package, copy from `node_modules/pmx-canvas/dist/amp-plugin/pmx-canvas`. Do not overwrite an
existing plugin or locally edited skills: inspect the differences and approve replacement first.
Reload Amp plugins. Nothing is installed in a personal or workspace-global plugin repository.

Amp registers `pmx-canvas:pmx-canvas`, `pmx-canvas:pmx-canvas-testing` and
`pmx-canvas:pmx-canvas-orchestration`. They are generated copies of the existing PMX skills,
not separate authoring sources. The main skill bundles MCP and gates its tools until loaded.
Approve the workspace MCP command through Amp's normal trust flow. A Portal alone does not
prove native MCP discovery. `canvas_connect_workspace` accepts only this executor's directory.

## Commands and session tool

| Command | Effect |
|---|---|
| PMX Canvas: Open | Start/reconnect, verify workspace, version and bundle stamp, then open the Amp Portal. |
| PMX Canvas: Bind | Choose an existing board for this thread, without opening or editing it. |
| PMX Canvas: Status | Read service identity, binding, whether its board exists, and the shared active board. Does not start a service. |
| PMX Canvas: Unbind | Remove only this thread's binding. Works while the server is down. |

Agents use `pmx_canvas_session` with `action: "open" | "bind" | "status" | "unbind"`.
Bind requires an explicit `boardId`. Invocation thread identity comes from Amp, never model input.

Each binding stores workspace, thread, board and stable consumer ID `amp:<thread-id>` in
`.pmx-canvas/amp-bindings/<thread-id>.json`. Keep this runtime directory out of Git. Separate files
prevent one thread's update from overwriting another's. Bindings survive plugin reload and
service restart. Missing boards are reported, never silently rebound. Board navigation and
moving cards do not change a binding. Unbind is idempotent.

**Bindings are metadata in this increment, not enforced write routing.** Existing PMX tools
still need explicit destinations/expected-board guards. Open displays the current shared
workbench and does not activate the bound board. There is no private per-thread viewport.

## Runtime boundaries

The plugin reuses exact-version PMX runtime discovery and refuses a foreign workspace. Startup
prefers the project's installed matching-version package, then the pinned registry runtime if
the package is absent. An installed version mismatch fails instead of downloading another copy.
In an orb it probes the actual ports returned by `amp orb services ensure`, including custom
ports. If those services do not include Canvas, it creates a supervised Canvas service. The
connection hint in `.pmx-canvas/amp-server.json` is revalidated against workspace health on reuse.
It never holds an orb keep-alive lease. Outside an orb it uses the existing local PMX daemon
launcher. `PMX_CANVAS_URL` is an explicit target, not a fallback. An unavailable explicit target
fails rather than starting a second server. Version mismatch or a missing/unknown bundle stamp
also fails, including at MCP connection and subsequent requests.

**Release limitation:** the published `0.11.0` runtime lacks the required bundle stamp. This
foundation is verified with the locally packed package, not registry-only startup. A compatible
release is required before recommending the registry fallback. No publication is part of this
increment.

Amp supplies the Portal URL and access controls. Open does not change sharing or multiplayer.
Sharing and self-reported guest names are a later increment using Amp's existing controls,
not a separate share server or board-only access policy.

## Verification

`bun test tests/unit/amp-plugin.test.ts` checks bindings and workspace safety through the
registered session tool. `bun run typecheck` checks against the pinned published Amp types.
After `bun run build:plugin`, verify a fresh copied package with `amp plugins list` and
`amp skill info pmx-canvas:pmx-canvas`, then reload the actual host and test discovery and
`pmx_canvas_session`. Test native MCP trust separately from an SDK handshake.

Native acceptance includes open, bind, reload, status, unbind, a foreign-workspace refusal,
two independent thread bindings, persisted boards after service restart, and a rendered Portal.
Actual orb pause/resume and a second live Amp thread must be reported separately from simulated
thread contexts or process restarts. Do not call the entire Wave 5 integration verified from
these foundation checks.
