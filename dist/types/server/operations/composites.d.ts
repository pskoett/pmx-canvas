/**
 * Composite MCP tools (plan-006: MCP tool consolidation).
 *
 * A composite tool folds several single-purpose MCP tools into one tool with an
 * `action` discriminator. It is a PRESENTATION-LAYER construct only: each action
 * dispatches to an already-registered operation (`src/server/operations/ops/*`)
 * via the same invoker, reusing that operation's own `mcp.buildInput` and
 * `mcp.formatResult`. So `canvas_edge { action: "add", ... }` is byte-identical
 * to the standalone `canvas_add_edge` — same op, same arg mapping, same result
 * shape — by construction. No handler logic lives here.
 *
 * Migration (docs/api-stability.md + plan-006): composites land ADDITIVELY in
 * v0.2 alongside the legacy single-purpose tools (the tool surface grows, then
 * shrinks when the legacy tools are removed in v0.3). Every action here maps to a
 * registry-backed operation (plan-005 slices 1–7 + plan-008 Wave 1).
 *
 * Still deferred (its legacy standalone tool keeps working; see plan-008): the
 * `canvas_snapshot` composite (the v0.3 name collision). The action enums are
 * forward-compatible: adding an action later is additive. (`canvas_webview`
 * shipped in plan-008 Wave 3 via runner injection; `canvas_app` shipped in Wave 4
 * — open-mcp-app / diagram / build-artifact. Wave 5 folded the last three legacy
 * tools deprecate-only — NO per-action input-injection mechanism was needed:
 * `canvas_add_html_node` / `canvas_add_html_primitive` → `canvas_node` action
 * "add" (type:"html" [+ primitive]); `canvas_refresh_webpage_node` → `canvas_node`
 * action "update" (refresh:true). `canvas_screenshot` stays standalone — it
 * returns a binary image payload the composite/registry JSON wire shape does not
 * model.)
 *
 * Not shipped here: the `canvas_snapshot` composite (plan-006 #7). Its target
 * name is ALREADY a legacy standalone tool (the save-snapshot tool, op
 * `snapshot.save`), so it cannot be added additively without a name clash, and
 * repurposing `canvas_snapshot` to be action-discriminated now would break
 * existing callers. It lands in v0.3, in the same change that removes the legacy
 * single-purpose snapshot tools and frees the name.
 *
 * This module must never import server.ts or index.ts.
 */
import { type ZodRawShape } from 'zod';
/**
 * One composite MCP tool: a frozen tool name + its action→operation routing.
 *
 * Two flavours:
 *  - Single-discriminator (the wave-1 composites + the 4 single-discriminator AX
 *    composites): the flat `actions` map routes one `action` value → one op.
 *  - Two-discriminator (`canvas_ax_gate`, plan-007 Slice C): a `kind` × `action`
 *    matrix folds 9 ops into one tool. Set `extraDiscriminatorShape` (the `kind`
 *    enum), `memberOps` (the op names — used to derive the schema union + the
 *    deprecation notes), `actionEnum` (the action discriminator values), and
 *    `resolveOp` (maps `{ kind, action }` → op name, or undefined for an invalid
 *    combo → a loud error at dispatch). The flat `actions` map is left empty for
 *    these; the matrix path uses `resolveOp` instead.
 */
export interface CompositeToolDefinition {
    /** Frozen public tool name (see tests/unit/mcp-tool-freeze.test.ts). */
    toolName: string;
    description: string;
    /** Human-readable action list for the `action` enum description. */
    actionSummary: string;
    /**
     * Map of `action` value → registry operation name (single-discriminator
     * composites). Empty for two-discriminator composites. Every referenced op
     * MUST have an `mcp` block — its `buildInput`/`formatResult` are reused so the
     * composite action matches the legacy standalone tool exactly.
     */
    actions: Record<string, string>;
    /**
     * Two-discriminator extension (e.g. `canvas_ax_gate`). The extra discriminator
     * shape — a single `kind` enum — merged into the advertised schema alongside
     * `action`.
     */
    extraDiscriminatorShape?: ZodRawShape;
    /**
     * Two-discriminator extension: the action enum values (used to build the
     * `action` discriminator when there is no flat `actions` map to derive it from).
     */
    actionEnum?: readonly string[];
    /**
     * Two-discriminator extension: every member op name. Used to build the schema
     * union (all member-op fields, optional) and to derive a deprecation note per
     * member op (each mapped back to its (kind, action) by `describeOp`).
     */
    memberOps?: string[];
    /**
     * Two-discriminator extension: resolve the op name from the validated
     * discriminators. Returns `undefined` for an invalid combo so dispatch can
     * raise a loud error instead of silently no-op'ing.
     */
    resolveOp?: (input: {
        kind: string;
        action: string;
    }) => string | undefined;
    /**
     * Two-discriminator extension: human-readable `(kind, action)` for a member op
     * (the inverse of `resolveOp`), used to build that op's deprecation note. The
     * `kind` field-collision is resolved here (see `gateFieldRemap`).
     */
    describeOp?: (opName: string) => {
        kind: string;
        action: string;
    } | undefined;
    /**
     * Field-name remap applied to the composite's advertised schema and undone at
     * dispatch. Resolves a collision between a discriminator name and a member-op
     * field of the same name (e.g. `ax.approval.request` has its own `action`
     * field — namespaced to `approvalAction` in the composite so the `action`
     * discriminator wins, then mapped back before invoking the op). Keys are the
     * composite (public) field names; values are the op field names.
     */
    fieldRemap?: Record<string, string>;
}
export declare const compositeToolDefinitions: CompositeToolDefinition[];
/**
 * Deprecation notes for the legacy single-purpose tools, DERIVED from the
 * composites: every operation a composite folds gets a `Deprecated: use
 * canvas_x with action "y".` prefix on its standalone tool description, steering
 * agents to the composite during the v0.2 overlap window (the legacy tools and
 * these notes are removed together in v0.3). Keyed by registry operation name.
 * Deriving it keeps the deprecation list in lockstep with the composites — a new
 * folded action automatically deprecates the tool it replaces.
 */
export declare function buildCompositeDeprecationNotes(definitions?: CompositeToolDefinition[]): Map<string, string>;
