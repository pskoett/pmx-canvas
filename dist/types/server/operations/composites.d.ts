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
 * Migration (docs/api-stability.md + plan-006): composites landed ADDITIVELY in
 * v0.2 alongside the legacy single-purpose tools. As of v0.3.0 the legacy tools
 * those composites fold are REMOVED (registration-suppressed — see
 * `compositeFoldedOpNames` below); every action here maps to a registry-backed
 * operation (plan-005 slices 1–7 + plan-008 Wave 1) that is now reachable ONLY
 * through its composite (or `canvas_batch`).
 *
 * v0.4.0 completed the fold: the `canvas_snapshot` composite shipped (its name
 * was held by the legacy save-snapshot standalone through v0.3.x, which — with
 * the other 5 snapshot standalones — was deprecated in 0.3.0 and removed here
 * per docs/api-stability.md's deprecate-one-minor-before-removal rule).
 * `canvas_screenshot` stays standalone — it returns a binary image payload the
 * composite/registry JSON wire shape does not model.
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
 *    folded-op set), `actionEnum` (the action discriminator values), and
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
     * union (all member-op fields, optional) and to populate the folded-op set
     * (`compositeFoldedOpNames`) that suppresses each member op's standalone
     * registration.
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
 * Operation names FOLDED by a composite, DERIVED from the composites: every op
 * a composite folds had its standalone single-purpose tool REMOVED in v0.3.0
 * (see docs/api-stability.md). This set is the do-not-register list —
 * `registerOperationTools` skips any op whose name is in it, since the op is
 * only reachable through its composite (and through `canvas_batch`) now.
 * Deriving it from the composites keeps suppression in lockstep with them — a
 * newly folded action is automatically suppressed from standalone registration.
 */
export declare function compositeFoldedOpNames(definitions?: CompositeToolDefinition[]): Set<string>;
