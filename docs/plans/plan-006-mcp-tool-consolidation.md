# Plan 006: MCP tool consolidation (69 tools to 21)

**Status: completed in v0.3.0 (canvas_snapshot composite moved to v0.4).**

**Status (historical):** In progress — wave 1 landed (7 canvas composites) and the AX wave landed (5 composites: `canvas_ax_state`, `canvas_ax_work`, `canvas_ax_gate`, `canvas_ax_timeline`, `canvas_ax_delivery`). Remaining (closed by plan-008 + the v0.3.0 removal): `canvas_snapshot` (name held by the legacy save tool until v0.4), `canvas_app`/`canvas_webview` (landed via plan-005 item 8), and the deferred actions `refresh` / `add-primitive` / `remove-annotation` / board validation (landed via plan-008 waves 1 and 5).
**Date:** 2026-06-12
**Depends on:** plan-005 (operation registry). Slices 1-4 are migrated; consolidation lands per-domain as the corresponding registry slices complete.
**Motivation:** docs/tech-debt-assessment-2026-06.md item 2. Governed by docs/api-stability.md (deprecation: marked in one minor, removed in the next).

## Rationale

69 tools is a tax on every connected agent: each tool name + description + input schema is sent to every MCP client and consumes context window before the agent has done anything. Worse, it degrades tool selection. An agent choosing between `canvas_request_approval`, `canvas_resolve_approval`, and `canvas_await_approval` (times three gate kinds, nine tools) picks worse than one choosing `canvas_ax_gate` with a clear action enum and one good description. Agents reliably pick the right tool from ~20 well-described tools; at 69 the descriptions compete with each other.

The registry makes this cheap. A consolidated tool is one `mcp` block whose `extraShape` adds an action discriminator and whose `buildInput` dispatches to the existing registered operations. No handler logic moves; the consolidation is presentation-layer only, which is exactly what the registry was built to make safe.

## Current surface (69 tools, from tests/unit/mcp-tool-freeze.test.ts)

Grouped by domain: node CRUD + creation variants (15), edges (2), view (4), groups (3), snapshots + diff (6), undo/redo (2), search/validate/schema (4), pins (1), batch (1), webview automation (6), AX (25).

## Proposed surface (21 tools)

### Composites

**1. `canvas_node`**: folds `canvas_add_node`, `canvas_add_html_node`, `canvas_get_node`, `canvas_update_node`, `canvas_remove_node`, `canvas_refresh_webpage_node`.
Action enum: `add | get | update | remove | refresh`.
Sketch: `{ action, id?, type?, title?, content?, html?, x?, y?, width?, height?, data?, ...patch fields }`. `add` requires `type` (full node-type enum; html nodes stop needing a dedicated tool since `html` is already a first-class field). `refresh` covers the webpage re-fetch (`node.update` already has `refresh: true` delegation in the registry, so this is an alias action, not new logic). Spec-driven types (json-render, graph, web-artifact) keep their existing redirect errors pointing at `canvas_render`.

**2. `canvas_render`**: folds `canvas_add_json_render_node`, `canvas_stream_json_render_node`, `canvas_add_graph_node`, `canvas_add_html_primitive`, `canvas_validate_spec`, `canvas_describe_schema`.
Action enum: `describe-schema | validate | add-json-render | stream-json-render | add-graph | add-primitive`.
Sketch: `{ action, spec?, graph?, kind?, payload?, nodeId?, title?, x?, y?, ... }`. One tool owns "spec-driven content": discover the schema, validate, create. The alias triangle (heightPx/nodeHeight/height) is already absorbed by the registry slice 6 schema.

**3. `canvas_app`**: folds `canvas_open_mcp_app`, `canvas_add_diagram`, `canvas_build_web_artifact`.
Action enum: `open-mcp-app | diagram | build-artifact`.
Sketch: `{ action, serverUrl?, tool?, args?, elements?, files?, entry?, title?, ... }`. External and built content with side-channel semantics, kept apart from plain node CRUD because their inputs share nothing with it.

**4. `canvas_edge`**: folds `canvas_add_edge`, `canvas_remove_edge`.
Action enum: `add | remove`.
Sketch: `{ action, id?, from?, to?, type?, label?, style?, animated? }`.

**5. `canvas_view`**: folds `canvas_arrange`, `canvas_focus_node`, `canvas_fit_view`, `canvas_clear`, `canvas_remove_annotation`.
Action enum: `arrange | focus | fit | clear | remove-annotation`.
Sketch: `{ action, nodeId?, annotationId?, strategy?, padding? }`. `remove-annotation` lives here as "canvas surface housekeeping"; it is an overlay operation, not node CRUD (judgment call, see Risks).

**6. `canvas_group`**: folds `canvas_create_group`, `canvas_group_nodes`, `canvas_ungroup`.
Action enum: `create | add | ungroup`.
Sketch: `{ action, groupId?, title?, nodeIds? }`.

**7. `canvas_snapshot`**: folds `canvas_snapshot`, `canvas_list_snapshots`, `canvas_restore`, `canvas_delete_snapshot`, `canvas_gc_snapshots`, `canvas_diff`.
Action enum: `save | list | restore | delete | gc | diff`.
Sketch: `{ action, name?, id?, keep?, dryRun?, all? }`.

**8. `canvas_history`**: folds `canvas_undo`, `canvas_redo`.
Action enum: `undo | redo`.
Sketch: `{ action }`.

**9. `canvas_query`**: folds `canvas_search`, `canvas_get_layout`, `canvas_validate`.
Action enum: `search | layout | validate`.
Sketch: `{ action, query?, limit?, full? }`. The three "read the board" entry points under one description that teaches the cheap-to-expensive ladder (search before layout).

**10. `canvas_webview`**: folds `canvas_webview_status`, `canvas_webview_start`, `canvas_webview_stop`, `canvas_resize`, `canvas_evaluate`.
Action enum: `status | start | stop | resize | evaluate`.
Sketch: `{ action, width?, height?, expression? }`.

**11. `canvas_ax_state`**: folds `canvas_get_ax`, `canvas_set_ax_focus`, `canvas_set_ax_policy`, `canvas_report_host_capability`.
Action enum: `get | set-focus | set-policy | report-capability`.
Sketch: `{ action, focus?, policy?, capability? }`.

**12. `canvas_ax_work`**: folds `canvas_add_work_item`, `canvas_update_work_item`, `canvas_add_review_annotation`.
Action enum: `add | update | annotate`.
Sketch: `{ action, id?, title?, status?, detail?, nodeIds?, body?, anchor? }`.

**13. `canvas_ax_gate`**: folds the nine gate tools: `canvas_request_approval`, `canvas_resolve_approval`, `canvas_await_approval`, `canvas_request_elicitation`, `canvas_respond_elicitation`, `canvas_await_elicitation`, `canvas_request_mode`, `canvas_resolve_mode`, `canvas_await_mode`.
Two discriminators: `kind: approval | elicitation | mode` and `action: request | resolve | await`.
Sketch: `{ kind, action, id?, title?, detail?, nodeIds?, decision?, response?, mode?, timeoutMs? }`. `resolve` carries `decision` for approval/mode and `response` for elicitation. The biggest single win: 9 tools to 1, and the request/await pairing finally reads as one lifecycle.

**14. `canvas_ax_timeline`**: folds `canvas_get_ax_timeline`, `canvas_record_ax_event`, `canvas_add_evidence`, `canvas_send_steering`.
Action enum: `read | record-event | add-evidence | send-steering`.
Sketch: `{ action, kind?, summary?, payload?, evidenceType?, message?, limit? }`.

**15. `canvas_ax_delivery`**: folds `canvas_claim_ax_delivery`, `canvas_mark_ax_delivery`.
Action enum: `claim | mark`.
Sketch: `{ action, consumer?, id? }`.

### Kept standalone (composition would hurt)

- **16. `canvas_batch`**: already the meta-operation; folding anything into it inverts the design.
- **17. `canvas_pin_nodes`**: the flagship human-context primitive; deserves its own description so agents find it.
- **18. `canvas_screenshot`**: returns an MCP image payload; mixing return types inside a composite makes `formatResult` and client handling worse.
- **19. `canvas_ax_interaction`**: the single normalized trust-boundary envelope; it already is a composite by design.
- **20. `canvas_ingest_activity`**: adapter firehose with reaction semantics; distinct caller (harness, not agent).
- **21. `canvas_invoke_command`**: execution-intent tool; allowlist and approval-policy relevant, so it must stay individually nameable.

Every one of the 69 legacy tools maps to exactly one row above; nothing is dropped without a successor.

## Migration

1. **v0.2 minors: add consolidated tools alongside legacy.** Each consolidated tool ships when its registry slice lands (plan-005 migration order). Implementation per tool: one registry `mcp` registration with an `action` (and for gates, `kind`) discriminator in `extraShape`, a `buildInput` that maps the composite args onto the existing operation input, dispatching via the operation name. Legacy tools keep working unchanged.
2. **Same minors: mark legacy deprecated.** Each legacy tool description gets a leading `Deprecated: use canvas_x with action "y".` line, plus `### Deprecated` CHANGELOG entries and docs/mcp.md updates, per the api-stability contract.
3. **v0.3.0: remove legacy tools.** `### Breaking` CHANGELOG entry listing every removed tool and its replacement.
4. **Freeze test updated in two deliberate steps.** Step one (v0.2): the frozen list grows to 69 + 21 = 90 names as consolidated tools land (additive, not breaking). Step two (v0.3.0): the list shrinks to the 21 survivors in the same commit that deletes the legacy registrations. Both edits are intentional per the freeze test's contract.
5. **Verification per step:** `bun test tests/unit/mcp-tool-freeze.test.ts tests/unit/operation-parity.test.ts tests/unit/mcp-server.test.ts`, plus one parity case per composite asserting that the composite action and its legacy tool produce identical results through the same operation.

The interim 90-tool surface is worse than 69 for one or two minors. Accepted: the alternative (flag-day rename) breaks every existing client at once with no migration window.

## Risks

- **MCP clients with tool allowlists.** A client allowlisting `canvas_add_node` gets nothing when the tool disappears in v0.3, and a coarse `canvas_node` allowlist grants add AND remove together. Consolidation moves the permission boundary from tool name to action param, which allowlist-based policy cannot see. Mitigations: the v0.2 overlap window, loud CHANGELOG + docs/mcp.md migration table, and keeping the sensitive standalones (`canvas_invoke_command`, `canvas_ax_interaction`, `canvas_ingest_activity`) individually nameable. For finer control PMX's own AX policy (`canvas_set_ax_policy` `tools.approvalRequired`) remains the recommended layer.
- **Action-enum schema bloat.** A composite's schema is the union of its members' fields, mostly optional. If a composite's description plus schema approaches the combined size of the tools it replaced, the consolidation bought nothing; measure serialized listTools size before and after (target: well over 50% reduction).
- **Worse errors for wrong field/action combinations.** `buildInput` must reject mismatches loudly (OperationError 400 naming the action and the offending field), not silently ignore fields the action does not use.
- **Placement judgment calls** (`remove-annotation` under `canvas_view`, `refresh` under `canvas_node`, `evaluate` under `canvas_webview`) are cheap to revisit before v0.3 freezes the surface; after that they are contract.
- **Stale agent muscle memory.** Skills, docs, and CLAUDE.md reference legacy names everywhere. The v0.3 commit must sweep `skills/`, `docs/`, and the MCP `canvas_describe_schema` routing map in the same change, or agents will be steered at tools that no longer exist.
