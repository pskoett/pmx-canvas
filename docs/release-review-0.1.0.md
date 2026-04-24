# PMX Canvas 0.1.0 — Release Review

**Date:** 2026-04-24  
**Target:** public release of `pmx-canvas` 0.1.0

## TL;DR

**Ready to ship on the Bun-first release path.** The current tree passes build, typecheck,
unit tests, browser smoke, tarball pack/install smoke, and live endpoint checks. The remaining
work for release hygiene was documentation and workflow alignment, which is now tracked in the
same repo as code and package metadata.

## Verification Summary

| Check | Result | Notes |
|---|---|---|
| `bun run test` | ✅ | 159 passing unit/API/MCP/SDK tests |
| `bun run test:web-canvas` | ✅ | 26 passing Playwright tests, 1 skipped published-consumer scenario |
| `bun pm pack --dry-run` | ✅ | Tarball now includes `skills/` in addition to `src/`, `dist/`, and docs |
| `bun run release:smoke` | ✅ | Pack → install → boot → probe consumer flow passed |
| Live startup probes | ✅ | `/health`, `/api/canvas/state`, `/api/canvas/summary`, `/canvas/index.js`, and SSE stream responded correctly |
| Bun SDK import | ✅ | `import { createCanvas } from 'pmx-canvas'` works in Bun |
| Node SDK import | ⚠️ unsupported by design | Published export remains Bun-first; Node consumers should use CLI, MCP, or HTTP |

## Release Notes

- Persistence is documented and implemented as `.pmx-canvas/state.json` with automatic migration
  from legacy `.pmx-canvas.json` and `.pmx-canvas-snapshots/`.
- The Bun package now ships the documented `skills/` directory alongside the CLI, MCP server,
  HTTP surface, and Bun SDK.
- The publish workflow now validates the same release surfaces used in local release review:
  browser smoke and consumer install/start smoke both run before `npm publish`.

## Known Scope

- The package is Bun-first. The SDK import path is intended for Bun runtimes.
- The Playwright `published-consumer` test remains opt-in because it requires an externally
  provisioned install-style URL via `PMX_CANVAS_URL`.
