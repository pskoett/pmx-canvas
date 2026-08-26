---
name: pmx-canvas-orchestration
description: Choreography for running multi-agent orchestration ON a PMX Canvas board — the agent host (Claude Code, Copilot, Codex) executes; the canvas is the shared graph, state, human-steering surface, and audit trail. Load this in the ORCHESTRATOR session and in EVERY subagent that touches the board.
---

# PMX Canvas Orchestration

The division of labor is fixed: **the agent host runs the loop** (spawning, scheduling,
fan-out/join, retries); **the canvas is the graph** (persistent shared state, the live visual,
human gates and steering, the timeline). The canvas never executes anything. This skill is the
choreography that makes that split work — both the orchestrator and every subagent must follow
it, or the board silently diverges from reality.

## Identity

- Every participant picks a stable `agentId` (kebab-case role name: `orchestrator`,
  `researcher`, `impl-auth`, …) and passes it on EVERY AX write that supports it (work items,
  timeline events, steering). `source` stays the host label (`mcp`, `cli`, `amp`, …);
  `agentId` is who within the host.
- One canvas node + one work item per subagent, created BY THE ORCHESTRATOR at spawn time
  (title = the agentId). The subagent updates its own work item; it never creates its own
  identity row.
- Tag every run: put the same `data.runId` on every NODE (work items carry no free-form data —
  their run scoping comes from the run-prefixed `agentId`, e.g. `run7:impl-auth`), so
  consecutive orchestrations don't interleave in the bounded timeline.

## Presence (rail-chrome-v2)

- The ORCHESTRATOR attaches the session: `canvas_ax_state { action: "set-presence",
  attached: true, label: "<run label>" }` at run start and `{ attached: false }` at the end
  (the human gets a receipt: items done / vetoed, a diff against the pre-run snapshot, one-click
  restore). Subagents never attach — writes they make through MCP/HTTP with no `agentId` are
  attributed to the orchestrator's session; a subagent that passes `agentId` shows as its own
  writer. Pick one: a single cursor for the run (no `agentId` on board writes) or one per
  subagent (`agentId` everywhere, also in the writers sheet).
- The board may be fenced (`policy.scope`). A 403 from any participant means "outside the
  fence": report it to the orchestrator, who asks the human — never widen it yourself (the
  fence is the human's; `set-policy` cannot set it).
- A 409 means a human is holding that node right now: requeue that step's write and retry
  after the next steering poll. A `yield` timeline event names who took over.
- Unanswered gates auto-hold (`held`) after their TTL: treat `held` as "do not proceed" and
  keep the subagent's step `blocked` until the human reopens and answers.

## Graph semantics

- `flow` edges = planned sequence. `depends-on` edges = blocking dependency (the visual DAG).
  `relation`/`references` = context only — never scheduling.
- The orchestrator owns the topology: it creates all nodes and edges up front with one
  `canvas_batch`, then only mutates statuses. Subagents mutate their OWN node/work item only.
- The host's real execution order is authoritative. When the host reorders or skips, the
  orchestrator updates the edges — a board that contradicts execution is worse than no board.

## Status discipline

- Work-item status is the single source of step state: `todo → in-progress → done`
  (or `blocked` / `cancelled`). Update the work item FIRST; linked nodes mirror the status automatically
  (0.4.5+) — do not hand-edit a status node to fake progress.
- Signal `canvas_intent` before each phase of visible board mutation (the auto-ghost floor
  covers forgotten signals, but only an explicit signal gives the human a veto window and your
  reasoning).

## Gates and human input

- ALL approval gates, elicitations, and mode requests are created and awaited by the
  ORCHESTRATOR, never by subagents. `canvas_ax_gate { action: "await" }` blocks at most ~120s
  per call — the orchestrator re-awaits in a loop; a subagent burning turns on a gate wait is
  a bug.
- A pending gate is NOT approval. Execution-class actions stay blocked until the gate is
  explicitly `approved`.

## Steering

- Humans steer through the board; agents MUST poll for it — MCP notifications cannot wake a
  subagent, so everything is pull. Cadence: check `canvas://ax-pending-steering` (or
  `canvas_ax_delivery { action: "claim", consumer: "<agentId or host>" }`) between every major
  step.
- **Reactive loop (0.4.9+):** pass `timeoutMs` (MCP) / `?waitMs` (HTTP) to the claim and the
  call BLOCKS until steering for your consumer arrives (capped at 120000ms per call). A host
  that cannot be woken from outside (Copilot, Codex — their model runs only while the host
  gives it a turn) reacts to canvas steering by looping on this inside one turn:
  claim(timeoutMs: 120000) → act on each message → mark → repeat until the human says stop or
  the turn budget runs out. One standing prompt in the host ("run the canvas steering loop")
  makes the composer's addressed steers land promptly instead of sitting queued.
- Address a specific agent with the steering `target` field (0.4.5+). Untargeted steers are
  broadcast: only the ORCHESTRATOR claims them and re-routes; subagents claim only steers
  targeted at their own `agentId`.
- Mark delivery ONLY after acting on the message. The mark is compare-and-set: a
  `delivered:false` response means another consumer owned it — drop it, do not act twice.
- Steering comes from more places than the command bar: a gate rejection, the human undoing
  one of your board edits ("Undid your edit: …"), a take-over of a node you were editing, and
  vetoed ghost intents all arrive as steering. The orchestrator re-routes them to the subagent
  whose node they name.

## Run lifecycle

1. Orchestrator: snapshot the board (`canvas_snapshot save`) before the run.
2. Orchestrator: one `canvas_batch` creating the run's nodes + edges (+ `data.runId`), one
   work item per step/subagent, intent-signaled.
3. Spawn subagents; each loads this skill, learns its `agentId`, node id, and work-item id
   from the spawn prompt.
4. Subagents: flip work item to `in-progress`, do the work, attach evidence
   (`canvas_ax_timeline { action: "add-evidence" }`), flip to `done`, poll steering between
   steps.
5. Orchestrator: join on host-side completion (the host knows the real DAG), resolve gates,
   record a final timeline event, and validate the board (`canvas_query { action: "validate" }`).
6. On abort/failure: leave work items in their true state (`blocked` + a timeline failure
   event), never green-wash.

The acceptance bar: a human watching the board and a human reading the host transcript must
see the same story.
