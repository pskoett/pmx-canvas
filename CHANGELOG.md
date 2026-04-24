# Changelog

All notable changes to `pmx-canvas` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [0.1.2] - 2026-04-24

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

### Internal

- New unit tests for `image` node validation (accepted extensions, URL + data
  URI paths, rejected non-image extensions, rejected non-image data URIs).

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
