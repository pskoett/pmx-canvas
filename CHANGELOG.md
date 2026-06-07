# Changelog

All notable changes to `pmx-canvas` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [0.1.31] - 2026-06-07

### Added

- **Default docked status + context widgets.** A freshly opened canvas now shows
  the agent's status widget docked at the left of the top menu and the context
  widget docked at the right — flanking the toolbar as one continuous bar at the
  same height. They are the same `status-main` / `context-main` nodes the
  agent-event path already creates, just present from the start. Each collapsed
  widget has an expand (▸) and an undock (⊙) control; undocking returns it to the
  canvas as a normal node. Seeded **once on first run** (brand-new workspace
  only) — never added to a canvas that already has content, and deleting or
  undocking them is remembered (they are not re-seeded). `--demo` is unaffected
  (it seeds the demo board instead).

### Changed

- **Collapsed docked widgets match the toolbar height.** The collapsed context
  widget now renders inline in the top HUD row (mirroring the status widget)
  instead of as a separate right-edge side-tab, and a shared `--hud-bar-height`
  keeps the toolbar and both docked pills at an identical height.

### Fixed

- **Context nodes can be undocked.** Previously a `context` node was re-forced to
  `dockPosition: 'right'` on every write, so it could never leave the dock. The
  right-docked collapsed default is now applied at create time only; updates
  (including undock → `dockPosition: null`) are respected.

- **SDK node-response parity (report #31/#32).** `PmxCanvas.addNode`, `getNode`,
  and `addHtmlNode` now return the fully serialized node enriched with a
  `surfaceUrl` (for surface-eligible types) and a `nodeId` alias for `id`,
  matching the HTTP/CLI `node`-create responses field-for-field. `addHtmlNode`
  now returns the created node object instead of a bare id string (consistent
  with `addNode`); read `.id` if you only need the identifier. The internal
  `CanvasAccess` contract is unchanged (still returns a bare id).

- **HTML "Open as site" tab title (report #35).** The standalone surface document
  for an `html` node now carries a `<title>` (the node title) when the author
  HTML does not already declare one, so the browser tab shows the node title
  instead of falling back to the raw `/api/canvas/surface/<id>` URL. An
  author-provided `<title>` is never overridden, and the injected title is
  HTML-escaped.

### Notes

- **Report #33/#34/#36 — not reproduced.** #33 (elicitation/mode immediate
  resolve) and #34 (delivery "claim" route) were already closed by the tester's
  Codex retest as wrong-route repros. #36 (CLI emitting invalid JSON for html
  primitives) does not reproduce: all 19 primitive kinds return valid JSON
  through both `pmx-canvas html primitive add | jq` and raw `curl | jq`, with
  zero unescaped control characters — the CLI re-serializes via `JSON.stringify`
  and the server uses `Response.json`, both of which always escape U+0000–U+001F.
  The full rendered HTML body is intentionally retained in the create response
  (it is relied upon by consumers and renderer tests; agents wanting a compact
  payload can use the MCP tool, which is already compact by default).

## [0.1.30] - 2026-06-07

### Added

- **PMX-AX node interactions (plan-004 Phase 1).** A host-agnostic, capability-gated
  interaction layer over the existing AX primitives. Eligible nodes emit one
  normalized `PmxAxInteraction` envelope (`{ type, sourceNodeId, payload, ... }`)
  that is validated against a per-node-type capability registry (with optional
  per-node `data.axCapabilities` opt-in/narrowing, clamped to a server ceiling)
  and mapped onto the matching AX operation — work item, evidence, approval,
  review, focus, steering, or event. New `POST /api/canvas/ax/interaction`
  endpoint plus full SDK (`PmxCanvas.submitAxInteraction`), CanvasAccess, MCP
  (`canvas_ax_interaction`), and CLI (`pmx-canvas ax interaction`) coverage.
  Interactions are sandbox/transport-agnostic (the same envelope will back native
  nodes, json-render actions, the HTML bridge, MCP apps, and host adapters in
  later phases); `html`/`html-primitive`, `mcp-app`, and internal `prompt`/`response`
  nodes are disabled by default. Accepted and rejected interactions emit SSE
  (`ax-interaction`) plus the underlying AX state event. PMX core still imports no
  host SDK (guarded by `ax-parity.test.ts`).

- **PMX-AX sandboxed HTML bridge (plan-004 Phase 3).** Opted-in `html` /
  `html-primitive` nodes can emit AX interactions from inside the sandbox via
  `window.PMX_AX.emit(type, payload)`. The server injects the bridge into the
  surface document only when the node's AX capabilities are enabled; the bridge
  posts a nonce-tagged message to the parent canvas, which validates the nonce +
  node id and submits through the capability-gated endpoint (the server
  re-validates, so the bridge is convenience, not a trust boundary). The iframe
  sandbox stays `allow-scripts` only. (json-render action→AX mapping remains a
  documented follow-up — the viewer needs a parent channel, same shape as this
  bridge.)

- **PMX-AX delivery semantics (plan-004 Phase 4).** Steering messages can be
  claimed and acknowledged by adapterless consumers. New
  `GET /api/canvas/ax/delivery/pending?consumer=` (loop-safe — excludes steering
  the consumer itself originated) and `POST /api/canvas/ax/delivery/:id/mark`,
  plus SDK/CanvasAccess (`getPendingSteering`, `markSteeringDelivered`), MCP tools
  (`canvas_claim_ax_delivery`, `canvas_mark_ax_delivery`), MCP resources
  (`canvas://ax-pending-steering`, `canvas://ax-delivery`), an MCP prompt
  template (`pmx-current-context`) so MCP-aware clients can inject PMX context
  without a host adapter, and CLI (`pmx-canvas ax delivery list|mark`).

- **PMX-AX elicitation + mode-request primitives (plan-004 Phase 5).** Two new
  canvas-bound, snapshotted AX primitives: `elicitation` (request structured
  human input → respond) and `mode-request` (request a plan/execute/autonomous
  transition → resolve). Full HTTP / SDK / CanvasAccess / MCP
  (`canvas_request_elicitation`, `canvas_respond_elicitation`,
  `canvas_request_mode`, `canvas_resolve_mode`) / CLI coverage, and both are
  executable via the interaction envelope (`ax.elicitation.request`,
  `ax.mode.request`). Command registry and tool/prompt policy primitives are
  intentionally deferred pending the plan's open product questions (which
  commands are first-class; how much prompt/system-message mutation PMX should
  allow by default); the capability registry already reserves `mcp-app` (disabled
  by default), so the MCP-app interaction bridge (Phase 6) is gated and
  forward-compatible until that trust boundary is designed.

- **PMX-AX follow-ups — command registry, tool/prompt policy, json-render +
  MCP-app bridges.** The four documented deferrals now ship. (1) A **command
  registry** (`pmx.plan`, `pmx.execute`, `pmx.promote-context`, `pmx.summarize`,
  `pmx.review`) with a registry-gated `invokeCommand` (records an `agent-event`
  of kind `command`); unknown names are rejected (`400`). Executable via the
  envelope (`ax.command.invoke`) and exposed over HTTP
  (`GET|POST /api/canvas/ax/command`), SDK, CanvasAccess, MCP
  (`canvas_invoke_command`), and CLI (`pmx-canvas ax command list|invoke`).
  (2) A canvas-bound, snapshotted **tool/prompt policy** singleton
  (`tools.allowed|excluded|approvalRequired`, `prompt.systemAppend|mode`) read
  into `canvas://ax-context`; set via `GET|POST /api/canvas/ax/policy`,
  `canvas_set_ax_policy`, and `pmx-canvas ax policy get|set` (patches merge and
  are normalized server-side). (3) The **json-render viewer → AX channel**: a
  spec action named after an AX type (e.g. `on.press → { action:
  "ax.work.create" }`) is forwarded by the viewer bundle to the parent canvas,
  which validates (iframe source + per-viewer nonce + node id) and submits
  through the capability-gated endpoint (`sourceSurface: 'json-render'`). The
  bridge nonce/node-id globals are injected into the viewer HTML only when the
  embedding node requests them. (4) The **MCP-app interaction bridge (Phase 6)**:
  opted-in ext-app `mcp-app` nodes get `window.PMX_AX.emit(...)` injected into
  the app HTML (same nonce-tagged shape as the HTML bridge,
  `sourceSurface: 'mcp-app'`), disabled by default and node-scoped. All emit
  surfaces remain convenience-only — the server re-validates every interaction
  against the node's effective capabilities, so it stays the single trust
  boundary.

- **PMX-AX native node controls (plan-004 Phase 2).** Inline AX controls on
  native nodes that submit interactions through the browser: status nodes get a
  "Track as work" button (→ `ax.work.create`), file nodes a "mark as evidence"
  control (→ `ax.evidence.add`), and context nodes a "Set focus" button
  (→ `ax.focus.set`). A client helper (`submitAxInteractionFromClient`) posts to
  the interaction endpoint and surfaces the outcome as a transient toast.
  (json-render action → AX mapping is deferred to the bridge-transport work: the
  json-render viewer consumes actions internally and needs a viewer→parent
  channel, the same shape as the HTML and MCP-app bridges.)

- **Open as site — standalone node surfaces.** Every renderable surface node can
  now be opened full-page in its own browser tab via an ↗ "Open as site" button
  (node title bar and expanded overlay), covering `html` / `html-primitive`,
  bundled `web-artifact`, `json-render` / `graph`, `webpage`, and hosted ext-app
  `mcp-app` nodes. A new stable route, `GET /api/canvas/surface/:nodeId`, serves
  (or redirects to) the surface, and the in-canvas `html` iframe now loads that
  **same URL** — one render path, no separate "preview" document, and the URL
  reflects current node state and survives a refresh. Node payloads expose the
  URL as `surfaceUrl` (`canvas_get_node` / `canvas_get_layout`) so agents can
  point a human at "the artifact" without disturbing the canvas. Served HTML
  keeps its opaque-origin posture (`Content-Security-Policy: sandbox`), so author
  code opened top-level cannot reach the canvas origin. The html surface theme is
  served from a new same-origin stylesheet (`/canvas/surface-theme.css`) and
  live-switches via the existing theme bridge. ext-app surfaces render their UI
  but, opened standalone, cannot run interactive tool-calls (no host bridge in a
  bare tab); `webpage` / URL-backed `mcp-app` nodes redirect to their site.

### Fixed

- **json-render specs preserve `on` event bindings through validation.** The
  json-render element schema dropped the `on` field during validation, so
  spec-authored action bindings (`on.press`, `on.change`, …) were silently
  stripped before reaching the viewer and never fired. `on` is now retained,
  which both makes general json-render interactivity work and is what lets the
  json-render → AX channel above dispatch its `ax.*` actions. `on` is optional —
  normalization defaults it to an empty bindings object, so specs whose elements
  have no event bindings still validate.

- **Canvas iframes are promoted to their own compositing layer**
  (`transform: translateZ(0)` on `.html-node-frame` / `.mcp-app-frame`) to
  mitigate an intermittent blank-iframe glitch — an HTML/app node iframe in
  the zoom/pan-transformed canvas (near the chrome's heavy backdrop-filter
  blur and behind group frames) could occasionally paint blank until a
  resize/zoom forced a repaint. Investigation ruled out a content/load issue
  (the frame document served valid HTML) and a DOM-reorder/reload on grouping
  (reproduced grouping single and multiple HTML nodes with the iframe keeping
  its src and content); the remaining cause is a browser compositor paint
  invalidation, which the dedicated GPU layer addresses.

### Changed

- **Group frames are roomier.** Auto-fit group frames now leave more margin
  around their children (`GROUP_PAD` 40 → 56) so the group header and its
  node-count badge stay visible instead of sitting under the top-left child.
- **Skill guidance: open the canvas first, always.** The bundled
  `pmx-canvas` skill now tells agents to open/focus the workbench themselves
  before mutating nodes on **every** host (Codex in-app Browser, Copilot
  panel, or any plain browser) rather than assuming the host opened it — some
  hosts don't. Added layout guidance too: space nodes generously (more when
  edges connect them and inside groups, so the edge flow is visible) and size
  group frames larger than their children.

### Fixed

- **Group operations no longer auto-pack or repack children.** Grouping
  existing nodes (`canvas_group_nodes` / `/api/canvas/group/add`) without
  an explicit `childLayout` now preserves their positions (matching
  `canvas_create_group` and the batch `group.add`), and moving or resizing
  a grouped child re-fits the group frame **without** repacking siblings or
  discarding the child's requested coordinates. Compaction is opt-in via an
  explicit layout. (0.1.29 report Bug #32.)
- **HTTP/CLI node-create responses now include the `nodeId` alias.** The
  0.1.29 `id`/`nodeId` alias only reached the MCP responses; the
  `/api/canvas/node` (and graph/json-render) responses used by the CLI now
  expose both keys too. (0.1.29 report Bug #31.)
- **`canvas_batch` now supports `node.remove`.** The operation is
  implemented (and listed in the tool description) instead of being
  rejected as unsupported. (0.1.29 report Bug #33.)

## [0.1.29] - 2026-06-06

### Changed

- **Bullet graph nodes accept the conventional `actual` measure key** in
  addition to `value`, so `data: [{ label, actual, target }]` renders
  without an explicit `valueKey` instead of failing the data-key check.
- **Node-create MCP responses expose both `id` and a `nodeId` alias.**
  All node-create tools (including SpecStream) now return both keys,
  matching the existing external-app / web-artifact responses, so agents
  using either key (or a cached schema) work.
- **Friendlier AX CLI errors for bare subcommands.** Running `pmx-canvas
  ax event` (or `evidence`/`host`/`work`/`approval`/`review`) without the
  action now suggests the full command (e.g. `ax event add`) or lists the
  available actions instead of a generic unknown-command error.

### Fixed

- **`pmx-canvas --mcp` no longer crashes with `EADDRINUSE`** when a daemon
  already holds the target port for a *different* workspace. The MCP/SDK
  auto-start now falls back to a free port (a same-workspace daemon is
  still attached to as before) and prints a stderr note explaining how to
  share one canvas (`PMX_CANVAS_URL` / `PMX_CANVAS_PORT` or run the daemon
  from this workspace). An explicit SDK `start()` port is still honored
  exactly unless `allowPortFallback` is passed.
- **Ledger nodes render body `content` as a log** — one line per entry,
  no stray "Content" field label, and a literal `\n` (as the shell
  passes through `--content "a\nb"`) is treated as a line break instead
  of being shown verbatim. Structured key/value fields still render as
  rows, now with a gap so the label never runs into the value.

## [0.1.28] - 2026-06-06

### Changed

- **BREAKING (SDK): `PmxCanvas.addNode()` now returns the created node**
  (a `CanvasNodeState` with `id`, geometry, and data) instead of a bare
  id string. Use `const { id } = canvas.addNode(...)` or keep the whole
  node. The MCP / HTTP / CLI surfaces and the internal `CanvasAccess`
  contract are unchanged (still id-based).

### Fixed

- Tufte graph nodes (DotPlot/Bullet/Slopegraph) no longer flicker: the
  chart-height ResizeObserver no longer feeds the document's own scroll
  overflow back into its height.
- Expanded Tufte graph views now fill the modal instead of staying
  tile-sized with whitespace.
- Graph node iframes no longer show a doubled scrollbar; a chart that
  fits shows none, a dense chart shows exactly one.
- Excalidraw / ext-app nodes paint on first mount instead of rendering
  black until a manual expand/collapse (a post-layout host-context
  nudge is delivered once the iframe has settled).
- `image` and `ledger` nodes get roomier default sizes (480×360 /
  420×280) instead of a cramped 360-wide frame.
- `pmx-canvas web-artifact build` streams a stderr heartbeat during the
  long install+bundle so agents don't see it as hung.
- json-render rejects an unknown `$`-directive (e.g. `$path`) with a
  clear error pointing at `$state`, instead of rendering
  `"[object Object]"`.
- Web-artifact script-path overrides are contained to the workspace with
  a symlink-aware (realpath) check, fixing a false rejection on macOS.
- **Security:** the `/api/canvas/image/<id>` route now refuses to serve
  files outside the workspace root (returns 403), closing a path-
  traversal read (e.g. an image node pointed at `../../etc/passwd`).

## [0.1.27] - 2026-06-06

Big release: the full host-agnostic agent-experience (AX) primitive
contract and a json-render 0.19 upgrade with Tufte charts, directives,
and live SpecStream rendering. The MCP canvas now exposes 56 tools (was
45) and four AX resources. Plus the native GitHub Copilot and Codex
canvas adapters are featured in the README.

### Added

- **Full AX primitive contract (plan-004 Phases 2-5).** Eleven new MCP
  tools, each with complete parity across CanvasStateManager, SQLite
  persistence, the Bun SDK, HTTP, the MCP server, the RemoteCanvasAccess
  proxy, and the CLI, organized into three lifecycle partitions:
  - **Canvas-bound** (participate in snapshots + restore, cleared by
    `canvas_clear`, read via `canvas_get_ax` / `canvas://ax-work`):
    `canvas_add_work_item`, `canvas_update_work_item`,
    `canvas_request_approval`, `canvas_resolve_approval` (state machine
    `pending → approved/rejected`, double-resolve rejected),
    `canvas_add_review_annotation`.
  - **Timeline** (persist in dedicated DB tables bounded by 500-row
    retention, NOT restored by snapshots, NOT cleared by
    `canvas_clear`, read via `canvas_get_ax_timeline` /
    `canvas://ax-timeline`): `canvas_add_evidence`,
    `canvas_record_ax_event`, `canvas_send_steering`.
  - **Host/session** (survives `canvas_clear`):
    `canvas_report_host_capability`.
  New resources: `canvas://ax-work` and `canvas://ax-timeline` (joining
  `canvas://ax` and `canvas://ax-context`). CLI gains `pmx-canvas ax`
  subcommands.
- **`canvas_stream_json_render_node` (SpecStream).** Progressively build
  a json-render node by streaming JSON-Patch operations; the server
  accumulates the spec (it is the source of truth) and the live node
  re-renders as patches arrive. Omit `nodeId` to create, pass it back to
  append, set `done:true` to finish.
- **Tufte chart types.** json-render graph nodes gain `Sparkline`,
  `DotPlot`, `BulletChart`, and `Slopegraph`, wired through the full
  definitions → catalog → component-registry pipeline alongside the
  existing chart types.
- **json-render 0.19.0 upgrade + directives + devtools.** All
  `@json-render/*` packages move to 0.19.0. Specs can use the standard
  stateless directives (`$format`, `$math`, `$concat`, `$count`,
  `$truncate`, `$pluralize`, `$join`) for server-side derivations; an
  opt-in devtools panel (double-gated behind an env flag + `?devtools=1`)
  is available for debugging.
- **Native GitHub Copilot and Codex canvas adapters featured in the
  README**, with the `.github/extensions/pmx-canvas` Copilot extension
  and the Codex/Copilot app-adapter skill references.

### Fixed

- **SpecStream rejects prototype-pollution patch paths.** Streamed
  JSON-Patch paths whose JSON-Pointer contains a `__proto__`,
  `constructor`, or `prototype` segment are now skipped (and counted)
  rather than applied, closing a server-side prototype-pollution vector
  in the new streaming path.
- **`canvas_add_review_annotation` no longer reports false success for
  invalid node anchors.** A node-anchored review annotation whose
  `nodeId` is missing or not on the canvas was silently dropped by
  normalization yet returned as a populated success object. It now
  rejects up front (`ok:false` / HTTP 400 / MCP error) across every
  layer, so agents can't lose review findings to a typo'd node id.

### Internal

- Regression coverage added for: SpecStream patch application (happy
  path, malformed-item skipping, and the prototype-pollution guard with
  an explicit `Object.prototype` cleanliness assertion), the Tufte
  Sparkline/Slopegraph spec builders, and node-anchor validation for
  review annotations (missing / unknown / file / valid). Docs updated:
  `docs/mcp.md` adds the `canvas_fit_view` row, and
  `skills/pmx-canvas/SKILL.md` lists the four `canvas://ax*` resources.

## [0.1.26] - 2026-06-03

Small follow-up to 0.1.25. `canvas_add_node` can now create populated
groups directly, the snapshot diff is available over HTTP, and the
packaged skill documents host-aware browser-panel etiquette.

### Added

- **`canvas_add_node({ type: 'group' })` creates a populated group.**
  The generic add path (MCP and SDK) now routes `type: 'group'` to
  `createGroup`, accepting `children` / `childIds` (node IDs to
  enclose), an optional `childLayout` (`grid` / `column` / `flow`),
  and a frame `color`. `canvas_create_group` remains the dedicated
  entry point; this just removes the dead-end where `canvas_add_node`
  produced an empty group node. Child-ID validation is inherited from
  `createGroup` (missing / self / nested-group children rejected).
- **`GET /api/canvas/snapshots/diff` over HTTP.** The snapshot-vs-
  current-layout diff that was previously MCP-only (`canvas_diff`) is
  now reachable over HTTP at
  `/api/canvas/snapshots/diff?name=<name|id>`, returning both the
  structured `diff` and a `text` rendering. Missing name → 400,
  unknown snapshot → 404.

### Changed

- **Packaged skill documents host-aware browser-panel etiquette.**
  `skills/pmx-canvas/SKILL.md` now tells agents to reuse an existing
  native canvas panel (e.g. the GitHub Copilot `pmx-canvas` extension
  or Codex's in-app Browser on `/workbench`) instead of opening a
  second browser panel to the same workbench, and to open the browser
  workbench only when no native adapter is present. It also restates
  that only same-origin `/api/canvas/frame-documents/<id>` URLs are
  auto-trusted — external `mcp-app` URLs show the unverified-domain
  interstitial by design.

### Internal

- Regression coverage for: `canvas_add_node` group creation via both
  `children` and `childIds` (MCP), and the HTTP snapshot-diff endpoint
  returning the snapshot name in the structured diff.

## [0.1.25] - 2026-06-03

Adapter-regression cleanup on top of 0.1.24. Fixes several issues the
GitHub Copilot and Codex canvas adapters surfaced: effective pinned
state now shows up on node reads, PMX-served frame-document iframes are
trusted automatically, group membership is settable through the generic
node APIs, default node sizes were retuned, and the mutation-history
diff no longer reports spurious "data changed" for title/content edits.

### Changed

- **Node reads report effective pinned state.** `canvas_get_node` and
  `canvas_get_layout` (and every read path) now return `pinned: true`
  when a node is in the context-pin set, not only when its own
  `pinned` flag is set. Adapters that key off `pinned` now see what
  the human actually pinned.
- **Larger default node sizes.** Markdown nodes default to 640×420
  (was 520×360) and `mcp-app` nodes get an explicit 960×600 default,
  applied consistently across the HTTP create/batch path, the SDK,
  and browser auto-placement. Larger app frames render their embedded
  content without immediate manual resizing.
- **Mutation-history diff ignores title/content for "data changed".**
  `canvas_diff` and the history timeline no longer flag a generic
  "data changed" when only a node's `title` or `content` differs —
  those are already reported as their own title/content changes, so
  the data-level diff now compares the remaining fields.

### Added

- **PMX-served frame documents are trusted automatically.** Embedded
  `mcp-app` iframes whose source is a same-origin
  `/api/canvas/frame-documents/<id>` URL are now treated as trusted
  (no sandbox-escape warning), via a new
  `isSameOriginFrameDocumentUrl()` guard that validates both the
  origin and the path prefix. External URLs and unrelated same-origin
  paths remain untrusted.
- **Group membership through the generic node APIs.** `POST
  /api/canvas/group` and the node update path accept `children` /
  `childIds` (or `data.children`) and persist group membership, with
  validation that rejects missing child IDs, self-references, and
  nested-group children. Snapshot diffs expose the resulting
  membership.

### Internal

- Regression coverage for: frame-document trust (same-origin PMX path
  trusted; external and unrelated same-origin paths not), generic
  group-children APIs persisting membership and surfacing it in
  snapshot diffs, the retuned default node sizes through CLI/HTTP/MCP,
  effective-pinned read state, and the title/content-aware
  mutation-history diff.

## [0.1.24] - 2026-06-03

Host-adapter and agent-experience (AX) release. Adds host-agnostic AX
focus/context primitives across every layer, ships GitHub Copilot and
Codex canvas adapters, moves embedded HTML/MCP-app iframes onto a
same-origin frame-document transport (still strictly sandboxed via a
CSP `sandbox` response header), and fixes a batch of iframe-backed
node drag/resize/fullscreen interaction glitches.

### Added

- **PMX AX focus + context primitives.** A new host-agnostic
  "agent experience" focus field lets any surface mark which nodes
  an agent is attending to without moving the viewport. Implemented
  end to end with full parity:
  - State: `CanvasStateManager.getAxFocus()` / `setAxFocus()` /
    `getAxState()`, recorded as a `setAxFocus` mutation-history op
    (undo/redo) and persisted in a new SQLite `ax_state` table.
  - SDK: `PmxCanvas.getAxState()`, `getAxContext()`, `setAxFocus()`.
  - HTTP: `GET`/`PATCH /api/canvas/ax`, `GET /api/canvas/ax/context`,
    `POST /api/canvas/ax/focus`.
  - MCP: `canvas_get_ax`, `canvas_set_ax_focus` (45 tools total),
    plus `canvas://ax` and `canvas://ax-context` resources that emit
    `notifications/resources/updated` on change.
  - CLI: `pmx-canvas ax focus <node-id...>` / `--clear`.
  Focus state carries a `source` tag (`agent`/`api`/`browser`/`cli`/
  `codex`/`copilot`/`mcp`/`sdk`/`system`) and node IDs are validated
  against the live layout.
- **GitHub Copilot canvas adapter.** A new
  `.github/extensions/pmx-canvas/extension.mjs` (591 lines) plus
  `skills/pmx-canvas/references/github-copilot-app-adapter.md`
  document and implement driving the canvas from GitHub Copilot.
- **Codex canvas adapter coverage.**
  `skills/pmx-canvas/references/codex-app-adapter.md` documents the
  Codex host integration, with browser regression coverage.
- **Same-origin frame-document transport for embedded apps.**
  Embedded HTML and MCP-app iframes now load their document from
  `POST /api/canvas/frame-documents` → `GET /api/canvas/frame-
  documents/<id>` instead of an inline `srcdoc`. The served document
  carries `Content-Security-Policy: sandbox <tokens>`,
  `Referrer-Policy: no-referrer`, and `X-Content-Type-Options:
  nosniff`. The sandbox-token allowlist deliberately excludes
  `allow-same-origin` and top-navigation tokens, so frame content
  stays in an opaque origin and cannot reach the canvas host. The
  document store is in-memory, capped at 128 entries (LRU eviction)
  and 5 MB per document.

### Changed

- **Iframe-backed node drag is flicker-free.** Node drag now
  rAF-throttles pointer moves, clears the browser text selection,
  and toggles an `is-node-dragging` document class to suppress
  selection and attention-field repaint artifacts. Inline app
  iframes are kept pointer-inert near the resize handle so resize
  starts reliably.
- **Docs tool/resource references updated.** `docs/mcp.md` and the
  README now read 45 tools + 9 core resources; the `AGENTS.md` and
  `CLAUDE.md` MCP tool enumerations were corrected to the full
  45-tool list (they had drifted to 42 and 39 respectively and were
  missing `canvas_fit_view` and the new AX tools).

### Internal

- Regression coverage for: AX focus set/clear/persistence through
  state, HTTP, MCP, SDK, and CLI; AX focus round-tripping through
  SQLite; arrange-lock interactions; iframe-backed node
  drag/resize/fullscreen behavior (large browser e2e additions); and
  the Copilot/Codex adapter surfaces.

## [0.1.23] - 2026-05-12

Persistence overhaul. Canvas state, snapshots, context pins, and the
large-payload blob store all move from filesystem JSON files into a
single SQLite database at `.pmx-canvas/canvas.db` (WAL mode). The
old `state.json`, `snapshots/`, and per-blob files are auto-imported
on first boot and renamed to `.bak`. Adds dock-aware validation and
arrange behavior, accepts the documented `?type=` query string on
node creation, and grows the schema-metadata kebab-case aliases to
include both singular and plural variants.

### Added

- **SQLite persistence (`src/server/canvas-db.ts`, 710 lines).**
  Canvas state, snapshots, context pins, and the blob sidecar
  store now live in `.pmx-canvas/canvas.db` (Bun SQLite in WAL
  mode). Shape preserved across the migration: nodes, edges,
  annotations, viewport, context pins, history, snapshots, and
  blob payloads with checksum validation.
  - Override DB path: `PMX_CANVAS_DB_PATH` env var.
  - Backward-compatible legacy path: `PMX_CANVAS_STATE_FILE` (if
    you set a `.db` path there, it's used as the DB; if not, it's
    treated as a legacy JSON path for migration).
  - `stopCanvasServer()` now calls `canvasState.close()` which
    checkpoints WAL data into the DB file — stop the server (or
    flush/close the SDK) before committing `canvas.db`.
  - SQLite WAL/SHM files (`*.db-wal`, `*.db-shm`) are gitignored;
    `canvas.db` itself is git-committable.
- **Legacy migration on first boot.** Existing
  `.pmx-canvas/state.json`, root `.pmx-canvas.json`,
  `.pmx-canvas/snapshots/`, `.pmx-canvas-snapshots/`, and blob
  files are imported into the SQLite database and renamed to
  `.bak` on first start. The migration is idempotent and only
  runs when the DB is empty.
- **HTTP node create accepts `?type=` query string.** `POST
  /api/canvas/node?type=html-primitive` with the body's `data`
  fields is accepted as an alternative to passing `type` in the
  body — handy for `curl` and shell-based agents. The body form
  still wins when both are present.

### Changed

- **Docked nodes are excluded from layout collision validation.**
  `validateCanvasLayout` no longer flags `dockPosition !== null`
  nodes as overlap or containment violations. Docked HUD-style
  nodes intentionally sit on top of canvas content; the validator
  now models that.
- **Docked nodes are treated as arrange-locked.** `arrange()`
  now skips translating nodes with `dockPosition !== null` along
  with pinned and explicitly arrange-locked nodes. Dock geometry
  is anchored to the HUD layer, not the world grid.
- **Schema kebab-case aliases include plural forms.** `--embedded-
  node-ids`, `--embedded-urls`, and `--slide-titles` are now
  documented aliases for the array-shaped HTML sidecar fields,
  alongside the existing singular `--embedded-node-id`,
  `--embedded-url`, and `--slide-title`.
- **Bun engine bumped to `>=1.3.14`.** `package.json#engines.bun`
  raised from `>=1.3.12` to `>=1.3.14` to pick up the
  `bun:sqlite` improvements the new persistence layer depends on.

### Internal

- Regression coverage for: `validateCanvasLayout` ignoring docked
  nodes as collision candidates, html primitive node creation
  accepting the documented query-string `?type=` form, and the
  existing canvas-state and operations suites continuing to pass
  against the SQLite-backed persistence (including snapshot
  save/restore, blob round-trip, and undo/redo history).

## [0.1.22] - 2026-05-12

CLI ergonomics and response-size polish on top of 0.1.21. Adds a
`pmx-canvas diagram add` alias, declares kebab-case aliases for the
HTML sidecar fields in the schema, advertises those flags in `node
add --help --type html`, elides full file bodies from compact node
responses, validates presentation theme names with a clear error,
and improves keyboard focus inside present mode.

### Added

- **`pmx-canvas diagram add` CLI alias.** A thin wrapper that
  delegates to `pmx-canvas external-app add --kind excalidraw` so
  diagram creation has a discoverable top-level command. The `diagram`
  subcommand is now registered in `AGENT_COMMANDS` and surfaces in
  `pmx-canvas --help`. The help text for `diagram add` notes the
  equivalence so agents can switch between the two without guessing.
- **`node add --help --type html` advertises sidecar flags.** The
  help output now includes a dedicated "HTML sidecar flags" section
  listing `--summary`, `--agent-summary`, `--description`,
  `--presentation true`, `--slide-title`, and `--embedded-node-id`,
  matching the sidecars added in 0.1.21.
- **Kebab-case aliases for HTML sidecar fields in
  `canvas_describe_schema`.** The schema entries for `agentSummary`,
  `embeddedNodeIds`, `embeddedUrls`, and `slideTitles` now declare
  the corresponding kebab-case flag names so agents reading the
  schema discover the CLI shape without trial and error.

### Changed

- **Compact node responses elide file content.**
  `serializeCanvasNodeCompact` replaces a file node's full
  `data.fileContent` with `{ omitted: 'file-content', bytes,
  lineCount, sha256 }`. Agents that hit `canvas_get_node`,
  `canvas_get_layout`, or batch-style responses without
  `full: true` no longer re-receive the file body on every read;
  the file `path` is still exposed as `content` so the node remains
  fetchable.
- **Presentation theme names are validated.** Passing an invalid
  `theme` (or `theme.base`) to a `presentation` primitive now
  fails fast with a clear "use canvas, midnight, paper, aurora, or
  a custom theme object" message instead of silently falling
  through to a default. The HTTP `POST /api/canvas/node?type=html-
  primitive` endpoint wraps `buildHtmlPrimitive` in a try/catch and
  returns a 400 with the message.
- **Present-mode keyboard focus is tighter.** Tabbing inside the
  presentation overlay now jumps to the Exit button instead of
  escaping to the underlying canvas, Space and Enter on the Exit
  button no longer trigger slide navigation, and the overlay
  re-focuses itself when keyboard focus drifts outside. The deck
  iframe loses its 18px corner radius in present mode for an
  edge-to-edge fullscreen frame.

### Internal

- Regression coverage for: `node add` forwarding HTML sidecar flags
  through to the underlying html node, `node add --help --type
  html` advertising the new flags, `diagram add` always invoking
  the Excalidraw external app alias, `diagram` routing through the
  agent CLI (not the server-startup path), presentation primitives
  rejecting unknown theme names, and batch `file` node add
  responses returning compact `file-content` metadata instead of
  the full body.

## [0.1.21] - 2026-05-09

HTML communication maturity pass on top of 0.1.20. Adds a
`presentation` primitive kind (PowerPoint-style decks with themes),
turns every html node into a first-class agent context surface with
semantic sidecars (summary, agent summary, description, slide
titles, embedded refs), wires a real Present-mode overlay with
iframe-focused keyboard navigation and a live theme bridge, and
routes the `pmx-canvas html` subcommand correctly through the agent
CLI.

### Added

- **New `presentation` HTML primitive kind.** `canvas_add_html_primitive
  --kind presentation` generates a PowerPoint-style fullscreen deck
  inside the standard sandboxed `html` node and persists the deck
  metadata (`presentation: true`, `slideCount`, `slideTitles`,
  optional `presentationTheme`). Themes: `canvas`, `midnight`,
  `paper`, `aurora`, or a custom color object with `bg`, `panel`,
  `surface`, `border`, `text`, `textSecondary`, `textMuted`,
  `accent`, and `colorScheme`. The MCP canvas now exposes 19 HTML
  primitives (was 18).
- **HTML node semantic sidecars.** Every html node can now carry
  agent-readable metadata that agents see without parsing the
  iframe payload: `summary`, `agentSummary`, `description`,
  `presentation`, `slideTitles`, `embeddedNodeIds`, `embeddedUrls`.
  Same surface lands on CLI (`pmx-canvas node add --type html
  --summary "..." --agent-summary "..." --description "..."
  --presentation true --slide-title "..." --embedded-node-id ...`),
  HTTP `POST /api/canvas/node`, MCP `canvas_add_html_node`, SDK
  `PmxCanvas.addHtmlNode()`, and `canvas_describe_schema`.
  `agent-context` and `canvas://pinned-context` now expose this
  metadata for HTML nodes.
- **Auto-derived `contentSummary` for html nodes.** When the agent
  doesn't supply an explicit summary, PMX runs the rendered HTML
  through a new `summarizeHtmlText()` (in
  `src/server/html-node-summary.ts`) to extract a bounded plain-
  text summary that drives search, pinned context, and spatial
  context. `normalizeHtmlNodeSemanticData()` keeps existing
  provenance and semantic fields stable across edits.
- **Browser-side Present mode.** Presentation-marked html nodes
  surface a Present button in `ExpandedNodeOverlay` that opens a
  fullscreen overlay with the deck iframe focused. Arrow keys,
  Page Up/Down, Space, Home, and End are forwarded into the iframe
  via a token-scoped postMessage bridge, and pressing Escape inside
  the iframe exits via the same bridge. A live theme bridge
  re-injects the canvas theme tokens into the iframe whenever the
  theme changes, so present mode reflects light/dark toggles
  instantly.
- **`html-primitives.md` skill reference.** New 132-line authoring
  guide under `skills/pmx-canvas/references/` covers when to use
  primitives versus `canvas_add_html_node` versus
  `canvas_build_web_artifact`, the catalog, and shared design
  language.

### Changed

- **`canvas_add_html_node` clarifies presentation is opt-in.** The
  MCP tool description now states explicitly that presentation
  mode is opt-in (pass `presentation: true` or use the
  `presentation` primitive) — normal html nodes remain the default
  for reports, widgets, and bespoke visualizations.
- **Auto-fit no longer shrinks presentation html nodes.** Like
  graph and json-render frames, presentation-marked html nodes
  keep their explicit width and height so decks aren't squeezed
  by the content-fit pass.
- **`pmx-canvas html` subcommand routes through the agent CLI.**
  Same fix as the earlier `fit` and `screenshot` routing issues —
  `html` is now in the `AGENT_COMMANDS` set in `src/cli/index.ts`
  so it doesn't get treated as a server-startup invocation.

### Internal

- Regression coverage for: HTML node semantic sidecars persisting
  through CLI/HTTP/MCP, presentation primitives storing slide
  metadata and theme metadata (named + custom), agent context
  exposing html sidecars and presentation metadata, auto-fit
  excluding presentation html frames, the `html` CLI routing,
  client-side present-mode behavior (only explicit presentation
  html nodes can present; theme bridge injected; srcdoc marker
  distinguishes review vs present mode), live theme update on
  present-mode iframe (e2e), and present mode focusing iframe
  keyboard navigation while hiding review hints (e2e).

## [0.1.20] - 2026-05-06

A bigger feature release. Adds 18 reusable HTML communication
primitives (choice grids, plans, review sheets, system maps, design
sheets, decks, explainers, status reports, throwaway editors…) so
agents can stop reaching for long markdown for structured artifacts,
introduces text annotations alongside the existing pen/eraser, makes
expanded mcp-app/webpage/json-render/graph viewers stretch to fill
the overlay, fixes grid arrange to respect grouped children, and
extracts the project-tour demo to a declarative JSON seed.

### Added

- **`canvas_add_html_primitive` and 18 communication primitives.**
  A new MCP tool plus CLI `html primitive add` / `html primitive
  schema` and HTTP `POST /api/canvas/node` with `{type:
  "html-primitive", kind, data}` (or the alternative `{type:
  "html", primitive: kind, data}`) generate sandboxed `html` nodes
  from named primitives: `choice-grid`, `plan-timeline`,
  `review-sheet`, `pr-writeup`, `system-map`, `code-walkthrough`,
  `design-sheet`, `component-gallery`, `interaction-prototype`,
  `flowchart`, `deck`, `illustration-set`, `explainer`,
  `status-report`, `incident-report`, `triage-board`,
  `config-editor`, `prompt-tuner`. The MCP canvas now exposes 42
  tools (was 41). `canvas_describe_schema` adds an `htmlPrimitives`
  array describing each primitive's data shape.
- **Text annotations.** The annotation toolbar gains a third tool
  alongside pen and eraser. Text annotations render as SVG `<text>`
  using the `--c-annotation` token, persist alongside freehand
  strokes (`type: 'text'` on `CanvasAnnotation`), and route through
  the same HTTP create/delete + canvas-state undo/redo paths as the
  freehand layer.
- **Declarative demo seed (`src/server/demo-state.json`).** The
  project-tour demo is now a 28KB JSON snapshot loaded by a small
  `demo.ts` shim, replacing the 800-line imperative seed. Editing
  the tour is now a JSON edit, and the unit tests exercise the
  loader and verify a stable grouped layout.
- **Install section in the README.** Documents `bunx pmx-canvas`,
  `bun add -g pmx-canvas`, `bun add pmx-canvas` (for the SDK), and
  `npm install -g pmx-canvas`, plus the Bun-on-PATH caveat (the
  CLI uses a `#!/usr/bin/env bun` shebang). (Released as commits
  `f9449e5`, `fe0843c`.)

### Changed

- **Expanded mcp-app / webpage / json-render / graph viewers
  stretch to fill the overlay.** `ExpandedNodeOverlay` now wraps
  embedded viewers in a flex container, json-render and graph
  viewers receive `?display=expanded` in the URL plus a
  `window.__PMX_CANVAS_JSON_RENDER_DISPLAY__` global, and a new
  `useChartFrameHeight()` hook computes available content height
  dynamically. Expanded charts no longer leave a white band at the
  bottom of the overlay.
- **Grid arrange preserves grouped child offsets.** The arrange
  algorithm in the new shared `auto-arrange.ts` excludes grouped
  children from translation. Previously the parent group was moved
  *and* the child was moved relative to it, double-translating the
  child off-screen. Undo restores the original positions exactly.
- **CommandPalette gains a "New note" markdown shortcut.** Quick-
  add a `markdown` node from the palette with the standard
  520×360 default size.

### Internal

- Regression coverage for: HTML primitive CLI/MCP creation
  producing searchable html nodes with primitive metadata, text
  annotation persistence and HTTP create/delete, grid arrange
  preserving grouped child offsets through the operation and its
  undo, declarative demo seed loading into a stable grouped layout,
  graph chart-height absent unless explicitly provided, and
  expanded graph nodes stretching content to the overlay frame
  (e2e), plus pen and text annotations starting over nodes (e2e).

## [0.1.19] - 2026-05-05

Snapshot ergonomics and reference-doc distribution. Adds `before` /
`after` ISO timestamp filters on snapshot listing across CLI, HTTP,
and MCP, ships the `docs/` reference tree inside the npm tarball so
consumers see the same surface docs as the repo, and surfaces the
existing trace-field flags in `node update --help`. Also lands the
deflake of the MCP-app fullscreen reopen e2e (originally
`LRN-20260505-001`) — 9/20 → 50+/50 stability via a retry-on-stuck-
iframe helper.

### Added

- **`pmx-canvas snapshot list --before / --after`.** Both flags
  accept ISO 8601 timestamps and filter against `snapshot.createdAt`.
  Same surface lands on `GET /api/canvas/snapshots?before=&after=`,
  `RemoteCanvasAccess.listSnapshots()`, and the `canvas_list_snapshots`
  MCP tool schema. The CLI help (`pmx-canvas snapshot list --help`)
  now lists the new flags alongside `--limit`, `--query`, and
  `--all`.
- **`docs/` shipped in the npm tarball.** The package `files`
  allowlist now includes `docs/`, so consumers installing
  `pmx-canvas` see the same `docs/cli.md`, `docs/http-api.md`,
  `docs/mcp.md`, `docs/node-types.md`, and `docs/sdk.md` reference
  files that ship in the repo.
- **`node update --help` advertises trace flags.** The CLI help now
  documents `--tool-name` / `--toolName`, `--category`, `--status`,
  `--duration`, `--result-summary` / `--resultSummary`, and `--error`
  so agents discover trace-field updates without reading the source
  or schema.

### Fixed

- **MCP-app fullscreen reopen e2e is no longer flaky.** The
  visibility check for the fixture editor used to race the ext-app
  bridge handshake — if the iframe started parsing before the
  parent registered its postMessage listener, the iframe's
  `ui/initialize` request was lost and `app.connect()` hung. The
  test now wraps the assertion in a retry-on-stuck-iframe helper
  that closes and reopens the fullscreen overlay (each remount is
  independent of the prior failed handshake), with three 5s
  attempts to match the original 15s budget. Pass rate moved from
  9/20 to 50+/50 consecutive runs.

### Internal

- Regression coverage for: snapshot list before/after filtering at
  the canvas-state layer and through the CLI, snapshot list help
  advertising the new flags, `node update --help` advertising
  trace flags, the `docs/` allowlist entry surviving in
  `package.json` for npm consumers, and the existing arrange
  operation recording as a single undoable history entry.

## [0.1.18] - 2026-05-05

Token-budget polish on top of 0.1.17. Full-mode MCP responses for
hosted external-MCP-app nodes now elide the rendered shell HTML in
favor of a compact `{ omitted, resourceUri, bytes, sha256 }` summary,
so an agent that asks for `full: true` no longer re-receives the same
ext-app shell HTML on every read. Adds a dedicated
`excalidraw-diagram-authoring.md` skill reference and folds the
freehand annotation feature into the README's main feature list.

### Added

- **`serializeCanvasNodeForAgent` / `serializeCanvasLayoutForAgent`.**
  New agent-facing serializers wrap the existing
  `serializeCanvasNode` / `serializeCanvasLayout` helpers and replace
  hosted ext-app shell HTML (`mcp-app` nodes in `ext-app` mode that
  carry a `resourceUri`) with a `{ omitted: 'external-mcp-app-html',
  resourceUri, bytes, sha256 }` descriptor. The MCP server uses
  these wrappers for `canvas_get_node` (full), `canvas_get_layout`
  (full), and the full-payload branch of every add-style response.
  Non-external-app HTML — `html` nodes, bundled web-artifact
  output — is preserved exactly as before.
- **`skills/pmx-canvas/references/excalidraw-diagram-authoring.md`.**
  A 145-line authoring guide for `canvas_add_diagram` covering shape-
  level `label` format, sizing and camera rules, the pastel palette,
  and common pitfalls. The SKILL points to it from the diagram
  guidance section.

### Changed

- **README adds an `03 / Annotate` section.** The annotation feature
  shipped in 0.1.17 is now part of the main README feature list
  alongside Curate / Mix / Control / Save / Any agent. Subsequent
  sections were renumbered (Control your context → 04, Save → 05,
  Any agent → 06).

### Internal

- Regression coverage for: agent-mode node serialization eliding
  hosted ext-app shell HTML, agent-mode layout serialization not
  repeating the ext-app shell across multiple nodes, non-external-
  app HTML payloads being preserved unchanged, and `canvas_get_node`
  / `canvas_get_layout` full-mode elision through the MCP server.

## [0.1.17] - 2026-05-04

Adds a freehand annotation layer so humans can draw directly on the
canvas and agents read compact spatial annotation context (bounds,
target nodes, optional label) without seeing the raw ink. Excalidraw
bound-text → label hoisting now covers the full set of canonical and
shorthand shapes the hosted app emits, and the `html` node type gets
its first-class entry in `canvas_describe_schema` plus a CLI
`--content` alias that maps to `data.html`.

### Added

- **Freehand canvas annotations.** A new top-level annotation layer
  lets humans draw freehand strokes on the canvas with pen and
  eraser tools wired into the toolbar. Annotations live alongside
  nodes and edges in `canvasState` (their own `addAnnotation` /
  `removeAnnotation` history operations), persist into snapshots,
  and are rendered as SVG paths whose default `currentColor` stroke
  follows the active theme via a new `--c-annotation` token.
  Surfaces:
  - HTTP: `POST /api/canvas/annotation`, `DELETE
    /api/canvas/annotation/:id`.
  - MCP: `canvas_remove_annotation` (the canvas now exposes 41 MCP
    tools, was 40).
  - Client: pen / eraser toolbar buttons with theme-aware iconography
    and an `AnnotationLayer` that renders the strokes.
- **Spatial annotation context for agents.** Each pinned-context /
  spatial-context read now includes a compact
  `SpatialAnnotationContext` per annotation: `id`, `label`,
  `bounds`, `targetNodeIds`, `targetNodeTitles`, and `target`
  summary. Agents see what the annotation *circles* (which nodes it
  overlaps), not the freehand path itself, keeping the read budget
  small while still letting the agent act on the human's intent.
- **HTML node schema entry in `canvas_describe_schema`.** The `html`
  node type added in 0.1.15 now appears in the schema tour with a
  documented `html` field, `--content` / `--stdin` aliases, the
  sandboxed-iframe note, and an example payload.
- **CLI `--content` alias for HTML nodes.** `pmx-canvas node add
  --type html --content '<main>Hello</main>'` is accepted as a
  shorthand for setting `data.html` (also supported via `--stdin`).

### Changed

- **Excalidraw bound-text → container label hoisting now covers
  every canonical shape.** The diagram preset
  (`normalizeExcalidrawElementsForToolInput`) hoists text into a
  `rectangle` / `ellipse` / `diamond` container's `label` for all
  four patterns the hosted app emits: the canonical
  `containerId`-pointing text, the centered-container variant,
  pre-existing shorthand labels (preserved as-is), and the
  `boundElements`-only path where the text lacks a back-reference.
  Text alignment and vertical-alignment hints are forwarded into
  the label when present.

### Internal

- Regression coverage for: annotation persistence and removal in
  `canvasState`, annotation undo/redo history operations,
  annotation create/delete over HTTP, html-content CLI alias
  mapping, all four Excalidraw bound-text patterns, html node
  rendering from server state in the browser (e2e), annotation
  theme contrast plus eraser flow (e2e), and annotation toolbar
  actions preserving the active light theme (e2e).

## [0.1.16] - 2026-05-04

Live-context-dock and undo-history hygiene pass on top of 0.1.15. The
context dock now renders the actual pinned nodes instead of falling back
to stale context-card data, auto-focus from ext-app opens stops
polluting undo history, and a couple of HTTP endpoints reject malformed
payloads instead of creating blank or empty nodes.

### Added

- **`ContextNode` renders the active pinned nodes.** A new exported
  `normalizePinnedContextDisplay()` produces a stable `{id, title,
  summary, kind, path}` shape per pinned node, and the component now
  takes a `pinnedNodes` prop. The dock falls back to the previous
  context-card data only when no nodes are pinned, so what the agent
  reads via `canvas://pinned-context` and what the human sees in the
  dock are now the same view.
- **`StatusNode` exposes `getStatusDisplayPhase()` with a documented
  fallback chain.** The display phase falls back `phase → content
  → status → 'idle'` and is shared by the inline node, the summary,
  and any consumer that needs the phase shown to the user.

### Changed

- **`ContextPinBar` is mutually exclusive with the Updates panel.**
  Like the docked context node, the floating pin bar now hides while
  the right-edge attention history panel is open so the two surfaces
  no longer collide on the same anchor.
- **Browser-driven viewport updates support `recordHistory: false`.**
  Client `focusNode(id, options)` and the matching
  `commitViewportWithOptions()` thread an optional
  `{ recordHistory: false }` flag through to `POST
  /api/canvas/viewport`, which now wraps the mutation in
  `withSuppressedRecording` when the flag is set. Auto-focus
  triggered by ext-app opens uses this path so opening an external
  app no longer fills undo history with viewport churn.

### Fixed

- **HTML nodes reject non-string `html` payloads.** `POST
  /api/canvas/node` and the matching MCP path now return a 400
  with a clear error when an html node is created with `html` (or
  `data.html`) set to a non-string value, instead of accepting the
  payload and producing a blank node.
- **Group creation rejects missing child IDs.** `POST
  /api/canvas/group` (and `canvas_create_group`) no longer silently
  creates an empty group when one or more of the requested children
  do not exist; it returns a 400 listing the missing IDs.

### Internal

- Regression coverage for: client status-node display-phase fallback,
  ext-app auto-focus history suppression on the client side, the
  context dock rendering pinned nodes (e2e), HTML-node payload type
  validation over HTTP, group-create child-presence validation over
  HTTP, and the `recordHistory: false` flag on the viewport
  endpoint.

## [0.1.15] - 2026-05-03

A bigger release focused on right-sizing what flows through MCP and the
canvas state file. Adds an `html` node type, sidecar blob storage so
rich ext-app payloads stay out of the main `state.json`, compact-by-
default MCP responses with an opt-in `full` mode, `canvas_gc_snapshots`,
a shared `getCanvasNodeKind` classifier so pinned reads tell agents the
real kind of `mcp-app` subtypes, web-artifact source context for pinned
reads, an extracted demo module, and a five-file `docs/` reference set.
The README, AGENTS.md, and CLAUDE.md catch up to the new shape.

### Added

- **`html` node type and `canvas_add_html_node` MCP tool.** Adds a
  dedicated HTML node renderer that sandboxes user-authored markup in
  an iframe and injects canvas theme tokens (`--c-*` plus
  `--color-*` aliases) so embedded content inherits the theme. Token
  values are sanitized before interpolation. `canvas_add_node` now
  also accepts `type: 'html'` for parity, with `canvas_add_html_node`
  the preferred entry point. MCP tool count is now 40 (was 39).
- **Snapshot list filtering and `canvas_gc_snapshots`.**
  `canvas_list_snapshots` accepts options (`limit`, `before`,
  `after`), and `canvas_gc_snapshots({keep, dryRun})` deletes older
  snapshots while keeping the newest N. CLI `pmx-canvas snapshot
  list` and `pmx-canvas snapshot gc` expose the same surface; HTTP
  endpoints support both.
- **Sidecar blob storage for large ext-app payloads.** When an
  ext-app field on a node would exceed the configured threshold
  (default 2048 bytes; override via
  `PMX_CANVAS_BLOB_THRESHOLD_BYTES`), the value is written to
  `.pmx-canvas/blobs/<sha>.json` and replaced with a checksum
  reference in the main `state.json`. Blob refs are reinflated
  transparently on read, with a checksum-mismatch warning if the
  sidecar file has been tampered with.
- **`getCanvasNodeKind()` shared classifier.** New
  `src/shared/canvas-node-kind.ts` returns
  `'web-artifact' | 'external-app' | 'mcp-app' | <type>` so pinned
  reads, agent context, and CLI output report the real subtype of
  `mcp-app` nodes (web-artifact viewers vs. external apps vs. plain
  hosted content). `canvas://pinned-context` now includes `kind` for
  every node.
- **Web-artifact source context on pinned reads.** When a pinned
  node is a web-artifact, agent context now exposes a bounded source
  summary (`buildWebArtifactSourceContext`): a capped list of source
  filenames plus a truncated preview, instead of inlining the full
  bundled HTML. Total file count is preserved even when the list is
  truncated.
- **Standalone reference docs.** New `docs/cli.md`,
  `docs/http-api.md`, `docs/mcp.md`, `docs/node-types.md`, and
  `docs/sdk.md` document each surface in detail alongside the
  README.
- **Extracted demo module (`src/server/demo.ts`).** The project-tour
  demo seed is now its own module with `seedDemoCanvas()` exported
  and unit-tested, so contributors can read and iterate on the
  demo without spelunking through the server boot path.
- **DockedNode context dock with item-count badge.** The dock
  surfaces a pill with the count of pinned cards plus aux tabs, and
  the dock and the right-edge Updates panel are mutually exclusive
  (one open at a time) so they no longer collide on the same anchor.
- **Trace field aliases on `node update`.** `node update` accepts
  both camel (`--toolName`) and kebab (`--tool-name`) variants for
  trace fields, matching the `node add` flag style.

### Changed

- **MCP responses are compact by default.** `canvas_add_node`,
  `canvas_get_node`, `canvas_get_layout`, and `canvas_batch` now
  return compact node/layout payloads (id, type, position, size,
  pinned, kind, plus a small data digest) by default. Pass
  `full: true` (or `verbose: true`) to opt into the full payload.
  This keeps response token counts stable for agents iterating over
  large boards.
- **README reframed around "moldable canvas" + curation flow.** The
  README opens with a moldable-canvas summary, calls out
  curation-as-communication, and adds two top-level sections:
  `01 / Curate` (drag, group, pin) and `02 / Mix any data source`.
- **AGENTS.md and CLAUDE.md updated for the new tool set.** Both
  guidance files now list `canvas_add_html_node` and
  `canvas_gc_snapshots` and the new `html` node type. Quick-start
  shows `bun run dev:demo` for the project-tour board.

### Internal

- Regression coverage for: snapshot list filtering and gc through
  CLI / HTTP / MCP, blob-sidecar persistence for large ext-app
  payloads with opt-in full reads, pinned-context `kind`
  serialization for native, graph, and mcp-app subtype nodes,
  web-artifact pinned context returning a bounded source-file
  summary instead of bundled HTML, capped source file metadata
  preserving total count, trace field camel/kebab alias forwarding
  on update, demo seeding, and external-app kind serialization
  for pinned context consumers.

## [0.1.14] - 2026-05-02

External-MCP-app and trace-node ergonomics on top of 0.1.13. Trace node
fields land as top-level inputs across CLI / HTTP / MCP / SDK,
`canvas_open_mcp_app` and `canvas_add_diagram` gain `nodeId` for
update-in-place plus `timeoutMs` for cold external servers, expanded
mcp-app frames receive the matching host context, and ext-app result
streaming no longer pollutes undo/redo history.

### Added

- **Trace node fields on the add/update surfaces.** `pmx-canvas node add
  --type trace` now accepts `--toolName`, `--category`, `--status`,
  `--duration`, `--resultSummary`, and `--error` flags. The same fields
  are accepted top-level on `POST /api/canvas/node`, `PATCH
  /api/canvas/node/<id>`, MCP `canvas_add_node`, and SDK
  `PmxCanvas.addNode()`/`updateNode()`. Updates merge per-field through
  `mergeTraceNodeDataFields` so partial patches keep the rest intact.
- **`canvas_open_mcp_app` and `canvas_add_diagram` accept `nodeId` for
  update-in-place.** Passing an existing `mcp-app` ext-app node id
  closes the previous session and reuses the node id, title, and
  geometry instead of creating a new node. Available on MCP, HTTP
  `POST /api/canvas/mcp-app` and `POST /api/canvas/diagram`, and CLI
  `external-app add --node-id` (also `--nodeId` / `--id`).
- **`canvas_open_mcp_app` and `canvas_add_diagram` accept `timeoutMs`.**
  The value is forwarded to the external MCP client's `connect()` and
  `listTools()` calls so cold external app servers don't fail under
  the default request timeout. CLI `external-app add` exposes the
  same flag as `--timeout-ms`. The MCP error message for a
  client-cancelled `canvas_add_diagram` now points users at this
  knob.
- **`pmx-canvas external-app add --elements` alias.** `--elements`
  is now accepted as an alias for `--elements-json`.

### Changed

- **Excalidraw bound text is folded into container labels.** When a
  text element references a container (`containerId`) that supports a
  native label — `rectangle`, `ellipse`, or `diamond` — the diagram
  preset now hoists the text into the container's `label` field
  instead of leaving a separate text element behind. This restores
  the native Excalidraw shape so the hosted app renders the label as
  expected. Other container shapes still keep bidirectional
  `boundElements` references.
- **Expanded mcp-app frames receive `fullscreen` host context.**
  `ExpandedNodeOverlay` now passes `expanded={true}` to `McpAppNode`
  for `mcp-app`, `json-render`, and `graph` nodes; `ExtAppFrame`
  forwards it to the bridge as a `host-context-change` so external
  apps know when they're rendered fullscreen versus inline.

### Fixed

- **Ext-app runtime result streaming no longer pollutes undo/redo.**
  Streaming HTML updates and result-handling for hosted external apps
  now run through `canvasState.withSuppressedRecording()` so undo no
  longer needs to walk through every intermediate ext-app html
  patch. Opening an ext-app remains a user-visible history step.

### Internal

- Regression coverage for: trace fields landing on add and patch
  through CLI / HTTP / MCP, Excalidraw bound-text → container label
  hoisting (including centered container text), `external-app add`
  accepting the `--elements` alias and an existing node target,
  `canvas_add_diagram` updating an existing Excalidraw node in
  place, and ext-app result streaming preserving redo history after
  an undo.

## [0.1.13] - 2026-05-02

Live-collaboration polish on top of 0.1.12. Server-driven SSE updates no
longer reset the user's viewport, the MCP server hot-promotes itself to
a daemon-backed access when one shows up later, agent-authored trace
nodes get first-class schema for the fields the renderer reads,
`canvas_batch` exposes partial-failure envelopes and bare-step refs,
`canvas_restore` returns a compact summary, and the web-artifact init
path stops leaking macOS `sed -i ''` backup files into Linux projects.

### Added

- **First-class trace node fields in `canvas_describe_schema`.** The
  trace `add` schema now lists `toolName`, `category`, `status`,
  `duration`, `resultSummary`, and `error` as documented optional
  fields, with the same defaults the renderer uses. Trace rendering was
  also extracted to `src/client/nodes/trace-model.ts` so the
  field-fallback contract is unit-testable.
- **MCP can hot-promote to a daemon.** `refreshCanvasAccess()` is
  exported from the canvas-access module and called on every
  `ensureCanvas()` after the first. If a workspace canvas daemon comes
  online after the MCP server started in local mode, the MCP switches
  to the remote backend without losing its tool registration. Resource
  notifications now track local vs remote subscriptions independently
  so a refresh does not double-subscribe.
- **Web-artifact build response carries a completion timestamp.**
  `WebArtifactCanvasBuildResult` and the `/api/canvas/web-artifact`
  HTTP response now include `completedAt` (ISO 8601) so agents that
  trigger long builds can correlate their request with the response.
- **`canvas_build_web_artifact` schema documents `timeoutMs` and cold-
  build behavior.** The schema lists `timeoutMs` as the subprocess
  timeout (distinct from the MCP client request timeout) and adds a
  note that cold builds can exceed the default 60s MCP client timeout.

### Changed

- **Server SSE layout updates no longer clobber the user's pan/zoom.**
  `applyServerCanvasLayout` only re-applies the server viewport when
  the caller explicitly opts in via `{ applyViewport: true }`. The
  `canvas-layout-update` SSE handler now only opts in on the very
  first layout sync; later updates from agent or HTTP mutations leave
  the user's current viewport alone.
- **`canvas_restore` returns a compact summary instead of the full
  layout.** Restoring a snapshot now responds with `{ok, restored,
  summary: { ... }}` containing node and edge counts, pinned ids, and
  group counts. Use `canvas_get_layout` afterwards if the full layout
  is needed.
- **`canvas_batch` exposes partial-failure envelopes.** When the batch
  endpoint returns a structured failure body (HTTP non-2xx with an
  object payload), the MCP tool surfaces that body to the caller
  instead of throwing. Bare `$step` references in batch payloads now
  resolve to that step's `id`, matching the ergonomic
  `{from: '$step1', to: '$step2'}` pattern.
- **Diagram preset keeps Excalidraw text elements as text.** The
  bound-text → container `label` conversion added in 0.1.10 has been
  removed; text elements now stay as text elements while
  `boundElements` references are kept bidirectional, restoring the
  Excalidraw-native shape the MCP app expects.

### Fixed

- **`init-artifact.sh` no longer leaks literal `''` backup files on
  Linux.** The script now wraps `sed -i` in a `sed_in_place` function
  that picks the right syntax per OS instead of relying on a
  `$SED_INPLACE` variable that contained a literal empty argument on
  macOS and broke under word-splitting on Linux.
- **Web-artifact build cleans up pre-existing literal `''` files.**
  Reusable build projects scaffolded by older versions of the init
  script may still carry `index.html''`-style stragglers. The bundle
  step now removes any literal-`''`-suffixed files in the project
  directory before delegating to Parcel.

### Internal

- Regression coverage for: trace-model field fallbacks, applying server
  layouts without auto-applying viewport plus the explicit
  initial-sync path, MCP local→remote daemon promotion, `canvas_batch`
  bare-ref resolution and partial-failure envelopes, `canvas_restore`
  compact summary shape, Excalidraw bound-text repair without dropping
  text elements, and the `init-artifact.sh` sed-backup cleanup.

## [0.1.12] - 2026-05-02

MCP/canvas state-sharing pass on top of 0.1.11. The MCP server now
attaches to an already-running canvas daemon for the current workspace
instead of spinning up a parallel in-process state, so HTTP-created
nodes and browser pins show up immediately in MCP responses and emit
the matching resource notifications. The SDK's port binding is also
hardened so explicit `port:` requests no longer silently land on a
fallback port.

### Added

- **`startCanvasServer({ allowPortFallback: false })` and SDK port
  determinism.** The HTTP server option lets callers opt out of the
  fallback-port walk. The Bun SDK's `PmxCanvas.start()` and
  `PmxCanvas.startAutomationWebView()` now pass this flag, so when an
  SDK consumer says `createCanvas({ port: 4313 })` they either bind to
  4313 or fail loudly — preventing two SDK instances or an SDK + a
  daemon from racing onto silently different ports.
- **`CanvasAccess` abstraction with local + remote backends.** A new
  `src/mcp/canvas-access.ts` module defines the interface the MCP
  server uses to talk to canvas state. `LocalCanvasAccess` wraps an
  in-process `PmxCanvas` (legacy behavior); `RemoteCanvasAccess` talks
  to an existing daemon over HTTP and consumes its SSE stream. The
  factory probes for an existing canvas server in the workspace before
  starting a new one.

### Changed

- **MCP server defers to an existing canvas daemon as the state
  authority.** When `pmx-canvas --mcp` boots in a workspace that
  already has a canvas server running on the agreed port, the MCP
  process now reads and writes through that daemon's HTTP API instead
  of starting its own canvas. Nodes created via the daemon's HTTP API
  (or by a human in the browser) are visible to MCP queries
  immediately, and SSE events from the daemon are translated into
  MCP `notifications/resources/updated` calls for `canvas://layout`,
  `canvas://summary`, `canvas://spatial-context`, `canvas://history`,
  `canvas://code-graph`, and `canvas://pinned-context`.

### Internal

- Regression coverage for: `canvas_add_node` strict-size persistence
  through MCP, an MCP session using an existing daemon as the state
  authority for HTTP-created nodes, and HTTP node creation broadcasting
  a live `canvas-layout-update` SSE event.

## [0.1.11] - 2026-05-02

Agent ergonomics + chart polish on top of 0.1.10. Adds a `--strict-size`
mode for nodes that should scroll instead of auto-fit, surfaces
`pmx-canvas json-render` and `pmx-canvas screenshot` as top-level CLI
shortcuts, lets graph nodes hide legends and pie labels for compact
tile layouts, propagates explicit geometry to reused MCP-app nodes, and
folds Excalidraw bound text into container labels before sending it
through the diagram MCP.

### Added

- **`--strict-size` / `--scroll-overflow` for node create and update.**
  All node types now accept `strictSize` to keep the explicit
  `width`/`height` frame fixed and scroll overflowing content instead of
  letting the canvas auto-fit the node to its content. Surfaced through
  CLI flags, HTTP `POST/PATCH /api/canvas/node`, dedicated json-render
  and graph endpoints, and MCP tools (`canvas_add_node`,
  `canvas_add_json_render_node`, `canvas_add_graph_node`).
  `canvas_describe_schema` and `canvas://schema` advertise the field on
  markdown, webpage, and graph entries with kebab-case aliases.
- **`pmx-canvas json-render` top-level CLI command.** Agent-friendly
  shortcut for the json-render schema/example explorer. Supports
  `--schema`, `--summary`, `--component <name>`, `--field <name>`, and
  `--example`/`--examples`, mirroring the existing `node schema --type
  json-render` data in a more direct shape.
- **`pmx-canvas screenshot` top-level CLI command.** Shorthand for
  `pmx-canvas webview screenshot`, with the same `--output`,
  `--format`, and `--quality` flags. Routes through the agent CLI like
  the other top-level subcommands.
- **`showLegend` / `showLabels` chart display flags.** Graph node
  payloads now accept `showLegend` and `showLabels` booleans that
  cascade through CLI (`--show-legend`, `--show-labels`), HTTP, MCP,
  and the json-render chart components. Set `showLegend: false` for
  compact tile dashboards or `showLabels: false` to hide pie slice
  labels.
- **Skill catches up to the new CLI surface.** The agent-facing
  `skills/pmx-canvas/SKILL.md` now documents `pmx-canvas screenshot`,
  `pmx-canvas json-render`, the `--strict-size` flag, and the chart
  display flags, so agents do not have to discover them by reading the
  CHANGELOG.

### Changed

- **Reused MCP-app nodes accept explicit geometry on reopen.** When
  `canvas_open_mcp_app` (or the workbench `ext-app-open` SSE event)
  reopens an existing mcp-app node and the call passes `x`, `y`,
  `width`, or `height`, the server now applies that geometry to the
  existing node instead of leaving the original frame in place. This
  lets agents resize a previously created Excalidraw or other reusable
  app node with a single call.
- **Compact json-render charts trim whitespace.** Bar, line, area,
  scatter, pie, radar, stacked-bar, and composed charts share new
  `chartMargin`, `polarChartMargin`, `axisTickMargin`, and
  `legendMargin` constants, so axis ticks and legends sit closer to the
  plot and small graph nodes keep more of their frame for the actual
  chart.
- **Diagram preset folds bound text into container labels.** The
  Excalidraw normalization path now collapses `text` elements that
  reference a container into the container's `label` field (when the
  container does not already carry a label) and removes the redundant
  text element from the outgoing payload. This produces the in-shape
  labels Excalidraw renders by default while still keeping the
  bound-element references repaired from 0.1.10. The same normalization
  also runs through `buildExcalidrawOpenMcpAppInput` so MCP `open`
  payloads are repaired identically to checkpoint and tool-input
  payloads.
- **Diagram preset seeds defaults when nothing renderable is present.**
  An elements array containing only deletion or camera-update entries
  (or stale ghosts) now falls back to the default Excalidraw preset
  instead of being sent as an empty diagram.

### Internal

- Regression coverage for: `--strict-size` end-to-end through CLI,
  HTTP, and MCP plus the auto-fit guard that keeps strict-size content
  nodes from being auto-fitted; top-level CLI routing for `screenshot`
  and `json-render`; compact graph specs that hide legends and pie
  labels; reused mcp-app open with explicit geometry; Excalidraw
  defaults for non-renderable element arrays; shared MCP open
  normalization through the diagram-preset path.

## [0.1.10] - 2026-05-01

Agent-ergonomics and correctness pass on top of 0.1.9. Tightens
structured-frame auto-fit behavior, restores semantic Badge variants in
json-render, repairs Excalidraw bound-text references on the way out,
fixes `pmx-canvas fit` routing through the top-level CLI, and grows the
`node update` surface with `--pinned` and `--node-height`.

### Added

- **`pmx-canvas node update --pinned <true|false>`.** Agents can flip a
  node's pin state directly through `node update` without round-tripping
  through `pin add`/`pin remove`. The flag goes through the same
  PATCH path as the rest of `node update`, so it composes with geometry
  and arrange-lock flags.
- **`pmx-canvas node update --node-height` alias.** `--node-height` is now
  accepted as an alias for `--height` on `node update`, matching the
  alias already supported on `node add`. Passing both `--height` and
  `--node-height` rejects with a clear error.
- **AGENTS.md mirrors CLAUDE.md for harness-agnostic guidance.** The
  AGENTS.md guidance file is now a complete, self-contained mirror of
  the project instructions in CLAUDE.md so any coding agent harness
  finds the same architecture rules, TypeScript guardrails, build
  commands, and testing conventions.

### Changed

- **`pmx-canvas fit` routes through the top-level CLI.** The `fit`
  subcommand was added to the agent dispatcher in 0.1.9 but was missing
  from the top-level CLI's known-subcommand list, so `pmx-canvas fit`
  was being treated as a server-startup invocation. It now routes to
  the agent CLI like every other subcommand.
- **All explicit graph and json-render frames are preserved by auto-fit.**
  The client-side auto-fit guard previously only respected explicit
  heights when they exceeded the 600px content-fit cap. It now treats
  all `graph` and `json-render` nodes as having explicit visual frames,
  so agent-authored sizes survive expand-and-close cycles regardless of
  the chosen height.
- **json-render Badge keeps semantic variants.** The 0.1.6 normalizer
  that mapped `success`/`info`/`warning`/`error`/`danger` to the
  shadcn-default `default`/`secondary`/`outline`/`destructive` set has
  been removed. The json-render catalog now declares these variants as
  first-class, and the bundled renderer ships a Badge component that
  styles them, so dashboards keep their intended traffic-light
  semantics instead of collapsing to a generic neutral palette.

### Fixed

- **Group containment accepts the canonical children list.** Layout
  validation flagged group/child overlaps as containment violations
  whenever the child only carried `parentGroup` via the parent's
  `children` array instead of the back-reference field. The check now
  treats either side of the relationship as authoritative, so grouped
  nodes pinned via `data.children` are no longer reported as overlap
  violations.
- **Excalidraw tool input repairs one-sided bound-text references.**
  When a text element points at a container via `containerId` but the
  container's `boundElements` list is missing the reverse pointer, the
  diagram preset now reattaches the missing reference before sending
  the elements to the Excalidraw MCP app. This stops labels from
  silently dropping out of agent-authored diagrams.

### Internal

- Regression coverage for: structured-frame auto-fit preservation across
  graph and json-render heights (including small frames), `node update
  --pinned` end-to-end through CLI/HTTP, top-level CLI routing for the
  `fit` subcommand, group-children list containment validation, and
  Excalidraw bound-text repair on the diagram preset.

## [0.1.9] - 2026-05-01

Workflow ergonomics pass for agent-authored boards. This release tightens
geometry contracts, adds in-place structured-node updates, and gives agents a
first-class viewport fit operation for screenshot/review flows.

### Added

- **`pmx-canvas fit`, `POST /api/canvas/fit`, and `canvas_fit_view`.** Agents
  can fit the server viewport to the whole canvas or selected node IDs using
  consistent width/height/padding/max-scale options before screenshots or
  whole-board review.
- **In-place json-render and graph updates.** `node update --spec-file`, HTTP
  `PATCH /api/canvas/node/<id>`, and MCP `canvas_update_node` can update
  json-render specs and graph datasets/configuration without replacing the
  node, preserving IDs, edges, pins, and placement.
- **Nested `node` payloads on node create/update responses.** Node responses now
  include `node: { ...serializedNode }` while retaining the existing flat
  `id`, `position`, `size`, and data fields for compatibility.
- **README adds reference sections for image nodes and `pmx-canvas watch`.**
  The README now lists all four control surfaces (CLI, MCP, HTTP, Bun SDK)
  side-by-side, documents the image node payload with provenance and
  validation metadata, documents `pmx-canvas watch` semantic deltas, and
  notes that bundled skills are readable as MCP resources at
  `canvas://skills/<name>`.

### Changed

- **HTTP node geometry accepts flat and nested shapes.** Create/update paths now
  accept both `{ x, y, width, height }` and `{ position, size }`, with invalid
  sizes still rejected instead of silently ignored.
- **Graph/json-render explicit heights are preserved in the canvas renderer.**
  The client no longer auto-shrinks large explicit structured-node frames to the
  generic 600px auto-fit cap.
- **MCP schema metadata advertises update and fit tools.** `canvas_describe_schema`
  and `canvas://schema` include `canvas_update_node` and `canvas_fit_view` in
  the tool list.
- **Agent-facing `skills/pmx-canvas/SKILL.md` documents the new operations.**
  The skill now covers `canvas_fit_view`, the `node update --spec-file` flag for
  in-place json-render updates, the per-graph-field flags for in-place graph
  rebuilds, the `chartHeight` vs `height`/`nodeHeight` distinction, and a
  caveat that `canvas_evaluate` scripts should not call PMX HTTP APIs via
  `fetch()` (use the matching MCP tools instead).

### Fixed

- **Embedded Excalidraw previews receive unscaled host dimensions.** The ext-app
  host now reports layout dimensions instead of canvas-zoomed bounding boxes, so
  text inside diagram boxes remains visible in inline previews instead of only
  appearing after expansion.

### Internal

- Regression coverage for HTTP/CLI/MCP fit-view parity, nested geometry inputs,
  json-render and graph in-place updates, richer node response payloads, and the
  structured-node auto-fit height guard. Ext-app host sizing now also covers the
  zoomed-canvas case that affected embedded Excalidraw previews.
- Published-consumer e2e harness swaps the Bun stdin parser for `python3` for
  portability across hosts.
- Web-artifact reusable build project no longer commits its Parcel cache.
  `.parcel-cache` is now gitignored and the previously committed copy was
  removed; CI no longer inherits a stale cache that prevented Parcel from
  producing `dist/index.html` for the SDLC Control Room showcase build.

## [0.1.8] - 2026-04-25

Retest-driven follow-up to 0.1.7. This next release restores compatibility
for image and json-render node creation, fixes the counter MCP fixture's
accidental iframe overflow, and syncs packaged testing guidance with the
canonical repo skill.

### Fixed

- **Image `path` is accepted as a compatibility alias for `content`.**
  `pmx-canvas node add --type image --path <file>`, HTTP
  `/api/canvas/node` payloads with `{ type: "image", path }`, and MCP
  `canvas_add_node({ type: "image", path })` now all validate the file
  and populate `data.src` instead of creating an empty/broken image node.
- **json-render creation keeps 0.1.7 compatibility.**
  `canvas_add_json_render_node`, `POST /api/canvas/json-render`, and
  CLI `node add --type json-render` accept omitted titles and infer a
  node title from the root element. Bare legacy component specs like
  `{ type: "Badge", props: {...} }` are wrapped into a one-element
  document before validation, while complete `{ root, elements }` specs
  remain the canonical shape.
- **Counter MCP fixture no longer creates a scrollable iframe by
  accident.** The fixture now uses border-box sizing and hides root
  overflow so `100vh` layouts with padding do not become `100vh +
  padding`. This removes the observed repeated downward scroll in the
  counter app and adds browser coverage for zero iframe body overflow.

### Changed

- **Packaged PMX Canvas testing skill is back in sync with canonical
  guidance.** It now documents that `test:coverage` covers only the Bun
  unit suite, names the coverage artifact, and calls out the WebView
  automation timeout caveat used to distinguish environment limits from
  product regressions.
- **Schema metadata for the `path` alias and relaxed json-render contract
  is version-stable.** `canvas_describe_schema` and `canvas://schema`
  surface the image `path` alias and `title.required: false` on
  json-render so agents discover the new shapes without reading the
  CHANGELOG.
- **Agent-facing `skills/pmx-canvas/SKILL.md` documents the same
  contract.** The skill now describes the `path` alias for image nodes
  and the relaxed json-render contract (omitted titles, bare component
  specs) so agents do not need to retry across shapes.

### Internal

- Regression coverage for image `path` alias handling across CLI/HTTP/MCP,
  json-render compatibility for omitted titles plus bare component specs,
  and hosted counter MCP app iframe overflow.

## [0.1.7] - 2026-04-26

Small retest-driven follow-up to 0.1.6. Three agent-facing ergonomics:
`canvas_evaluate` now accepts top-level `await`, snapshot responses gain
a flat `id` alias for add-style consistency, and the PMX Canvas skill
documents real DOM selectors plus several quirks an agent would
otherwise have to discover by trial and error.

### Added

- **Snapshot save responses include a flat `id` alias.** Both
  `canvas_snapshot` and `POST /api/canvas/snapshots` still return the
  nested `snapshot` object, and now also include `id: snapshot.id` at
  the top level — same shape as every other add-style response in the
  canvas API. HTTP and MCP surfaces are aligned.

### Changed

- **`canvas_evaluate` script mode supports top-level `await`.** Both
  MCP and HTTP WebView script mode wrap multi-statement bodies in an
  async IIFE and serialize the resolved return value, so an agent can
  write `const r = await fetch(...); return r.json();` directly without
  scaffolding the wrapper itself. WebView script documentation now
  describes the async behavior explicitly.
- **PMX Canvas skill docs now ship a defensive ID extractor pattern.**
  The skill recommends `r.id ?? r.nodeId ?? r.snapshot?.id` so agents
  pull the right id field across add-style, web-artifact, and snapshot
  responses without branching per tool.
- **PMX Canvas skill docs name the real WebView CSS selectors.** The
  bundled skill calls out `.canvas-node`, `.hud-layer`,
  `.canvas-toolbar`, `.connection-dot`, and related classes, and is
  explicit that nodes do **not** expose stable `data-node-id`
  attributes — agents driving the canvas via `canvas_evaluate` no
  longer have to discover selectors by trial and error.
- **PMX Canvas skill edge docs list the valid edge types.** `flow`,
  `depends-on`, `relation`, `references` — same as the rest of the
  surface but now explicit in the skill so the agent doesn't guess.
- **PMX Canvas skill diagram docs clarify
  `canvas_add_diagram.elements`.** The field expects Excalidraw element
  objects (rectangles, ellipses, arrows with bindings, labels), not
  Mermaid / DOT / Graphviz source text or any other diagram DSL.

### Internal

- Regression coverage for snapshot flat-`id` aliases on both MCP and
  HTTP surfaces, plus async / top-level-`await` WebView script bodies.

[0.1.31]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.31
[0.1.30]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.30
[0.1.29]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.29
[0.1.28]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.28
[0.1.27]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.27
[0.1.26]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.26
[0.1.25]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.25
[0.1.24]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.24
[0.1.23]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.23
[0.1.22]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.22
[0.1.21]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.21
[0.1.20]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.20
[0.1.19]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.19
[0.1.18]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.18
[0.1.17]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.17
[0.1.16]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.16
[0.1.15]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.15
[0.1.14]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.14
[0.1.13]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.13
[0.1.12]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.12
[0.1.11]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.11
[0.1.10]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.10
[0.1.9]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.9
[0.1.8]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.8
[0.1.7]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.7

## [0.1.6] - 2026-04-26

CLI/MCP regression cleanup after the 0.1.5 coverage pass. This release tightens
graph creation routing, restores legacy json-render Badge compatibility, and
makes MCP node creation routes explicit enough for agents to recover from schema
drift without guessing.

### Added

- **Top-level `pmx-canvas graph add`.** This now routes through the agent CLI
  and creates graph nodes via the same HTTP path as the canonical
  `pmx-canvas node add --type graph ...` command, instead of falling through to
  server startup.
- **MCP node-type routing metadata.** `canvas_describe_schema` and
  `canvas://schema` now expose `mcp.nodeTypeRouting`, so agents can discover
  that `json-render`, `graph`, `web-artifact`, `external-app`, and `group`
  use dedicated creation tools instead of guessing `canvas_add_node`.
- **MCP schema entry for `external-app`.** The running schema now lists
  `external-app` as a virtual node family backed by `canvas_open_mcp_app`, with
  notes pointing Excalidraw callers to the higher-level `canvas_add_diagram`
  preset.
- **`mcpTool` field on every node-type schema entry**, plus
  `canvas_open_mcp_app` and `canvas_create_group` added to the published
  `mcp.tools` array — both surfaces help an agent discover the right tool for
  each canvas operation without guessing.

### Changed

- **Graph height semantics are documented consistently across surfaces.** For
  CLI graph commands, `--node-height` / `--nodeHeight` set the canvas node frame
  height, `--chart-height` sets the chart content height, and `--height` remains
  a compatibility alias for frame height. For MCP/HTTP/batch payloads,
  `nodeHeight` is frame height and `height` is chart content height.
- **PMX Canvas skill guidance now includes MCP-specific gotchas.** The bundled
  skill documents the MCP node-type routing table, `canvas_open_mcp_app`
  transport requirements, `canvas_build_web_artifact` source-string behavior and
  cold-build timeout expectations, `canvas_pin_nodes.nodeIds`, and the required
  `canvas_diff.snapshot` argument.
- **Legacy `props.label` is removed from Badge specs after normalization.** The
  validated/persisted spec now carries exactly one of `text` or `label`, never
  both — a stricter future validator can flag the legacy key without breaking
  saved canvases written before this release.
- **`canvas_build_web_artifact` `id` alias is conditional.** When
  `openInCanvas` is `false` (or no canvas node was created), the `id` field is
  omitted from the response instead of being `undefined`. Consumers can now
  reliably use `'id' in response` to detect the build-only case. `nodeId` is
  always present and remains the canonical identifier.
### Fixed

- **`pmx-canvas graph add` no longer starts a rogue server.** The top-level
  command is registered with the agent CLI, so malformed or valid graph commands
  cannot fall through to server startup and leak a fallback daemon.
- **Legacy json-render `Badge` specs are accepted again.** Saved specs using
  `props.label` now normalize to `props.text`, and legacy status variants
  (`success`, `info`, `warning`, `error`, `danger`) normalize to the current
  shadcn Badge enum before validation.
- **Web-artifact build responses include `id` (alias for `nodeId`) when a
  canvas node was created.** Keeps MCP/HTTP add-style responses consistent.
- **Graph CLI node-height aliases now work.** `--node-height` and
  `--nodeHeight` set the canvas node frame height, `--chart-height` sets the
  chart content height, and CLI `--height` remains a compatibility alias for
  the frame height.

### Internal

- Regression coverage for top-level graph CLI routing, graph height flags,
  legacy Badge normalization (now including `info → secondary` and
  `error → destructive` plus the post-normalization `label` removal), MCP
  node-type routing metadata, and web-artifact response ID aliases.

[0.1.6]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.6

## [0.1.5] - 2026-04-26

Image-validation hardening + CLI ergonomics. The boundary where untrusted
file paths become canvas state now validates magic bytes, and common CLI
typos produce one-line suggestions instead of help-block dumps.

### Added

- **Magic-byte validation for local image nodes.** PNG / JPEG / GIF / SVG /
  WebP / BMP / ICO / AVIF headers are sniffed before a file becomes an
  `image` node. A file renamed `screenshot.png` containing PowerPoint XML
  is now rejected with a clear error before it reaches the renderer.
- **macOS cloud-on-demand placeholder detection.** Files in iCloud Drive,
  OneDrive, etc. that are not yet downloaded locally are detected via
  `stat -f %Xf` flags and rejected with a hint to download them first —
  no more silent freezes when an iCloud-only file is dropped on the canvas.
- **`/bin/dd` escape hatch with a 5s timeout** for macOS-only paths where
  the direct fs read could hang on an unresponsive volume (e.g. an
  unmounted SMB share that still satisfies `existsSync`). Distinguishes
  timeout (`SIGTERM` / `ETIMEDOUT`) from generic spawn failures so the
  cloud-storage hint isn't shown for unrelated errors.
- **CLI typo hints for resource subcommands.**
  - `pmx-canvas node delete <id>` and `pmx-canvas node rm <id>` exit 1 with
    `Did you mean: pmx-canvas node remove?`.
  - `pmx-canvas edge delete <id>` and `pmx-canvas edge rm <id>` get the
    same treatment.
  - `pmx-canvas node pin <id>` redirects to the top-level
    `pmx-canvas pin <id>` command.

### Changed

- **`GET /api/canvas/image/:id` is now async** (`fs/promises.readFile`) and
  validates content before serving — returns **400** on invalid image bytes
  instead of 200 with `application/octet-stream`.
- **Bare `pmx-canvas node` (no subcommand)** now exits 1 with structured
  JSON instead of printing the resource help block. Use
  `pmx-canvas node --help` for the listing.

### Internal

- New module `src/server/image-source.ts` extracts and extends image
  validation from `canvas-operations.ts`. Same error contract; richer
  checks. The MCP and HTTP layers both flow through `addCanvasNode`, so
  CLAUDE.md rule #5 (four-layer parity) is preserved without touching
  the SDK or MCP server.
- Direct fs read is the fast path on every platform (no fork, no shell);
  `dd` is only consulted on macOS as a fallback when direct read fails on
  a path that wasn't flagged as a placeholder.
- Real magic-byte fixtures in `tests/unit/canvas-operations.test.ts` (was:
  `*.png` extension smoke tests). New HTTP coverage in
  `tests/unit/server-api.test.ts` for valid / invalid / missing image
  paths. New CLI coverage for `node delete`, `node pin`, `edge delete`,
  `edge rm` typo hints.

[0.1.5]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.5

## [0.1.4] - 2026-04-26

Graph/CLI ergonomics + canvas-node taxonomy hardening. Three threads:
(1) full graph payload surface (`zKey`, `axisKey`, `metrics`, `series`,
`barKey`/`lineKey`, `barColor`/`lineColor`) reaches CLI/MCP/HTTP/batch with
both kebab-case and camelCase flag aliases, (2) `mcp-app` nodes serialize a
`kind` discriminator so agents can target `web-artifact` / `external-app` /
`mcp-app` subtypes without inspecting `data`, (3) the long-standing
`ext-app-ext-app-…` double-prefix bug on node IDs is fixed with explicit
`nodeId` propagation through SSE.

### Added

- Serialized `kind` discriminator on every canvas node. `mcp-app` nodes now
  surface as `web-artifact`, `external-app`, or `mcp-app` so agents can
  filter via `node list --type web-artifact` or
  `--type external-app` directly.
- Full graph payload surface on MCP, HTTP `validate-spec`, and `batch`:
  `zKey`, `axisKey`, `metrics`, `series`, `barKey`, `lineKey`, `barColor`,
  `lineColor`. Radar (`metrics`), stacked-bar (`series`), and composed
  (`barKey`/`lineKey`) configs are now uniformly addressable.
- CLI camelCase aliases for graph flags: `--graphType`, `--xKey`, `--yKey`,
  `--zKey`, `--axisKey`, `--barKey`, `--lineKey`, `--barColor`,
  `--lineColor`, alongside existing kebab-case forms. Same fields land in
  `canvas_validate_spec` and `canvas_batch`.
- `id` field on `external-app add` / `canvas_open_mcp_app` /
  `canvas_add_diagram` responses (alias for the canvas node ID, matches
  HTTP).
- `viewerType: 'web-artifact'` persisted on web-artifact mcp-app nodes for
  authoritative `kind` classification.

### Changed

- `SerializedCanvasNode` now includes `kind: string` (additive; consumers
  grouping by `type === 'mcp-app'` should switch to `kind`).
- `canvas://summary` `typeCounts` keys are derived from `kind`, not `type` —
  `mcp-app` totals split into `web-artifact` / `external-app` / `mcp-app`.
- Charts wrap with type-specific CSS modifier classes
  (`pmx-chart--line/--bar/--pie/--area/--scatter/--radar/--stacked-bar/--composed`)
  and per-type minimum widths, so axes don't clip in narrow nodes.
- `canvas-schema.ts` cleanup based on the v0.1.4 review:
  - `nodeHeight` no longer aliases `height` (collision with the chart-content
    `height` field). Use `--node-height` going forward; `--height` always
    means chart content height.
  - `stdin` removed from the `data` and `appTsx` aliases — `--stdin` is an
    input-mode (read from pipe), not a flag synonym. Behavior unchanged;
    schema is now accurate.

### Fixed

- Excalidraw / external-app node IDs no longer double-prefix to
  `ext-app-ext-app-…`. The canvas node ID retains the `ext-app-` prefix; the
  `toolCallId` is the random suffix only.
- SSE `ext-app-open` / `ext-app-update` / `ext-app-result` events now carry
  an explicit `nodeId` so the client and server agree on node identity even
  after the ID-format change.
- `getCanvasNodeKind` precedence reordered so a future URL-only web-artifact
  (no `data.path`) still classifies correctly via `viewerType`. The legacy
  `hostMode + path` heuristic is now an explicitly-documented backwards-compat
  fallback for canvas state.json files persisted before v0.1.4.

### Internal

- `findCanvasExtAppNodeId` extracted into `src/server/ext-app-lookup.ts` and
  shared between `src/server/index.ts` and `src/server/server.ts` (was
  duplicated; drift risk eliminated).
- `shouldReplayAppToolResult` documented with explicit intent: only `isError`
  or `structuredContent` results overwrite the bootstrap-replay
  `toolResult`, so a plain-text `read_checkpoint`-style return doesn't
  clobber widget state on reload.
- E2E coverage now exercises camelCase graph flags and asserts the
  single-prefix node-ID fix.
- New unit coverage:
  - `kind` discriminator across fresh, URL-only, legacy, ext-app, and
    plain-mcp-app paths (6 tests).
  - Camel-case graph flags in CLI.
  - Full-surface graph validation in MCP `canvas_validate_spec`.
  - Single-prefix node-ID round-trip in `external-app add`.
  - Post-restart text-tool replay semantics.

[0.1.4]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.4

## [0.1.3] - 2026-04-25

CLI hardening release with full MCP parity for the new affordances. Closes
gaps surfaced by the v0.1.2 fresh-install E2E (silent web-artifact failures,
generic `mcp-app` confusion, viewport-hijacking focus), persists Excalidraw
edits across iframe remounts, and ships a new `test:e2e-cli` coverage eval.

### Added

- `pmx-canvas external-app add --kind excalidraw` for tool-backed Excalidraw
  nodes, with optional `--elements-json` / `--elements-file` / position +
  size flags.
- `pmx-canvas web-artifact build --deps <csv|json>` and matching HTTP
  `deps?: string[]` for adding npm dependencies before bundling. Validated
  against npm-name format; flags and shell metacharacters are rejected. The
  web-artifact scaffold now bundles `recharts` by default.
  **MCP:** `canvas_build_web_artifact` accepts `deps` for parity.
- `pmx-canvas focus <id> --no-pan` (and HTTP `noPan: true`) selects/raises
  a node without moving the viewport. The HTTP response gains
  `panned: boolean`; the SSE `canvas-focus-node` event payload gains
  `noPan`. **MCP:** `canvas_focus_node` accepts `noPan` for parity. **SDK:**
  `c.focusNode(id, { noPan? })` returns `{ focused, panned } | null`.
- `pmx-canvas node add --type graph --data <json>` as an alias for
  `--data-json`.
- `bun run test:e2e-cli` (`scripts/e2e-cli-coverage.sh` +
  `docs/evals/e2e-cli-coverage.md`) — fresh-workspace CLI coverage eval.
- `skills/pmx-canvas/references/installing-pmx-canvas.md` install reference
  for first-run agents.

### Changed

- `pmx-canvas node add --type mcp-app …` is now rejected with guidance
  pointing at `web-artifact build` or `external-app add` instead of creating
  an empty node.
- `pmx-canvas web-artifact build` exits non-zero with `ok: false` JSON on
  bundle failure and does not create a canvas node.
- `pmx-canvas status` buckets hosted artifact `mcp-app` nodes under
  `web-artifact`.
- Grid arrange spaces columns by the widest movable node so wide artifacts
  do not overlap; `POST /api/canvas/arrange` returns `validation` +
  `collisions` when the resulting layout has overlaps.

### Fixed

- Excalidraw edits made in fullscreen are now persisted into a replayable
  `toolResult` and survive iframe remounts
  (`POST /api/ext-app/model-context`).
- Web-artifact builds fail loudly instead of emitting a zero-byte HTML when
  Parcel/html-inline produce empty output (`bundle-artifact.sh` exits early
  on missing/empty Parcel output).

### Internal

- Web-artifact dep installer now uses `bash -c` instead of `bash -lc`, so
  the user's login profile (`~/.bashrc`/`~/.zshrc`) cannot perturb installs.
- Removed the redundant post-copy bundle-size check (the script-side check
  already guarantees a non-empty source; CLAUDE.md TypeScript Guardrail #3).
- New unit coverage in `cli-node`, `server-api`, `web-artifacts`, and
  `canvas-operations` test suites.

[0.1.3]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.3

## [0.1.2] - 2026-04-24

Follow-up to 0.1.1 driven by fresh-install review feedback. Two validation /
UX bugs, one long-tail stability fix in the MCP App host, plus new agent
ergonomics (version flag, skill discovery).

### Added

- **`pmx-canvas --version` / `-v`.** Prints the installed package version and
  exits. Version is read from the sibling `package.json` so it stays accurate
  whether the CLI is invoked via `bunx`, a global npm install, or a repo-local
  `bun run` — no hard-coded string, no build step required.
- **`canvas://skills` MCP resource.** Agent skills bundled with the npm install
  (`skills/<name>/SKILL.md`) are now discoverable through MCP. The `canvas://skills`
  resource returns a JSON index (name, description, per-skill URI), and each
  skill is addressable individually at `canvas://skills/<name>`. The
  `canvas_build_web_artifact` tool description now explicitly points agents at
  `canvas://skills/web-artifacts-builder` for the full workflow, stack choices,
  and anti-slop design guidelines.

### Fixed

- **`image` node no longer accepts non-image file paths.** Creating an image
  node with a path like `report.pptx` previously stored the path silently
  with no `mimeType`; the server now rejects the request with a 400 and a
  helpful message listing the accepted extensions (png, jpg, jpeg, gif, svg,
  webp, bmp, avif, ico). `data:` URIs are validated against `image/*` media
  types. Use `type="file"` or `type="webpage"` for non-image sources.
- **`web-artifact` init is more resilient on machines with tight process
  limits.** `init-artifact.sh` and `bundle-artifact.sh` now spawn in their
  own POSIX process group so timeouts and failures kill every descendant
  (pnpm, bun, parcel, swc, lmdb) instead of leaving orphans that accumulate
  FDs and eventually produce `fork: Resource temporarily unavailable`. pnpm's
  internal child concurrency is capped to 2 via
  `pnpm_config_child_concurrency` so the ~30-package shadcn install doesn't
  blow past macOS's default `ulimit -u`. Failure responses now include the
  last 20 lines of stderr (falling back to stdout) so the cause of an exit
  code is visible directly in the API response rather than requiring a manual
  re-run of the shell script.
- **MCP App (`mcp-app` / Excalidraw) state sync.** Edits saved by an MCP App
  widget now propagate via SSE to other clients hosting the same app node
  (fixes Excalidraw losing multi-client sync). The host also suppresses
  echo-back re-renders when a layout update mints a new `toolResult`
  reference with unchanged content — so a widget's own `callServerTool` call
  no longer causes its UI to re-render mid-interaction.
- **MCP App inline-mode click safety.** The ext-app iframe in inline mode is
  now covered by a transparent `ext-app-preview-catcher` overlay that opens
  the fullscreen view on click, rather than letting stray canvas clicks
  reach the widget. Agents / users interact with widgets in the expanded
  overlay (via MCP tools or direct click); inline mode stays a safe
  preview.

### Internal

- New unit tests: `image` node validation (accepted extensions, URL + data
  URI paths, rejected non-image extensions, rejected non-image data URIs)
  and `canvas://skills` discovery (loader resolves the packaged skills
  directory, index is stable-sorted, individual skill contents resolve,
  unknown names return null).
- Shared `extAppToolResultsMatch` helper in `src/shared/ext-app-tool-result.ts`
  for structural equality between `CallToolResult` values, used by the host
  ExtAppFrame to dedupe SSE-delivered tool results.
- E2E: Counter-fixture test updated for the new expand-to-interact
  interaction model (opens the `.ext-app-preview-catcher` overlay, finds
  the iframe in `.expanded-overlay-panel`, force-clicks the in-widget button
  to tolerate the widget's auto-resize settling).

[0.1.2]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.2

## [0.1.1] - 2026-04-24

### Changed

- Bumped CI action versions to Node 24-compatible releases:
  `actions/checkout@v5`, `actions/setup-node@v5`, `actions/upload-artifact@v5`,
  and publish Node runtime to `24`.

### Internal

- Hardened end-to-end test helpers (`addNode`, `addEdge`, `addGraph`,
  `addJsonRender`, `createGroup`, `buildArtifact`) via a shared `postOrThrow`
  primitive that surfaces HTTP failures and server validation errors instead
  of silently returning `undefined`. Prevents the class of "missing edge
  endpoint" cascade that caused the late-cycle red CI on the v0.1.0 branch.

[0.1.1]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.1

## [0.1.0] - 2026-04-21

Initial public release.

### Added

- Infinite 2D spatial canvas workbench with pan, zoom, minimap, and keyboard shortcuts.
- Node types: `markdown`, `status`, `context`, `ledger`, `trace`, `file`, `image`,
  `mcp-app`, `json-render`, `graph`, `group`, plus internal thread types.
- Edge types: `flow`, `depends-on`, `relation`, `references`, each with labels,
  styles (solid/dashed/dotted), and optional animation.
- Three themes: `dark` (default), `light`, `high-contrast`, switchable via CLI flag,
  environment variable, or toolbar.
- State persistence to `.pmx-canvas/state.json` (debounced auto-save, auto-load on start, with legacy migration from `.pmx-canvas.json`).
- Undo / redo backed by a 200-operation ring buffer; compound `arrange()` mutations
  recorded as single history entries.
- Snapshots with list, restore, delete, and diff against current state.
- Spatial semantics layer: proximity clusters, reading order, pinned neighborhoods,
  and pinned-context resource enriched with nearby unpinned nodes.
- Code graph with auto-detected `depends-on` edges between file nodes
  (JavaScript/TypeScript, Python, Go, Rust).
- Resource change notifications so agents observe human curation in real time.
- MCP server with 38 tools and 7 resources; stdio transport via
  `@modelcontextprotocol/sdk`. Includes `canvas_add_diagram`, a preset that
  renders hand-drawn diagrams via the hosted Excalidraw MCP app.
- HTTP API plus Server-Sent Events stream for live updates.
- Bun SDK (`import { createCanvas } from 'pmx-canvas'`).
- Daemonized server via `pmx-canvas serve --daemon` with pid + log tracking.
- Web artifacts build pipeline and ext-app hosting via
  `@modelcontextprotocol/ext-apps`.
- Agent skills shipped in the package under `skills/`; repo workflow mirrors them for agent-specific trees where needed.

[0.1.0]: https://github.com/pskoett/pmx-canvas/releases/tag/v0.1.0
