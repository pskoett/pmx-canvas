# Reactive Canvas Proposal

> Status: Proposal
> Date: 2026-03-31
> Scope: PMX Canvas architecture extension in this repo

## Decision

Build **Reactive Canvas: a live operating graph powered by a generalized reaction engine**.

This merges the two ideas:

- **Live Operating Graph** is the right product surface: live data on the canvas, semantic edges, AI synthesis, and durable outputs.
- **Canvas Reactions** is the right architectural kernel: it fits the current codebase and turns one-off computed behaviors into a general capability.

The single smartest addition is not query nodes alone and not rules alone. It is making the canvas itself **executable**: nodes and edges become a reactive program the human and agent shape together.

## Evaluation of the Two Inputs

### 1. "Live Operating Graph" is stronger on user value

It points at the clearest step-change in PMX:

- the canvas remembers and updates what matters
- cross-source synthesis becomes ambient instead of prompt-by-prompt
- spatial arrangement becomes configuration, not just presentation

It is compelling because it changes daily behavior:

- fewer repeated prompts
- less tab-juggling
- less manual synthesis across Jira, GitHub, Slack, and metrics
- clearer evidence trails when promoting an insight into durable memory

### 2. "Canvas Reactions" is stronger on implementation leverage

It matches this repo unusually well.

This codebase already has the core ingredients:

- **authoritative server state** in [`src/server/canvas-state.ts`](../src/server/canvas-state.ts)
- **disk persistence** to `.pmx-canvas.json` plus named snapshots
- **mutation recording / suppression** for computed changes
- **SSE fanout** to keep the browser synced
- **MCP / HTTP / SDK parity** as an explicit architectural rule
- a real computed special case today: [`src/server/code-graph.ts`](../src/server/code-graph.ts) auto-generates dependency edges from file nodes using `withSuppressedRecording()`

That means reactions are not a foreign idea. The repo already contains one hardcoded reaction system; it is just not generalized yet.

### 3. The right merge

Treat **reactions as the engine** and **live operating graph primitives as built-in reaction types**.

Concretely:

- query nodes are reaction-driven data sources
- formula nodes are reaction-driven synthesis sinks
- semantic edges define propagation semantics
- custom reaction rules expose the engine directly when users need it
- promotion/export is the durable output seam

## Repo Reality

The proposal should follow the code that exists, not the platform we wish were already here.

### What exists now

- Server-owned singleton canvas state
- SSE layout reconciliation
- Full node / edge persistence on disk
- Snapshot save / restore UX
- Grouping, selection, pinning, search, spatial analysis, code graph, undo / redo

### What does not exist in this checkout

- `product-graph.ts`
- `work-graph.ts`
- a durable evidence store
- a multi-canvas board library

That matters. In this repo, "promote to product memory" should be designed as an **export / integration seam**, not as a direct mutation into modules that are not present.

### Important implication

The original "saved canvases in localStorage" idea is not the right foundation here.

This repo already persists:

- server state to `.pmx-canvas.json`
- snapshots to `.pmx-canvas-snapshots/`
- client layout overrides to localStorage as a cache

So the first implementation should build on **server persistence and snapshots**, not invent a second persistence model.

## Implementation Hazards To Address Early

These are not reasons to avoid the feature. They are the specific places where the current architecture needs to be tightened first.

### 1. Change notifications are too coarse

`CanvasStateManager` only emits `'nodes' | 'pins'` level change notifications today.

Reactive propagation will need more precise events, for example:

- node added / updated / removed
- edge added / removed
- node pinned / unpinned
- query refreshed
- formula computed

### 2. Derived edges need provenance

The current code-graph feature identifies computed edges by ID prefix. That works for one built-in behavior, but it will not scale once multiple derived systems coexist.

Reactive Canvas should add explicit edge provenance, for example:

- `source: 'manual' | 'system'`
- `sourceKind: 'code-graph' | 'query-runtime' | 'reaction'`

Without that, manual and computed edges will collide semantically and operationally.

### 3. Batch updates need to participate in the same event model

The runtime already has multiple mutation paths. Before adding reactions, all server-side writes should reliably drive:

- persistence
- SSE updates
- undo / redo where appropriate
- resource notifications

Reactive behavior built on an incomplete mutation stream will become nondeterministic.

## Proposed Feature

### Core concept

Reactive Canvas turns the canvas into a live, typed graph:

- **sources** emit change events
- **history** records what changed and why
- **edges** define propagation meaning
- **sinks** recompute when upstream inputs change
- **rules** automate common canvas behaviors
- **exports** capture durable evidence when needed

### Primitive 1: Query Nodes

Add a new node type: `query`.

Query nodes bind to a data-producing tool call and refresh on a schedule or manually.

```ts
interface QueryNodeData {
  title: string;
  serverName: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  refreshIntervalMs: number;
  displayMode: 'count' | 'list' | 'table' | 'sparkline';
  lastResult?: unknown;
  lastResultAt?: string;
  lastError?: string;
  status: 'idle' | 'refreshing' | 'error';
}
```

The first implementation should not depend on arbitrary external MCP transport inside the browser. Query execution should be **server-side**, then pushed over the existing SSE channel.

### Primitive 2: Causal Change Ledger

Add a persisted causal ledger that records reactive changes as first-class events.

This is not just mutation history. It captures:

- what changed
- when it changed
- what caused it
- which upstream nodes were involved
- which reaction or runtime path fired
- what the previous and new outputs were

```ts
interface ReactiveEventRecord {
  id: string;
  at: string;
  kind:
    | 'query-diff'
    | 'reaction-fired'
    | 'formula-computed'
    | 'promotion-created'
    | 'manual-override';
  nodeId?: string;
  edgeIds?: string[];
  causeNodeIds?: string[];
  reactionId?: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}
```

User-facing value:

- "What changed since yesterday?"
- "Why did this node turn red?"
- "What caused this formula result?"
- "What changed since I last opened this canvas?"

The ledger is what makes the reactive system trustworthy. Without it, the canvas updates live but cannot explain itself.

### Primitive 3: Semantic Edges

Extend the edge type union with:

- `feeds`
- `compares`
- `blocks`
- `measures`

Existing edge types stay.

Meaning:

- `feeds`: upstream data should trigger downstream recomputation
- `compares`: side-by-side delta or contradiction analysis
- `blocks`: dependency / blocker propagation and attention signaling
- `measures`: compare live state against target / policy / goal

These edges are not just styling. They become routing hints for the reactive engine.

### Primitive 4: Formula-Capable Nodes

Do **not** require a brand-new `formula` node type first.

Instead, let existing display nodes become formula-capable via metadata:

```ts
interface FormulaData {
  formula: string;
  computeStatus: 'idle' | 'computing' | 'stale' | 'error';
  lastComputedAt?: string;
  lastComputedResult?: string;
}
```

This keeps the UI surface smaller:

- markdown node + formula = narrative synthesis
- status node + formula = compact health signal
- json-render / graph node + formula = structured synthesis later

### Primitive 5: Reaction Engine

Add a generalized server-side reaction runtime.

```ts
interface CanvasReaction {
  id: string;
  name: string;
  enabled: boolean;
  trigger:
    | { event: 'node-added' | 'node-updated' | 'node-removed' | 'edge-added' | 'edge-removed' }
    | { event: 'node-pinned' | 'node-unpinned' }
    | { event: 'query-refreshed' }
    | { event: 'formula-computed' }
    | { event: 'manual' };
  match?: Record<string, unknown>;
  action: Record<string, unknown>;
  source: 'system' | 'user' | 'agent';
}
```

Key point: **query refresh and formula recompute are just system reactions**.

That gives one engine with two layers:

- **built-in reactions** for query polling, propagation, code-graph recompute, formula evaluation
- **user / agent-authored reactions** later for things like auto-pin, auto-expand imports, and group summarization

### Primitive 6: Promote / Export

This belongs in the design, but not as a direct write into nonexistent product/work graph modules.

In this repo, the correct v1 shape is:

- `canvas_promote(...)` creates a structured evidence bundle
- bundle can be written to markdown / JSON in the workspace
- bundle can later be consumed by PMX proper or another host system

That keeps PMX Canvas standalone while preserving the future bridge to product memory.

## Why This Merge Is Better Than Either Proposal Alone

### Better than Live Operating Graph alone

Without reactions, query nodes, formula nodes, semantic edges, causal history, and saved boards risk becoming separate features with duplicated scheduling, propagation, and state logic.

### Better than Reactions alone

Without live data and synthesis primitives, reactions are clever but niche. They help debugging boards, but they do not create the broader category-defining surface.

### The merged shape

The canvas becomes:

- a **live dashboard**
- a **causal memory**
- a **spatial synthesis surface**
- a **reaction graph**
- an **evidence capture surface**

All with one conceptual model.

## Proposed Implementation Strategy

### Phase 1: Generalize the Runtime

Goal: create the engine before adding more surface area.

New files:

- `src/server/reaction-engine.ts`
- `src/server/query-runtime.ts`

Modified files:

- `src/server/canvas-state.ts`
- `src/server/index.ts`
- `src/server/server.ts`
- `src/mcp/server.ts`

Deliverables:

- richer typed canvas events
- server-side reaction registry
- typed canvas event stream for reactions
- reaction-safe computed mutations using existing suppression pattern
- provenance for derived edges / derived node updates
- query scheduling as built-in reactions

Why first:

- it subsumes the current hardcoded code-graph pattern cleanly
- it prevents query / formula logic from being bolted on separately

### Phase 2: Ship Query Nodes

Goal: first visible user value.

New files:

- `src/client/nodes/QueryNode.tsx`

Modified files:

- `src/server/canvas-state.ts`
- `src/client/types.ts`
- `src/client/canvas/CanvasViewport.tsx`
- `src/client/canvas/CanvasNode.tsx`
- `src/client/state/sse-bridge.ts`
- `src/server/server.ts`
- `src/server/index.ts`
- `src/mcp/server.ts`

New tools / endpoints:

- `canvas_add_query`
- `canvas_refresh_query`
- `POST /api/canvas/query`
- `POST /api/canvas/query/:id/refresh`

Validation:

- place a live query node on the canvas
- refreshes server-side
- result diffs update the node over SSE
- survives restart because node config lives in the persisted canvas state

### Phase 3: Add the Causal Change Ledger

Goal: make the system explainable and durable before adding more reactive complexity.

New files:

- `src/server/change-ledger.ts`

Possible new UI files:

- `src/client/canvas/ChangeFeedPanel.tsx`

Modified files:

- `src/server/canvas-state.ts`
- `src/server/query-runtime.ts`
- `src/server/server.ts`
- `src/mcp/server.ts`
- `src/client/state/sse-bridge.ts`

New tools / endpoints:

- `canvas_what_changed`
- `canvas_why_changed`
- `GET /api/canvas/changes`
- `GET /api/canvas/changes/node/:id`

Deliverables:

- persisted `ReactiveEventRecord` log
- query diffs recorded as structured events
- reaction and formula executions recorded with causes
- node-level "why did this change?" lookup
- a basic "since last visit" or recent changes feed

Validation:

- a query refresh that changes result writes a readable ledger event
- a user can ask why a node changed and see the causal chain

### Phase 4: Add Semantic Propagation + Formula Nodes

Goal: make the graph compute.

New files:

- `src/server/reactive-graph.ts`
- `src/server/formula-evaluator.ts`

Modified files:

- `src/server/canvas-state.ts`
- `src/client/types.ts`
- `src/client/canvas/EdgeLayer.tsx`
- `src/server/index.ts`
- `src/server/server.ts`
- `src/mcp/server.ts`

Deliverables:

- semantic edge types
- propagation walk from changed source nodes
- debounce / rate-limit formula evaluation
- formula metadata on markdown / status nodes

Validation:

- connect three query nodes to one formula-capable markdown node via `feeds`
- refreshing any upstream node recomputes the formula result once

### Phase 5: Expose Custom Reactions

Goal: let humans and agents program the canvas directly.

Possible new files:

- `src/client/nodes/ReactionNode.tsx`

New tools:

- `canvas_add_reaction`
- `canvas_remove_reaction`
- `canvas_list_reactions`
- `canvas_toggle_reaction`

Starter built-in actions:

- pin node
- focus node
- refresh query
- evaluate formula
- add import neighbors
- upsert summary node

Validation:

- debugging board can auto-pin red status nodes
- pinning a file can expand one-hop imports using the same generalized runtime

### Phase 6: Promote / Export

Goal: capture durable evidence without coupling this package to PMX internals that are not here.

New files:

- `src/server/canvas-promotion.ts`

Possible outputs:

- `docs/canvas-promotions/*.md`
- `artifacts/canvas-promotions/*.json`

Tool:

- `canvas_promote`

Validation:

- selecting a cluster can produce a timestamped evidence bundle with node refs, snapshots, and structured summary

## Non-Goals for This Repo's First Pass

- No direct mutation of `product-graph.ts` or `work-graph.ts` here
- No fully normalized evidence warehouse beyond the causal change ledger
- No multi-board storage system before reaction runtime exists
- No background live refresh for unopened canvases in v1
- No arbitrary browser-side MCP execution

## Saved Canvases, Re-scoped

The original "saved canvases" idea is still good, but it should be built on existing persistence primitives.

Recommended path:

- keep the existing always-persisted working canvas
- keep snapshots as named restore points
- later evolve snapshots into named "boards" if the workflow proves necessary

That avoids fighting the current architecture too early.

## Concrete Use Cases

### 1. Sprint Operating Board

- Query nodes: Jira bugs, stale PRs, deploy frequency
- Causal ledger: "bug count spiked after QA import" is visible as a recent change, not inferred from memory
- Semantic edges: all three `feed` a markdown node with a formula
- Formula output: a one-line sprint health summary
- Promote/export: capture the board state as a risk or status record

### 2. Production Investigation Board

- File nodes and status nodes already exist
- Reactions auto-pin red statuses and expand import neighbors on pin
- Query nodes later add live incident data or failing checks
- Formula node summarizes root-cause confidence as evidence accumulates

This is why the merge works: it serves both PM workflows and engineering investigation without creating two products.

## Success Criteria

Phase 1-2 are successful if:

- a user can create a live query node in under a minute
- query refreshes survive restart
- query updates arrive over SSE without corrupting layout reconciliation

Phase 3 is successful if:

- a user can answer "what changed?" and "why did this change?" without re-running analysis
- query, reaction, and formula events are persisted in a form that can later support promotion and summaries

Phase 4 is successful if:

- a formula-capable node recomputes from connected upstream data without duplicate evaluations
- semantic edges change behavior, not just visuals

Phase 5 is successful if:

- at least two current hardcoded behaviors can be expressed as reactions
- one user-authored debugging rule works end-to-end

Phase 6 is successful if:

- a promoted bundle provides enough evidence for later human review
- the export seam is useful before deeper PMX integration exists

## Recommendation

Build this as **Reactive Canvas**, with the following framing:

- **product promise**: a live operating graph on a spatial canvas
- **technical kernel**: a generalized reaction engine
- **first visible wedge**: query nodes
- **first trust layer**: a causal change ledger
- **first compounding step**: formula-capable nodes + semantic propagation
- **future bridge**: evidence export and promotion into external product memory systems

That is the most innovative, accretive, and buildable version of the idea in this repo as it exists today.
