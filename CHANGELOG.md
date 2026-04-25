# Changelog

All notable changes to `pmx-canvas` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

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
