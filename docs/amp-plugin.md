# Amp plugin, context and steering

The Wave 5 Amp plugin opens the workspace Canvas and binds each Amp thread to an existing board.
Bound MCP calls read and edit that board while the human views another board or Home. Bound
threads receive context at turn start and addressed steering can wake an idle thread.
People can set a self-reported cursor name in Canvas. Jev is not included.

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
| PMX Canvas: Resolve pending steering | Inspect uncertain sends, then explicitly retry or dismiss with human confirmation. |

Agents use `pmx_canvas_session` with `action: "open" | "bind" | "status" | "unbind"`.
Bind requires an explicit `boardId`. Invocation thread identity comes from Amp, never model input.

Each binding stores workspace, thread, board and stable consumer ID `amp:<thread-id>` in
`.pmx-canvas/amp-bindings/<thread-id>.json`. Keep this runtime directory out of Git. Separate files
prevent one thread's update from overwriting another's. Bindings survive plugin reload and
service restart. Missing boards are reported, never silently rebound. Board navigation and
moving cards do not change a binding. Unbind is idempotent.
Each binding also has an incarnation ID. Repeating Bind to the same board keeps it; unbinding
and binding again invalidates old receipts, even for the same board. Installations created
before this delivery increment must Unbind, then Bind again.

**Bindings route PMX MCP tool calls.** The plugin supplies `targetBoardId` and the authenticated
`amp:<thread-id>` identity before invocation. Conflicting destinations and nested overrides fail;
missing/deleted boards never fall back to the visible board. Batches, delayed operations, approval
waits, undo history and file watchers retain their board ownership across human navigation.
An active turn retains the binding it started with or first used. If that binding changes or
disappears, subsequent Canvas calls fail until a new turn starts, including after plugin reload.

Open still displays the shared workbench. There is no private per-thread browser. Bound calls
cannot navigate the shared workbench, restore the workspace backup, or control/capture its shared
WebView. Board deletion remains an unscoped human library action. Tour/camera commands affect
only their target board; they reach the browser only when
that board is visible. CLI calls and MCP resource reads are **not** intercepted by the plugin;
use routed MCP query tools for bound-board context.

A binding is routing, not an access-control or privacy boundary. Board-owned metadata updates
must name the bound board. Catalog reads, board creation, board pins, workspace settings and
knowledge categories keep their workspace scope and existing permission checks. AX timeline,
evidence and addressed steering/delivery are workspace-wide; a steering wait can wake on a message
sent from another board, while its `pendingActivity` contains only the bound board's work/gates.
Cross-board relation targets remain explicit.

## Automatic delivery

At `agent.start`, the plugin prepares a context map with a 12,000-character JSON budget.
Preparation records no reads and advances no cursor. The agent returns the supplied token to
`pmx_canvas_delivery { action: "receive", token }` to confirm reception. This records the
delivered map and complete links, never full card-content reads. Omitted or clipped changes
remain beyond the saved cursor. Pull a card with the existing MCP tools to read its full content.
The plugin keeps its own per-thread, per-board cursor, separate from other readers' cursors.

While the plugin executor is awake, it checks persisted bindings every five seconds for steering
addressed exactly to `amp:<thread-id>`. Broadcasts and messages for other consumers are excluded
before the queue limit. It appends the instruction through Amp's native thread API: an idle
thread starts a turn; a busy thread receives queued steering, which Amp can inject into the
current turn after a tool returns without another `agent.start`. This does not wake a sleeping
orb, hold a keep-alive lease, or create a scheduler. Scanning resumes when the plugin runs again.
The pump scans successive pages of 50 messages so unacknowledged instructions cannot hide later
ones. Instructions over 32,000 characters are not clipped or sent: they appear as `blocked-size`
in Resolve pending steering, where a human can dismiss them and send a shorter instruction.

The agent first receives the steering token, then acts and verifies the result, then calls
`pmx_canvas_delivery { action: "acknowledge", token }`. Host acceptance, reception and action
acknowledgment are separate states. An action that failed or was not verified must not be
acknowledged as successful. The plugin cannot itself certify the agent's work.

Each thread has a SQLite transport journal beside its binding. A send is reserved durably before
calling Amp, preventing duplicate pumps from sending the same instruction. An interrupted or
timed-out send remains **uncertain**, not automatically retried. Reconciliation checks the last
200 transcript messages for the exact user-message payload; finding it confirms acceptance,
not action completion. Absence does not prove non-delivery. Status exposes pending tokens and
polling errors; Resolve pending steering requires human confirmation because retrying an
uncertain send can duplicate an instruction. Dismiss closes delivery without claiming success.
Journals retain packet identities across reloads; do not delete them to retry a message.
Receipt identities also survive Canvas's 5,000-row diagnostic retention. A retry whose original
read has expired is refused rather than counted again; start a new turn for fresh context.
Stop cancels receipt and acknowledgment requests before a pending discovery can initiate a write.

Queued steering with an obsolete binding or completed packet is cancelled at turn start.
Finish or dismiss pending steering before binding to another board. Unbind stops delivery;
the human can still dismiss a pending packet after unbinding or deleting its board.
No exactly-once action-execution guarantee is made.

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

## Collaboration and names

Use Amp's existing thread access, multiplayer and Portal controls to share. Canvas adds no
account, guest token or permission picker. Amp's [Portal access documentation](https://ampcode.com/docs/orbs/portals#access-and-lifecycle)
describes the current controls and workspace restrictions. The installed CLI also exposes
`amp orb portal access`; its presence is not evidence of an external guest completing the flow.
Sharing a Portal exposes its port, including other boards and APIs available there, not just
the current board URL. Only share a workspace whose contents are appropriate for the audience.
Public Portal access does not grant access to the Amp thread or its review tools.

Open **Your name** at the end of the Canvas top bar. Enter up to 40 characters and choose
**Save name**. Other participants see the name on your cursor. Cancel, Escape or blank input
keeps the existing name. The name is saved in this browser when storage is available and
survives reload and reconnect. Renaming does not change the visitor's tab ID; two people may
choose the same name without merging their presence. A name is self-reported, not verified
identity, attribution to an Amp account, or an access grant. Naming makes no access-control
request and does not change thread or Portal sharing.

This control is available in the HTTP workbench, including an Amp Portal, not an MCP-hosted
workbench or an agent-view tab. An initial `?name=` still works; saving a name removes that
parameter so a reload cannot overwrite the saved choice.

**Acceptance boundary:** two browsers inside the owning orb can verify Canvas collaboration,
but Amp routes those Portal requests directly to the service without external authentication.
That does not verify an outside guest's sign-in, public access, or revocation. Test those
separately with fictional data and the owner's approved sharing scope.

## Verification

`bun test tests/unit/amp-plugin.test.ts` checks bindings and workspace safety through the
registered session tool. `bun run typecheck` checks against the pinned published Amp types.
`tests/unit/amp-delivery.test.ts` checks receipt accounting, clipped context, wrong recipients,
competing pumps, interrupted sends/receipts and restart against real Canvas HTTP and SQLite.
`tests/unit/boards-api.test.ts` checks concurrent HTTP routing, restart persistence, nested
identity, waits and refusal paths. `tests/e2e/boards.pw.ts` checks visible-board isolation,
reconnect and opening the populated target board. These do not substitute for native hooks.
After `bun run build:plugin`, verify a fresh copied package with `amp plugins list` and
`amp skill info pmx-canvas:pmx-canvas`, then reload the actual host and test discovery and
`pmx_canvas_session`. Test native MCP trust separately from an SDK handshake.

Native acceptance includes open, bind, reload, status, unbind, a foreign-workspace refusal,
two independent thread bindings, persisted boards after service restart, and a rendered Portal.
Actual orb pause/resume and a second live Amp thread must be reported separately from simulated
thread contexts or process restarts. Do not call the entire Wave 5 integration verified from
these foundation checks.
Delivery acceptance also requires an actually idle thread to wake from addressed Canvas steering,
receive its context, edit the bound board, show the rendered result and acknowledge only afterward.

Native acceptance on Amp `0.0.1793405518-gc59f01` verified idle wake, busy delivery into the
current turn, bound MCP routing through `code_exec`, rendered edits before acknowledgment,
receipt retries, reload and end-of-turn journal cleanup. Wrong-recipient steering stayed pending.
Obsolete queued-packet cancellation and sleeping-orb resume were not exercised; startup
cancellation guards have unit coverage, not native cancellation acceptance.
