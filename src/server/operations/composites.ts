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

import { z, type ZodRawShape, type ZodTypeAny } from 'zod';

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
  resolveOp?: (input: { kind: string; action: string }) => string | undefined;
  /**
   * Two-discriminator extension: human-readable `(kind, action)` for a member op
   * (the inverse of `resolveOp`), used to build that op's deprecation note. The
   * `kind` field-collision is resolved here (see `gateFieldRemap`).
   */
  describeOp?: (opName: string) => { kind: string; action: string } | undefined;
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

// ── canvas_ax_gate (plan-007 Slice C): kind × action → 9 ops → 1 tool ─────────

const GATE_KINDS = ['approval', 'elicitation', 'mode'] as const;
const GATE_ACTIONS = ['request', 'resolve', 'await'] as const;

/**
 * Resolve a gate op from its discriminators. Note the irregularities:
 *  - `await` reads the long-poll GET op (`ax.<kind>.get`), NOT `ax.<kind>.await`.
 *  - `resolve` for an elicitation is `ax.elicitation.respond` (not `.resolve`).
 * Returns undefined for an invalid combo so dispatch raises a loud error.
 */
function resolveGateOp(input: { kind: string; action: string }): string | undefined {
  const { kind, action } = input;
  if (!(GATE_KINDS as readonly string[]).includes(kind)) return undefined;
  if (action === 'request') return `ax.${kind}.request`;
  if (action === 'await') return `ax.${kind}.get`;
  if (action === 'resolve') return kind === 'elicitation' ? 'ax.elicitation.respond' : `ax.${kind}.resolve`;
  return undefined;
}

/** The 9 gate ops, in (kind, action) order — single source for memberOps + describeOp. */
const GATE_OPS: Array<{ op: string; kind: string; action: string }> = GATE_KINDS.flatMap((kind) =>
  GATE_ACTIONS.map((action) => {
    const op = resolveGateOp({ kind, action });
    // Every (GATE_KINDS × GATE_ACTIONS) combo must resolve. Fail loud at module
    // load if a new action/kind is added without a matching resolveGateOp branch,
    // rather than silently propagating the string "undefined" as an op name.
    if (!op) throw new Error(`resolveGateOp has no mapping for kind="${kind}" action="${action}".`);
    return { op, kind, action };
  }),
);

function describeGateOp(opName: string): { kind: string; action: string } | undefined {
  const match = GATE_OPS.find((entry) => entry.op === opName);
  return match ? { kind: match.kind, action: match.action } : undefined;
}

export const compositeToolDefinitions: CompositeToolDefinition[] = [
  {
    toolName: 'canvas_node',
    description:
      'Create, read, update, or remove a canvas node. One tool for node CRUD: action "add" creates a node (requires type — markdown, status, context, ledger, trace, file, image, webpage, html, group, etc.); "get" reads one node by id; "update" patches an existing node (title, content, position, size, data); "remove" deletes a node by id. For spec-driven content (json-render, graph) use canvas_render; for external/built apps use canvas_app (actions: open-mcp-app, diagram, build-artifact).',
    actionSummary: 'add | get | update | remove',
    actions: {
      add: 'node.add',
      get: 'node.get',
      update: 'node.update',
      remove: 'node.remove',
    },
  },
  {
    toolName: 'canvas_render',
    description:
      'Spec-driven content: discover the schema, validate a payload, or create a json-render / graph node. Action "describe-schema" returns the json-render component catalog + create schemas; "validate" checks a spec or graph payload without creating a node; "add-json-render" creates a json-render node from a complete spec; "stream-json-render" progressively builds one from SpecStream patches (omit nodeId to create, pass it back to append, done=true to finish); "add-graph" creates a chart node (line, bar, pie, area, scatter, radar, stacked-bar, composed, sparkline, dot-plot, bullet, slopegraph).',
    actionSummary: 'describe-schema | validate | add-json-render | stream-json-render | add-graph',
    actions: {
      'describe-schema': 'schema.describe',
      validate: 'spec.validate',
      'add-json-render': 'jsonrender.add',
      'stream-json-render': 'jsonrender.stream',
      'add-graph': 'graph.add',
    },
  },
  {
    toolName: 'canvas_edge',
    description:
      'Add or remove an edge (connection) between two nodes. Action "add" connects two nodes (type: flow=sequential, depends-on=dependency, relation=general, references=cross-reference; from/to take node ids, or fromSearch/toSearch resolve by title/content); "remove" deletes an edge by id.',
    actionSummary: 'add | remove',
    actions: {
      add: 'edge.add',
      remove: 'edge.remove',
    },
  },
  {
    toolName: 'canvas_group',
    description:
      'Manage node groups. Action "create" makes a new group (optionally with initial child node ids); "add" moves nodes into an existing group; "ungroup" dissolves a group, releasing its children.',
    actionSummary: 'create | add | ungroup',
    actions: {
      create: 'group.create',
      add: 'group.add',
      ungroup: 'group.remove',
    },
  },
  {
    toolName: 'canvas_history',
    description:
      'Step through canvas mutation history. Action "undo" reverses the last mutation; "redo" reapplies it. History is session-scoped (in-memory, last 200 operations).',
    actionSummary: 'undo | redo',
    actions: {
      undo: 'canvas.undo',
      redo: 'canvas.redo',
    },
  },
  {
    toolName: 'canvas_view',
    description:
      'Canvas viewport and layout control. Action "arrange" auto-lays-out nodes (grid/columns/etc.); "focus" pans/zooms the viewport to a node; "fit" zooms to fit all nodes in view; "clear" removes every node and edge from the canvas; "remove-annotation" deletes a human-drawn annotation by id.',
    actionSummary: 'arrange | focus | fit | clear | remove-annotation',
    actions: {
      arrange: 'arrange',
      focus: 'node.focus',
      fit: 'view.fit',
      clear: 'canvas.clear',
      'remove-annotation': 'annotation.remove',
    },
  },
  {
    toolName: 'canvas_query',
    description:
      'Read the board cheapest-first. Action "search" finds nodes by title/content keywords (prefer this before reading the full layout); "layout" returns the full node/edge layout; "validate" checks the board for node collisions, group-containment issues, and missing edge endpoints. Use search to locate, then layout or canvas_node get for detail.',
    actionSummary: 'search | layout | validate',
    actions: {
      search: 'search',
      layout: 'layout.get',
      validate: 'validate.get',
    },
  },
  {
    toolName: 'canvas_app',
    description:
      'Open external / built-content apps on the canvas. Action "open-mcp-app" connects to an external MCP server that declares a ui:// app resource, calls a tool, and opens the result inside an mcp-app node (full transport call — pass transport + toolName); "diagram" draws a hand-drawn diagram via the hosted Excalidraw preset (pass elements); "build-artifact" bundles a single-file HTML web artifact from React/Tailwind source (title + appTsx) and optionally opens it on the canvas. build-artifact can be long-running (minutes) on cold workspaces — set a long client timeout.',
    actionSummary: 'open-mcp-app | diagram | build-artifact',
    actions: {
      'open-mcp-app': 'mcpapp.open',
      diagram: 'diagram.open',
      'build-artifact': 'webartifact.build',
    },
  },
  {
    toolName: 'canvas_webview',
    description:
      'Drive the headless Bun.WebView automation session for the workbench. Action "status" reads automation status (supported, active, backend, viewport, url); "start" starts/replaces the session (backend chrome|webkit, width, height, chromePath, chromeArgv, dataStoreDir); "stop" stops the active session; "resize" sets the viewport (width, height required); "evaluate" runs JavaScript in the page (pass exactly one of expression or script; script is wrapped in an async IIFE). Capturing a screenshot is NOT folded here — use the standalone canvas_screenshot tool (it returns a binary image payload).',
    actionSummary: 'status | start | stop | resize | evaluate',
    actions: {
      status: 'webview.status',
      start: 'webview.start',
      stop: 'webview.stop',
      resize: 'webview.resize',
      evaluate: 'webview.evaluate',
    },
  },
  // ── AX composites (plan-007 Slice C / plan-006 §11–15) ───────────
  {
    toolName: 'canvas_ax_state',
    description:
      'Read or set host-agnostic PMX AX state. Action "get" reads the AX state + agent-ready context (pinned/focused context, focus field); "set-focus" places node IDs in the AX focus field (nodeIds); "set-policy" patches the tool/prompt policy (tools.allowed|excluded|approvalRequired, prompt.systemAppend|mode — merges with existing); "report-capability" records a host/session capability for diagnostics. Adapters may pass a source label (e.g. codex).',
    actionSummary: 'get | set-focus | set-policy | report-capability',
    actions: {
      get: 'ax.get',
      'set-focus': 'ax.focus.set',
      'set-policy': 'ax.policy.set',
      'report-capability': 'ax.host-capability.report',
    },
  },
  {
    toolName: 'canvas_ax_work',
    description:
      'Manage canvas-bound AX work items and review annotations. Action "add" creates a work item (title, optional status todo|in-progress|blocked|done|cancelled, detail, nodeIds); "update" patches a work item by id (title/status/detail/nodeIds); "annotate" adds a review annotation (comment/finding) anchored to a node, file, or region (body, kind, severity, anchorType, nodeId/file/region). Work items and review annotations participate in snapshots and are exposed via canvas://ax-work.',
    actionSummary: 'add | update | annotate',
    actions: {
      add: 'ax.work.create',
      update: 'ax.work.update',
      annotate: 'ax.review.add',
    },
  },
  {
    toolName: 'canvas_ax_gate',
    description:
      'Drive the full lifecycle of a canvas-bound AX gate — request, resolve, or await — across all three gate kinds. kind: approval | elicitation | mode. action: request (open a pending gate), resolve (approval/mode take a decision approved|rejected; elicitation takes a response object), await (block until the gate leaves pending or timeoutMs elapses; 0 = immediate read). Gates are canvas-bound, snapshotted, and exposed via canvas://ax-work. NOTE: the approval machine-readable action identifier is passed as approvalAction (the action field is the lifecycle discriminator).',
    actionSummary: 'request | resolve | await (× kind: approval | elicitation | mode)',
    actions: {},
    actionEnum: GATE_ACTIONS,
    extraDiscriminatorShape: {
      kind: z.enum(GATE_KINDS).describe('Gate kind: approval | elicitation | mode.'),
    },
    memberOps: GATE_OPS.map((entry) => entry.op),
    resolveOp: resolveGateOp,
    describeOp: describeGateOp,
    // ax.approval.request defines its own optional `action` field (a
    // machine-readable identifier the gate guards) — it collides with the gate
    // lifecycle `action` discriminator. Namespace it to `approvalAction` in the
    // composite schema and map it back to `action` before invoking the op, so the
    // approval field stays settable AND the discriminator stays clean. (Verified:
    // `action` is the ONLY field on any of the 9 gate ops that collides with a
    // discriminator name.)
    fieldRemap: {
      approvalAction: 'action',
    },
  },
  {
    toolName: 'canvas_ax_timeline',
    description:
      'Read or write the bounded PMX AX timeline. Action "read" returns recent agent-events, evidence, and steering messages plus counts (limit); "record-event" records a normalized agent-event (kind prompt|assistant-message|tool-start|tool-result|failure|approval|steering, summary, detail, data); "add-evidence" records an evidence item (kind logs|tool-result|screenshot|file|diff|test-output, title, body, ref); "send-steering" records a steering message (message). Timeline rows persist for diagnostics/continuity but are not restored by snapshots; exposed via canvas://ax-timeline.',
    actionSummary: 'read | record-event | add-evidence | send-steering',
    actions: {
      read: 'ax.timeline.get',
      'record-event': 'ax.event.record',
      'add-evidence': 'ax.evidence.add',
      'send-steering': 'ax.steer',
    },
  },
  {
    toolName: 'canvas_ax_delivery',
    description:
      'Adapterless PMX AX delivery. Action "claim" claims pending undelivered steering for a consumer (loop-safe — never returns steering the consumer originated) plus pendingActivity (open work items / approval gates / elicitations / mode requests awaiting the agent); "mark" marks a steering message delivered by id so it is not handed out again. Resolve pendingActivity via canvas_ax_gate / canvas_ax_work, not mark.',
    actionSummary: 'claim | mark',
    actions: {
      claim: 'ax.delivery.pending',
      mark: 'ax.delivery.mark',
    },
  },
  {
    toolName: 'canvas_intent',
    description:
      'Ghost Cursor of Intent — announce the spatial move you are ABOUT to make so the canvas paints a faint pre-commit placeholder (legibility: the human sees the next move forming, and can veto it). Action "signal" registers an intent (kind create|move|connect|remove|edit; pass position for create/move, nodeId for move/edit/remove, edge for connect; optional label, reason, confidence 0..1, seq, ttlMs, and a stable id); "update" patches a live intent by id; "clear" abandons/dissolves it. To make veto authoritative, pass the returned id as intentId on the real canvas_node/canvas_edge/canvas_group/canvas_render mutation: vetoed or expired intents are rejected, and a successful linked mutation settles the ghost automatically. Intents are ephemeral presence: never persisted, never snapshotted, auto-expire (~8s).',
    actionSummary: 'signal | update | clear',
    actions: {
      signal: 'intent.signal',
      update: 'intent.update',
      clear: 'intent.clear',
    },
  },
];

/**
 * Deprecation notes for the legacy single-purpose tools, DERIVED from the
 * composites: every operation a composite folds gets a `Deprecated: use
 * canvas_x with action "y".` prefix on its standalone tool description, steering
 * agents to the composite during the v0.2 overlap window (the legacy tools and
 * these notes are removed together in v0.3). Keyed by registry operation name.
 * Deriving it keeps the deprecation list in lockstep with the composites — a new
 * folded action automatically deprecates the tool it replaces.
 */
export function buildCompositeDeprecationNotes(
  definitions: CompositeToolDefinition[] = compositeToolDefinitions,
): Map<string, string> {
  const notes = new Map<string, string>();
  for (const def of definitions) {
    // Single-discriminator composites: one note per (action → op).
    for (const [action, opName] of Object.entries(def.actions)) {
      notes.set(opName, `Deprecated: use ${def.toolName} with action "${action}". `);
    }
    // Two-discriminator composites (canvas_ax_gate): one note per member op,
    // each mapped back to its (kind, action) so the deprecation points exactly
    // at the composite invocation that replaces the legacy tool.
    if (def.memberOps && def.describeOp) {
      for (const opName of def.memberOps) {
        const combo = def.describeOp(opName);
        if (!combo) continue;
        notes.set(
          opName,
          `Deprecated: use ${def.toolName} with kind "${combo.kind}" action "${combo.action}". `,
        );
      }
    }
  }
  return notes;
}
