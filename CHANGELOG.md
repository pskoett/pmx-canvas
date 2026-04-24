# Changelog

All notable changes to `pmx-canvas` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

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
