# API Stability Contract (v0.2)

**Status:** Accepted, effective from v0.2.0
**Date:** 2026-06-12
**Context:** docs/tech-debt-assessment-2026-06.md item 7 (breaking patch releases, no deprecation path) and Phase 2 of the direction proposal. See also docs/adr-001-bun-only-runtime.md for which surfaces are universal.

The problem this fixes: 0.1.35 and 0.1.36 both changed HTTP contract behavior in patch releases. Consumers could not pin safely. From v0.2.0, they can.

## Public surfaces

These four surfaces are the contract. Anything not listed here is internal.

1. **HTTP API:** all `/api/canvas/*` routes documented in `docs/http-api.md`: method, path, request shape, response shape, and status codes.
2. **MCP surface:** tool names, tool input schemas (field names, types, required/optional status), and the fixed resource URIs (`canvas://layout`, `canvas://pinned-context`, and the rest of the frozen 14). Per-skill resources (`canvas://skills/<name>`) track the `skills/` directory and are explicitly not frozen by name.
3. **CLI:** the `pmx-canvas` subcommands and flags documented in `docs/cli.md` (including `serve`, `--mcp`, `--port`, `--theme`), their argument shapes, and their output formats where documented as machine-readable.
4. **SDK:** the exports of the package entry (`src/server/index.ts` via the `exports` map): the `PmxCanvas` class surface, `createCanvas`, and the exported types and helpers. Bun runtime only, per ADR-001.

## Policy

We are in 0.x semver, and we use it honestly:

- **Minor versions (0.2 → 0.3) may break public surfaces.** Breaking changes are allowed only at minor boundaries.
- **Patch versions never break public surfaces.** A patch may fix bugs, tighten validation of inputs that were never accepted as documented, and add purely additive fields. If a documented request that worked stops working, or a documented response shape changes, that is not a patch.
- **Every breaking change gets a CHANGELOG entry under a `### Breaking` heading before release.** Not after, not in a follow-up. The release checklist in docs/RELEASE.md treats a breaking change without that heading as a release blocker.
- **MCP tool names are frozen by `tests/unit/mcp-tool-freeze.test.ts`.** The test pins the literal tool-name list and the fixed resource URIs. Renaming or removing a tool requires editing that test in the same commit, which makes the break deliberate and reviewable rather than accidental. If you find yourself updating the freeze test, you owe a `### Breaking` entry and a minor version.
- **Additive changes are always allowed:** new tools, new routes, new optional input fields, new response fields. Consumers must tolerate unknown fields in responses.

## Deprecation

A public surface is marked deprecated at least one minor version before removal. Concretely:

1. Mark it in the docs (`docs/http-api.md`, `docs/mcp.md`, `docs/cli.md`, or `docs/sdk.md`) and in the MCP tool description where applicable.
2. Record it in the CHANGELOG under `### Deprecated` in the minor that deprecates it.
3. Remove it no earlier than the next minor, with a `### Breaking` entry naming the replacement.

So a tool deprecated in 0.2.x survives all of 0.2.x and may be removed in 0.3.0. Plan-006 (MCP tool consolidation) is the first consumer of this mechanism.

## Explicitly out of contract

These can change in any release without notice:

- **SSE event payload internals.** The existence of the `/api/workbench/events` stream is public; the field-level shape of individual event frames is not. Build on the HTTP read endpoints, not on event internals.
- **Undocumented endpoints.** Anything reachable but not in `docs/http-api.md` (internal prompt/trace/theme plumbing, browser-only routes) is internal.
- **The `.pmx-canvas/` on-disk layout.** `canvas.db` schema, artifact directory structure, daemon pid/log files. Migrations keep old data readable; the format itself is ours to change.
- **Anything under `src/` not exported from the package entry.** Deep imports (`pmx-canvas/src/server/whatever`) get no stability promise even where the file layout makes them possible.
- **Browser UI:** DOM structure, CSS custom properties, client bundle internals.

## Enforcement: the operation registry

The contract is only as real as its single source of truth. The operation registry (`src/server/operations/`, docs/plans/plan-005-operation-registry.md) gives each canvas operation exactly one zod input schema and one handler, from which the HTTP route, MCP tool, CLI command, and SDK method derive. One schema per operation means one place where the contract lives, one diff to review when it changes, and no cross-surface drift of the kind that produced the 0.1.x breakages (the same operation behaving differently over HTTP vs local MCP access).

Two mechanical guards back the policy:

- `tests/unit/mcp-tool-freeze.test.ts`: tool names and fixed resource URIs cannot change silently.
- `tests/unit/operation-parity.test.ts`: migrated operations behave identically across surfaces, including tolerance of unknown input keys (schemas stay loose; strict parsing would be an invisible break).

Operations not yet migrated to the registry are covered by the same policy; the registry just makes compliance cheap instead of disciplined.
