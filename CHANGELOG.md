# Changelog

All notable changes to `pmx-canvas` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

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
