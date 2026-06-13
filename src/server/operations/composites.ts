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
 * shrinks when the legacy tools are removed in v0.3). This file ships the
 * composites whose every action maps to a registry-backed operation TODAY
 * (plan-005 slices 1–4). Actions that would dispatch to a not-yet-migrated
 * operation (`refresh`, `add-primitive`, `remove-annotation`, board validation)
 * are intentionally omitted for now — their legacy standalone tools remain —
 * and fold in once the AX / side-channel registry slices (plan-005 items 7–8) land.
 * The action enums are forward-compatible: adding an action later is additive.
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

/** One composite MCP tool: a frozen tool name + its action→operation routing. */
export interface CompositeToolDefinition {
  /** Frozen public tool name (see tests/unit/mcp-tool-freeze.test.ts). */
  toolName: string;
  description: string;
  /** Human-readable action list for the `action` enum description. */
  actionSummary: string;
  /**
   * Map of `action` value → registry operation name. Every referenced op MUST
   * have an `mcp` block — its `buildInput`/`formatResult` are reused so the
   * composite action matches the legacy standalone tool exactly.
   */
  actions: Record<string, string>;
}

export const compositeToolDefinitions: CompositeToolDefinition[] = [
  {
    toolName: 'canvas_node',
    description:
      'Create, read, update, or remove a canvas node. One tool for node CRUD: action "add" creates a node (requires type — markdown, status, context, ledger, trace, file, image, webpage, html, group, etc.); "get" reads one node by id; "update" patches an existing node (title, content, position, size, data); "remove" deletes a node by id. For spec-driven content (json-render, graph) use canvas_render; for external/built apps use the current legacy tools: canvas_open_mcp_app, canvas_add_diagram, or canvas_build_web_artifact.',
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
      'Canvas viewport and layout control. Action "arrange" auto-lays-out nodes (grid/columns/etc.); "focus" pans/zooms the viewport to a node; "fit" zooms to fit all nodes in view; "clear" removes every node and edge from the canvas.',
    actionSummary: 'arrange | focus | fit | clear',
    actions: {
      arrange: 'arrange',
      focus: 'node.focus',
      fit: 'view.fit',
      clear: 'canvas.clear',
    },
  },
  {
    toolName: 'canvas_query',
    description:
      'Read the board cheapest-first. Action "search" finds nodes by title/content keywords (prefer this before reading the full layout); "layout" returns the full node/edge layout. Use search to locate, then layout or canvas_node get for detail.',
    actionSummary: 'search | layout',
    actions: {
      search: 'search',
      layout: 'layout.get',
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
    for (const [action, opName] of Object.entries(def.actions)) {
      notes.set(opName, `Deprecated: use ${def.toolName} with action "${action}". `);
    }
  }
  return notes;
}
