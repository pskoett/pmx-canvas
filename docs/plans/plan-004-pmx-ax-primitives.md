---
title: PMX AX Primitives and Copilot Adapter Plan
status: draft
date: 2026-06-02
---

# PMX AX Primitives and Copilot Adapter Plan

## Summary

PMX Canvas should own the agent-experience primitives as core PMX concepts, not
as GitHub Copilot concepts. GitHub Copilot becomes the first native host
adapter: it renders the existing PMX workbench in a Copilot canvas and maps
Copilot SDK features onto the neutral PMX AX contract.

This plan keeps PMX Canvas agent-agnostic and backward-compatible while adding:

- core AX state and serializers
- HTTP, SDK, MCP, and CLI surfaces for the AX primitives
- a committed `.github/extensions/pmx-canvas/` Copilot canvas adapter
- CLI support to scaffold/install the same adapter in other PMX Canvas projects

Codex is intentionally out of scope for this pass, but the core contract should
make a later Codex adapter straightforward.

Implementation should proceed in vertical slices: each primitive lands across
state, persistence, HTTP, SDK, MCP, CLI, docs, and tests before moving to the
next primitive group. This avoids half-wired surfaces and keeps the existing PMX
"one operation, all access paths" rule intact.

## Interview Decisions

- First pass surfaces: core model, HTTP, SDK, MCP, CLI, and GitHub Copilot
  adapter.
- Out of scope: Codex adapter. Copilot should be a real adapter for the
  existing PMX Canvas experience, not a demo-only scaffold.
- Compatibility: preserve existing APIs and state formats; add optional AX
  fields/endpoints/tables in a backward-compatible way.
- Persistence: AX state lives inside the existing `.pmx-canvas/canvas.db`
  persistence model alongside nodes, edges, context pins, annotations, and
  snapshots.
- Copilot distribution: commit a project extension under
  `.github/extensions/pmx-canvas/` and add CLI support to scaffold/install that
  adapter for other projects later.

## Core AX Primitive Contract

| PMX AX primitive | Core meaning | Persistence/snapshot semantics | First adapter mapping |
|---|---|---|---|
| `canvas-surface` | A live PMX workbench surface with nodes, edges, viewport, annotations, pins, and snapshots. | Existing canvas state and snapshots. | Copilot `createCanvas().open()` returns the running `/workbench` URL. |
| `pinned-context` | Human-curated node set plus bounded agent-readable summaries and neighborhoods. | Existing context pin state and snapshots. | Copilot hooks return it as `additionalContext`; MCP keeps `canvas://pinned-context`. |
| `focus` | Current node or node set the human/agent wants attention on. | Canvas-bound state; snapshot with canvas. | Copilot canvas action/HTTP/CLI can focus without requiring app-specific state. |
| `agent-action` | Normalized operation request against PMX state. | Operation request/result is timeline state; effects persist through target primitive. | Copilot canvas actions/tools proxy to PMX HTTP/SDK/MCP operations. |
| `steering-message` | User instruction emitted from the PMX surface to the active agent session. | Timeline state; persisted in DB but not restored by snapshots. | Copilot adapter maps it to `session.send()` or `sendAndWait()`. |
| `approval-gate` | A PMX-owned request for human approval/rejection before a high-impact AX action. | Canvas-bound state while pending/resolved; snapshot with canvas. | Copilot adapter exposes approval UI/actions and may map safe cases to SDK permission hooks. |
| `work-item` | Visible task/plan/status primitive tied to nodes or agent work. | Canvas-bound state; snapshot with canvas. | Existing status/markdown nodes can render it; adapters can update it through AX APIs. |
| `evidence-item` | Inspectable artifact such as logs, tool result, screenshot, file, diff, or test output. | Timeline state; persisted in DB with retention, not restored by snapshots. | Copilot session/tool events become evidence nodes/items. |
| `review-annotation` | Human or agent comment/finding anchored to a node/file/region. | Canvas-bound state; snapshot with canvas. | PMX annotations/nodes remain source of truth; Copilot can render and update them. |
| `agent-event` | Normalized timeline event for prompts, assistant messages, tool starts/results, failures, approvals, and steering. | Timeline state; persisted in DB with retention, not restored by snapshots. | Copilot `session.on(...)` events are normalized into PMX AX events. |
| `host-capability` | What the current host can do: canvas, hooks, tools, session messaging, permissions, files, UI prompts. | Session/host state; persisted only when useful for diagnostics. | Copilot `session.capabilities` maps to neutral capability flags. |

### State partitions

- **Canvas-bound AX state:** `focus`, `work-item`, `approval-gate`,
  `review-annotation`, and existing pins. These participate in canvas
  snapshots and restore.
- **Timeline AX state:** `agent-event`, `evidence-item`, `agent-action`
  records, and `steering-message`. These persist in the PMX DB for diagnostics
  and continuity but are not restored by canvas snapshots.
- **Host/session AX state:** `host-capability`. This is reported by adapters
  and exposed for diagnostics, but it should not make core depend on any host.

## Architecture

### Make the change easy first

Add a small core AX module before wiring endpoints:

- `src/server/ax-state.ts`
  - AX primitive types
  - normalizers and validation helpers
  - context/export serializers
  - event/action/evidence/approval/work-item helpers

This avoids scattering AX-specific object shapes across `canvas-state.ts`,
`server.ts`, `index.ts`, `mcp/server.ts`, and `cli/agent.ts`.

### Vertical slice sequencing

Use primitive groups as the unit of implementation:

1. AX context and focus: reuse existing pins and prove context export across
   HTTP, SDK, MCP, CLI, and Copilot hook injection.
2. Steering and agent events: prove adapter-to-session messaging and timeline
   recording without changing canvas rendering.
3. Work items and approvals: add user-visible collaboration state and approval
   enforcement for AX actions that explicitly opt into approval.
4. Evidence and review annotations: add richer diagnostics and review surfaces.
5. Host capabilities and adapter polish: expose what each host can support and
   improve native Copilot ergonomics.

Each group should be complete across all applicable access paths before the
next group starts.

### Server-authoritative state

`CanvasStateManager` remains the source of truth. AX state should be loaded,
mutated, snapshotted, restored, and notified through the same server-side path
as canvas nodes and context pins.

### Adapter boundary

Core must not import `@github/copilot-sdk`. The Copilot adapter lives under
`.github/extensions/pmx-canvas/extension.mjs` and talks to PMX Canvas through
HTTP plus normal Copilot SDK APIs.

The adapter should:

1. discover a running PMX Canvas server through an explicit contract
2. open the existing `/workbench` URL in a Copilot canvas
3. expose Copilot canvas actions that proxy PMX AX and canvas operations
4. inject PMX pinned/AX context on prompt submission
5. map session events and steering messages to PMX AX events/evidence

The discovery contract should be implemented before adapter features:

1. use adapter input or environment (`PMX_CANVAS_URL` / `PMX_CANVAS_PORT`) when
   provided
2. probe the repo default loopback server (`127.0.0.1:4313`) and any configured
   port
3. read PMX daemon metadata under `.pmx-canvas/` when available
4. fail with a visible `session.log()` diagnostic and an actionable canvas error
   instead of opening a blank iframe

## Affected Files/Areas

### Core state and persistence

- `src/server/ax-state.ts` - new core AX primitive model and serializers
- `src/server/canvas-state.ts` - own AX state, persistence integration,
  notifications, snapshots, restore, clear
- `src/server/canvas-db.ts` - add migration-safe AX tables or JSON state row
  and snapshot persistence
- `src/server/canvas-serialization.ts` and/or `src/server/agent-context.ts` -
  reuse existing pinned-context summaries in the AX context export

### Core operations and SDK

- `src/server/canvas-operations.ts` - add shared operation helpers for AX
  mutations
- `src/server/index.ts` - add `PmxCanvas` SDK methods for AX state, context,
  actions, approvals, evidence, events, work items, capabilities, and steering
- `src/mcp/canvas-access.ts` - add local/remote access methods for AX APIs

### HTTP and SSE

- `src/server/server.ts` - add routes such as:
  - `GET /api/canvas/ax`
  - `PATCH /api/canvas/ax`
  - `GET /api/canvas/ax/context`
  - `POST /api/canvas/ax/action`
  - `POST /api/canvas/ax/event`
  - `POST /api/canvas/ax/evidence`
  - `POST /api/canvas/ax/approval`
  - `POST /api/canvas/ax/steer`
- emit `ax-state-changed` / `ax-event-created` SSE events where useful
- keep existing `/api/canvas/context-pins` and `/api/canvas/pinned-context`
  stable; AX context should build on them

### MCP

- `src/mcp/server.ts`
  - add AX resource(s), likely `canvas://ax` and `canvas://ax-context`
  - add tools such as `canvas_get_ax`, `canvas_update_ax`,
    `canvas_record_ax_event`, `canvas_add_evidence`,
    `canvas_request_approval`, and `canvas_send_steering`
  - update resource notifications for AX changes

### CLI

- `src/cli/index.ts` - add top-level command group routing, likely `ax`
  and/or `copilot`
- `src/cli/agent.ts` - add agent-native JSON commands:
  - `pmx-canvas ax status`
  - `pmx-canvas ax context`
  - `pmx-canvas ax event add`
  - `pmx-canvas ax evidence add`
  - `pmx-canvas ax approval request|resolve`
  - `pmx-canvas ax work add|update|list`
  - `pmx-canvas copilot install-extension`

### Copilot adapter

- `.github/extensions/pmx-canvas/extension.mjs`
  - register a canvas through `joinSession({ canvases: [...] })`
  - use `createCanvas` from `@github/copilot-sdk/extension`
  - bind a loopback-safe workbench URL from the PMX server
  - expose action handlers for PMX operations
  - add `onUserPromptSubmitted` and `onSessionStart` hooks for AX context
  - subscribe to session events and record normalized AX events/evidence
  - use `session.log()`, never `console.log()`
- a bundled extension template path in the published package, for example
  `src/cli/templates/copilot-extension/pmx-canvas/extension.mjs` or an
  equivalent package-included location

### Client/browser

- `src/client/types.ts` - add client-side AX types if the workbench needs to
  render AX state directly
- `src/client/state/sse-bridge.ts` - consume AX SSE events if browser UI
  should react live
- Existing workbench UI should stay intact; Copilot embeds it rather than
  reimplementing the canvas renderer.

### Docs and package contents

- `Readme.md`
- `docs/http-api.md`
- `docs/sdk.md`
- `docs/mcp.md`
- `docs/cli.md`
- `skills/pmx-canvas/SKILL.md`
- `package.json` - include the Copilot extension template in published package
  files if the current package configuration would otherwise omit it

## Implementation Checklist

### Phase 0: Adapter/API spike and scaffolding

- [x] Re-check the local `create-canvas` skill and Copilot SDK docs/types before
      writing the extension entrypoint.
- [x] Use `extensions_manage scaffold` for the project extension baseline, then
      edit it into `.github/extensions/pmx-canvas/extension.mjs`.
- [x] Define the PMX server discovery contract for the adapter.
- [x] Add or choose a package-included extension template path for CLI
      installation.

### Phase 1: AX context and focus vertical slice

- [x] Define `src/server/ax-state.ts` with primitive types, normalizers, and
      context/focus serializers.
- [x] Add canvas-bound AX focus state to `CanvasStateManager` without changing
      existing node, edge, annotation, pin, or snapshot behavior.
- [x] Persist focus state in SQLite using additive schema changes only.
- [x] Snapshot and restore canvas-bound AX focus state.
- [x] Add HTTP endpoints and SSE events for AX context/focus.
- [x] Add `PmxCanvas` SDK methods for AX context/focus.
- [x] Add `CanvasAccess` local/remote methods for AX context/focus.
- [x] Add MCP resources/tools and resource notifications for AX context/focus.
- [x] Add CLI `ax context` and `ax focus` commands.
- [x] Make the Copilot adapter open the live PMX workbench and inject AX context
      from prompt hooks.

### Phase 2: Steering and agent-event vertical slice

- [ ] Add timeline persistence for steering messages and agent events with a
      retention policy.
- [ ] Add HTTP/SDK/MCP/CLI operations for recording and reading AX timeline
      events.
- [ ] Add Copilot adapter steering actions that call `session.send()` only from
      explicit user/action flows.
- [ ] Subscribe to useful Copilot session events and record normalized
      `agent-event` entries.

### Phase 3: Work items and approval gates vertical slice

- [ ] Add canvas-bound work-item and approval-gate state.
- [ ] Persist and snapshot work items and approval gates.
- [ ] Add HTTP/SDK/MCP/CLI operations for work-item and approval lifecycle.
- [ ] Enforce approvals for AX actions explicitly marked as requiring approval;
      existing non-AX canvas endpoints remain unchanged.
- [ ] Add Copilot adapter UI/actions for approval request and resolution.

### Phase 4: Evidence, review annotations, and host capabilities

- [ ] Add timeline evidence-item persistence and retention.
- [ ] Add review-annotation state or map the AX shape onto existing annotations
      where possible.
- [ ] Add host-capability reporting across HTTP/SDK/MCP/CLI.
- [ ] Record Copilot tool/session evidence where low-risk and useful.

### Phase 5: Docs, template install, and verification

- [ ] Add `pmx-canvas copilot install-extension` or equivalent scaffold command.
- [ ] Ensure the extension template is included in published package contents.
- [ ] Update docs and the pmx-canvas skill to describe AX primitives and the
      Copilot adapter.
- [ ] Add parity/static tests for state persistence, HTTP, SDK, MCP, CLI,
      adapter scaffold behavior, and no Copilot imports in core.
- [ ] Run the repo-standard verification ladder after implementation.

## Success Criteria

- PMX Canvas core can represent and persist AX primitives without any GitHub
  Copilot dependency.
- Existing PMX Canvas behavior remains backward-compatible: current HTTP, MCP,
  CLI, SDK, browser, snapshots, and pinned-context flows keep working.
- HTTP, SDK, MCP, and CLI expose the same AX primitives consistently.
- The GitHub Copilot app can open PMX Canvas natively through a project canvas
  extension and render the existing workbench.
- The Copilot adapter can:
  - inject PMX AX/pinned context on prompt submission
  - proxy core canvas/AX actions
  - update pins/basic canvas state
  - send steering instructions to the agent session
  - record useful Copilot session/tool events as AX events/evidence
- Canvas-bound AX state is included in snapshots; timeline AX state persists in
  the PMX DB but is not restored by snapshots.
- Codex is not implemented, but no core type or persistence decision prevents a
  later Codex adapter.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| AX model becomes Copilot-shaped instead of PMX-shaped. | Future Codex/MCP/HTTP reuse becomes expensive. | Keep all Copilot imports and names out of core; use neutral PMX primitives and adapter mapping only. |
| Persistence changes break existing `.pmx-canvas/canvas.db` files. | Existing users lose or corrupt canvas state. | Add new tables/rows with `CREATE TABLE IF NOT EXISTS`; keep current tables and existing payload shapes stable. |
| Duplicating pinned-context logic creates drift. | Different agents receive different context. | Reuse `agent-context.ts` and existing pinned-context summaries for AX context export. |
| Copilot adapter tries to reimplement the workbench UI. | Large fragile UI duplicate. | Embed the existing `/workbench` URL and use adapter code only for SDK hooks/actions/session events. |
| Extension process cannot run Bun/PMX server in some environments. | Copilot canvas opens without a backend. | Prefer discovering an existing PMX server; add explicit startup diagnostics and clear error states. Use loopback URLs only. |
| `session.send()` from hooks causes loops. | Adapter can recursively prompt the agent. | Do not call `session.send()` synchronously from prompt hooks; steering actions should be user/action initiated. |
| MCP/CLI/SDK parity drifts. | Agents see different capabilities by host. | Follow the existing repo rule: new operation lands in state manager, SDK, HTTP, MCP, and CLI together. |
| SQLite schema changes assume migrations that do not exist. | Older DBs fail to load. | Use additive tables/columns only unless a real migration path is added; do not bump schema version without a tested migrator. |
| AX timeline grows without bounds. | DB size and context export become noisy. | Add a retention/query limit policy for timeline primitives; context export should include bounded summaries only. |

## Test Strategy

### Unit tests

- `tests/unit/canvas-state.test.ts`
  - AX state persists and reloads
  - AX state is included in snapshots and restored
  - clearing canvas handles AX state according to the chosen semantics
- `tests/unit/server-api.test.ts`
  - HTTP AX endpoints return stable JSON
  - AX context reuses pinned node summaries
  - SSE emits AX events when AX state changes
- `tests/unit/pmx-canvas-sdk.test.ts`
  - `PmxCanvas` exposes AX methods and mutates core state correctly
- `tests/unit/mcp-server.test.ts`
  - MCP lists AX resources/tools
  - MCP tools can read/update AX state
  - resource notifications include AX changes
- `tests/unit/cli-node.test.ts` or a new CLI test file
  - `pmx-canvas ax ...` commands return JSON and fail loudly on invalid input
  - `pmx-canvas copilot install-extension --dry-run` previews the target path
- Static/parity tests
  - no core/server/shared files import `@github/copilot-sdk`
  - every committed AX operation has SDK, HTTP, MCP, and CLI coverage or an
    explicit documented exception
  - the Copilot extension template is included in the package file list

### Adapter tests

- Add a focused test around the generated Copilot extension file/template:
  - extension file exists at `.github/extensions/pmx-canvas/extension.mjs`
  - it imports only `@github/copilot-sdk/extension` and Node built-ins
  - it contains no `console.log`
  - declared canvas/actions avoid reserved `canvas.*` action names
  - server discovery failures produce visible adapter diagnostics

Full runtime Copilot SDK execution may not be practical in normal Bun tests, so
the minimum automated test should verify the scaffold/template and the PMX HTTP
contract it relies on.

### Integration/e2e

- Existing web canvas Playwright test after client changes.
- HTTP smoke:
  - start PMX server
  - add nodes
  - pin nodes
  - read `/api/canvas/ax/context`
  - invoke an AX event/evidence/approval mutation
- Snapshot smoke:
  - create canvas-bound AX state
  - save snapshot
  - mutate AX state
  - restore snapshot
  - confirm canvas-bound AX state restored and timeline state remains bounded
- MCP smoke:
  - start MCP server
  - list AX resources/tools
  - read AX context

## Validation and Diagnostics

- Build/typecheck must catch shared type drift:
  - `bun run typecheck`
  - `bun run build`
- Unit tests should cover the changed surfaces:
  - `bun test tests/unit/canvas-state.test.ts tests/unit/server-api.test.ts tests/unit/pmx-canvas-sdk.test.ts tests/unit/mcp-server.test.ts tests/unit/cli-node.test.ts`
- If client code changes, run the canvas bundle build and browser tests per repo
  guidance.
- For manual Copilot adapter validation:
  - reload extensions
  - verify `pmx-canvas` appears in canvas capabilities
  - open the Copilot canvas
  - confirm the PMX workbench loads
  - pin a node and confirm the next prompt receives AX context
  - invoke a basic adapter action and confirm PMX state changes

Diagnostics expectations:

- Extension failures should be visible through `extensions_manage inspect`.
- Adapter should use `session.log()` for user-visible errors.
- HTTP/CLI/MCP failures should include actionable errors, not silent no-ops.

## Knowledge Map

| Step | Knowledge Source | Confidence |
|---|---|---|
| Define neutral AX primitives | Prompt/context from interview plus existing PMX pinned-context architecture | High |
| Persist AX state in core | Codebase: `canvas-state.ts`, `canvas-db.ts`, tests/helpers persistence patterns | High |
| Expose HTTP/SDK/MCP/CLI surfaces | Codebase: existing 1:1 operation pattern in `server.ts`, `index.ts`, `mcp/server.ts`, `cli/agent.ts` | High |
| Build Copilot canvas adapter | Reachable SDK docs: `create-canvas` skill, `extensions.md`, `agent-author.md`, `canvas.d.ts`, `session.d.ts`; verify again in Phase 0 | High |
| Inject context in Copilot | Reachable SDK docs: `onUserPromptSubmitted` and `additionalContext` | High |
| Programmatic steering in Copilot | Reachable SDK docs: `session.send()` / `sendAndWait()` and gotchas | High |
| Runtime validation inside actual GitHub Copilot app | Host tooling available through extension management and canvas tools; runtime still requires manual inspection | Medium |
| Codex adapter | Out of scope; future host-specific docs needed | Not planned |

## Open Questions

- [ ] Should `canvas_clear` remove timeline AX events/evidence, or only
      canvas-bound AX state? This can proceed with the conservative default:
      clear canvas-bound state and keep timeline history subject to retention.
- [ ] Should `approval-gate` integrate deeply with Copilot permission hooks in
      this first pass or only expose PMX approvals through adapter UI/actions?
      This can proceed by implementing PMX approvals first and mapping
      permission hooks only where low-risk.

## Rejected Alternatives

### Put Copilot SDK concepts directly in PMX core

Rejected because PMX Canvas must remain usable by any agent. Core should expose
neutral AX concepts; Copilot translates them to SDK hooks, canvases, tools, and
session events.

### Store AX in `.pmx-canvas/ax.json`

Rejected by interview decision. AX should persist with existing PMX Canvas state
in SQLite and snapshots, so project state remains coherent.

### Rebuild the PMX workbench UI inside the Copilot extension

Rejected because the existing PMX browser app already implements full canvas
functionality. The adapter should embed and bridge it rather than fork the UI.

## Refinement Notes

### Draft pass

Initial plan aligns the broad implementation with existing repo rules: state is
server-authoritative, MCP tools map to SDK/HTTP/state operations, and the
Copilot adapter is isolated from core.

### Fresh-eyes pass 1

Refined the plan from a breadth-first implementation into phased vertical
slices, split canvas-bound AX state from timeline AX state, made server
discovery and template packaging explicit, added static/parity tests, and
resolved the snapshot-vs-timeline contradiction before implementation.
