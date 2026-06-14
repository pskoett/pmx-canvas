# Plan 007 — AX domain: state split + orphan-bug fix + registry migration + tool consolidation

**Status:** Proposed
**Date:** 2026-06-13
**Depends on:** plan-005 (operation registry — slices 1–4 merged), plan-006 (MCP tool consolidation — wave 1 merged).
**Motivation:** Retires the remaining hard parts of three tech-debt items at once, all of which converge on the AX domain:
- **Item 1** (operation registry) — migration item 7: the ~25 AX operations are still hand-written 4× (CanvasStateManager → PmxCanvas SDK → HTTP handler → MCP tool → CanvasAccess). ~37 AX HTTP routes + 25 AX MCP tools.
- **Item 3** (CanvasStateManager split): AX state lives as `_axState` inside the 2,498-line `CanvasStateManager`; node deletion silently orphans AX items; the snapshot-vs-audit contract is undocumented as code.
- **Item 2** (tool consolidation) — wave 2: the AX tools are the biggest single win (25 → 5 composites, including 9 gate tools → 1), but blocked until AX ops are registry-backed.

## The AX state contract (authoritative)

Three partitions, confirmed against the code. This contract is the spec for the split.

| Partition | Members | Storage | Snapshotted | Cleared by `canvas_clear` | Cleared by `restore` |
|-----------|---------|---------|:-----------:|:-------------------------:|:--------------------:|
| **Canvas-bound** | `focus`, `workItems`, `approvalGates`, `reviewAnnotations`, `elicitations`, `modeRequests`, `policy` | in-memory `_axState` + one JSON blob in `ax_state` table | ✅ | ✅ | ✅ (replaced by snapshot's AX) |
| **Timeline (audit-only)** | `agent-event`, `evidence-item`, `steering-message` | `ax_events` / `ax_evidence` / `ax_steering` tables, 500-row retention, sequential ids | ❌ | ❌ | ❌ |
| **Host/session** | `host-capability` | `ax_host_capabilities` table | ❌ | ❌ | ❌ |

Rules: canvas-bound state travels with the canvas (snapshot/restore/clear); timeline + host data are diagnostic and survive all three. This is mostly already in CLAUDE.md — plan-007 makes it the documented module boundary.

## Slice A — AX state extraction + orphan-bug fix + contract doc (tech-debt item 3)

**Extraction.** `_axState` is a single separable field; timeline ops are already DB-direct; normalization lives cleanly in `ax-state.ts`. Move the canvas-bound state + its ~17 mutators / ~13 readers + the timeline-direct ops into a dedicated `AxStateManager` (new `src/server/ax-state-manager.ts`). `CanvasStateManager` keeps a `private ax: AxStateManager` and **delegates** its existing AX methods to it — so the public surface (SDK, HTTP, MCP all call `canvasState.addWorkItem(...)` etc.) is byte-stable and no caller changes. The manager takes a node-id-validity callback (injected) so normalization still runs on write. Net: `CanvasStateManager` sheds ~600 lines; AX state becomes independently testable.

**The orphan bug** (`canvas-state.ts:1459`): `removeNode()` → `applyAxState()` → `normalizeAxForCurrentNodes()` re-normalizes AX against the surviving node set. Precise current behavior (verified):
- Work items / approval gates / elicitations / mode requests: `normalizeNodeIds` (`ax-state.ts:255`) **strips the dangling node id but keeps the item** — already "soft", but *silent*.
- Node-anchored review annotations (`anchorType:'node'`): **dropped entirely** (`ax-state.ts:577-582`) — correct (meaningless without their node), but *silent*.
- No event, no audit, on either. Same silent re-normalization runs on `restore()` (`canvas-state.ts:1063`).

**Decision (chosen): soft-orphan + audit.** The data semantics already match soft-orphan, so the fix is the **audit**: when node deletion strips a node ref from a work item/gate/elicitation/mode, or drops a node-anchored review annotation, record one auditable timeline event (`source:'system'`) summarizing what was re-anchored/removed and the trigger node — so the human and a resuming agent can see it instead of work silently changing. Needs a general-purpose system/audit event kind (add `'note'` to `PmxAxEventKind`; `kind` is stored as TEXT so no DB migration). Node-anchored review drop is kept (per the decision), now audited. Scope the audit to `removeNode` (the live bug); `restore` replaces the whole canvas wholesale and its snapshot AX was already consistent when saved.

**Contract doc:** formalize the partition table above in `docs/ax-state-contract.md` (or a CLAUDE.md section) as the authoritative snapshot-vs-audit spec.

Slice A is independent of the registry migration (delegation keeps the surface stable) and is the highest-correctness-value piece. The orphan fix alone is a small, shippable change that can land first.

## Slice B — AX registry migration (tech-debt item 1 / plan-005 item 7)

Define AX operations in `src/server/operations/ops/ax.ts` (split into `ax-state.ts` / `ax-timeline.ts` files if large), following the established pattern (loose zod schemas, `OperationError`, `http.serialize`, `mcp.formatResult/buildInput`, frozen tool names, `ctx.emit` for the AX SSE frames). Delete the legacy HTTP handler + route + MCP tool block + orphaned CanvasAccess method in the same change per op.

**Fits the simple synchronous model** (`mutates: false`, emit `ax-state-changed` or `ax-event-created` via `ctx.emit`; these are NOT layout mutations):
- State: `ax.get`, `ax.focus.set`, `ax.policy.get`, `ax.policy.set`, `ax.host-capability.report`
- Work/review: `ax.work.create`, `ax.work.update`, `ax.review.add`, `ax.review.update`
- Gates (create/resolve): `ax.approval.request`/`.resolve`, `ax.elicitation.request`/`.respond`, `ax.mode.request`/`.resolve`
- Timeline: `ax.timeline.get`, `ax.event.record`, `ax.evidence.add`, `ax.steer`
- Delivery: `ax.delivery.pending` (loop-safe consumer scoping preserved), `ax.delivery.mark`
- Commands: `ax.command.invoke` (allowlist-gated; records a timeline event only)

**Needs special handling (own sub-slice):**
- **Gate reads with long-poll** (`ax.approval.get` / `ax.elicitation.get` / `ax.mode.get`, the `await_*` tools): the HTTP `?waitMs=` blocks via `waitForAxResolution()` + `req.signal`. Migrate using a custom `http.readInput` that performs the wait and returns the resolved-or-`pending` value; the MCP `await` action passes `timeoutMs` through to the handler (no abort signal off-HTTP, timeout still honored). **Fallback:** if this abstraction turns ugly, leave the 3 `await_*` tools + their GET routes legacy and fold them into `canvas_ax_gate`'s `await` action in a later step (report as deferred, plan-005-style — do not force a bad abstraction).

**Stays as a sidecar (NOT a registry op), but routed through the shared op cores:**
- **`ax.interaction`** (`applyAxInteraction`, `src/server/ax-interaction.ts`): the single re-validation trust boundary for sandboxed-surface envelopes, with `sourceSurface` scope-clamping. Keep `POST /api/canvas/ax/interaction` + `canvas_ax_interaction` as-is, but point its per-type dispatch at the SAME operation cores the registry ops call — so interaction and direct calls can never diverge.
- **`ax.activity.ingest`** (`canvas_ingest_activity`): harness firehose with kind-driven auto-reactions firing 3–4 SSE events; distinct caller shape. Stays standalone.

**Preserve exactly:** SSE event names (`ax-state-changed`, `ax-event-created`), the resource-notification fan-out (`canvas://ax`, `ax-context`, `ax-timeline`, `ax-work`, `ax-pending-steering`, `ax-delivery`), structured denial bodies (`resolve` on a missing/already-resolved gate; node-anchored review requiring a real node id), `source` defaulting (`'mcp'` for MCP, `'api'` for HTTP). The SDK's AX methods become thin wrappers over the op cores; CanvasAccess Local/Remote AX methods are deleted (the invoker replaces them) — the same local-vs-remote unification class as slices 1–4.

## Slice C — AX tool consolidation (tech-debt item 2 / plan-006 wave 2)

Additive composites (per `docs/api-stability.md`; same mechanism as wave 1 — derived schema + reused op `buildInput`/`formatResult`, deprecation prefix on the folded legacy tools, removed in v0.3):

1. **`canvas_ax_state`** — `get | set-focus | set-policy | report-capability`
2. **`canvas_ax_work`** — `add | update | annotate` (work items + review annotations)
3. **`canvas_ax_gate`** — two discriminators `kind: approval|elicitation|mode` × `action: request|resolve|await`. **9 tools → 1.** The single biggest consolidation win.
4. **`canvas_ax_timeline`** — `read | record-event | add-evidence | send-steering`
5. **`canvas_ax_delivery`** — `claim | mark`

**Stay standalone** (plan-006 §19–21): `canvas_ax_interaction` (trust-boundary envelope), `canvas_ingest_activity` (harness firehose), `canvas_invoke_command` (gated execution intent, allowlist/approval-policy relevant). Freeze list grows by 5 (additive); legacy AX tools gain the `Deprecated:` prefix.

## Migration order

1. **A.1** orphan-bug fix + audit note (small, shippable first; behavior change — see decision).
2. **A.2** extract `AxStateManager`, delegate from `CanvasStateManager`, document the contract.
3. **B.1** migrate the simple AX state/work/gate-mutate/timeline/delivery/command ops; delete their legacy handlers/tools/CanvasAccess methods; SDK wraps cores.
4. **B.2** gate-read long-poll sub-slice (custom `readInput`; fallback = leave `await_*` legacy).
5. **B.3** re-point `applyAxInteraction` at the shared cores (no behavior change).
6. **C** add the 5 AX composites + deprecate legacy AX tools.

Each step is its own commit; B.1 is internally parallelizable per primitive (work / approvals / elicitations / modes / review / timeline / delivery) — the dynamic-workflow fit.

## Risks

- **Behavior change (orphan fix).** Soft-orphan changes long-standing silent-drop semantics. Mitigation: explicit decision below; a parity-test case pins the new behavior; CHANGELOG `### Changed` entry.
- **State extraction regressions.** `_axState` is touched by snapshot/restore/clear/load and the orphan path. Mitigation: delegation keeps the public surface identical; the existing AX + snapshot unit tests must pass untouched; add a node-delete-orphan test.
- **Long-poll abstraction.** The `await_*` ops are the only AX ops that don't fit the synchronous model. Mitigation: custom `readInput`; documented fallback to keep them legacy.
- **Trust-boundary drift.** `applyAxInteraction` must call the same cores as the registry ops, or the sandboxed-surface path diverges from the direct path. Mitigation: extract mutation cores first, route both through them; the interaction-scope tests stay untouched.
- **MCP-against-remote.** At least one test per migrated AX tool through RemoteCanvasAccess/HttpOperationInvoker (mcp-server daemon mode).
- **Surface size.** Interim tool count grows again (additive); accepted per plan-006.

## Verification (every slice)

1. `bun run typecheck`
2. Targeted: `PMX_CANVAS_DISABLE_BROWSER_OPEN=1 bun test tests/unit/operation-parity.test.ts tests/unit/mcp-tool-freeze.test.ts tests/unit/mcp-server.test.ts tests/unit/mcp-composites.test.ts tests/unit/server-api.test.ts tests/unit/canvas-state.test.ts` (+ AX-specific suites, + a new node-delete-orphan test)
3. Full unit: `bun test tests/unit`
4. e2e gate on the PR (`test` + `e2e` required checks).
5. A parity case per migrated tool (composite action == legacy tool, both through the same op) and per new behavior (soft-orphan + audit note).

Tool-name freeze + operation-parity edits are deliberate and called out in the same commit, with CHANGELOG entries (`### Added` composites, `### Deprecated` legacy, `### Changed` orphan semantics).
