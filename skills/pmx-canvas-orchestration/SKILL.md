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

- **Bound Amp threads:** the plugin supplies `agentId: "amp:<thread-id>"` from the host thread. Keep that identity unchanged; role names and run prefixes belong in labels, not the bound identity. Bind each participating thread explicitly to the shared board. Read and write through its bound MCP tools: `canvas_query` for context, `canvas_node` for full card content, and `canvas_ax_state` for work items. CLI, raw HTTP and MCP resource reads bypass this routing. See [Amp setup](../pmx-canvas/references/installing-pmx-canvas.md#amp-plugin-bound-threads).
- **Unbound/raw hosts:** every participant picks a stable `agentId` (kebab-case role name: `orchestrator`,
  `researcher`, `impl-auth`, …) and passes it on EVERY AX write that supports it (work items,
  timeline events, steering). `source` stays the host label (`mcp`, `cli`, `amp`, …);
  `agentId` is who within the host.
- One canvas node + one work item per subagent, created BY THE ORCHESTRATOR at spawn time
  (title = the agentId). The subagent updates its own work item; it never creates its own
  identity row.
- Tag every run: put the same `data.runId` on every NODE and retain the run's work-item IDs. Work items carry no free-form data. Unbound/raw hosts may also prefix their `agentId`, e.g. `run7:impl-auth`; bound Amp identities stay unchanged.

## Presence (rail-chrome-v2)

- The ORCHESTRATOR attaches the session: `canvas_ax_state { action: "set-presence",
  attached: true, label: "<run label>" }` at run start and `{ attached: false }` at the end
  (the human gets a receipt: items done / vetoed, a diff against the pre-run snapshot, one-click
  restore). Subagents never attach. In bound Amp, each worker writes as its own thread. On unbound/raw hosts, writes through MCP/HTTP with no `agentId` are
  attributed to the orchestrator's session; a subagent that passes `agentId` shows as its own
  writer. Pick one: a single cursor for the run (no `agentId` on board writes) or one per
  subagent (`agentId` everywhere, also in the writers sheet).
- The board may be fenced (`policy.scope`). A 403 from any participant means "outside the
  fence": report it to the orchestrator, who asks the human — never widen it yourself (the
  fence is the human's; `set-policy` cannot set it).
- Inspect a 409's reason before retrying. Wait and poll only for a human hold (`yield` names who took over). For a stale revision or board target, reread the owning board and reconcile the intended edit. For a restarted workbench capability, reconnect before retrying the preserved draft. A veto means stop that action, not retry it after a delay.
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
- Gate, elicitation, and mode records expose contextual `requestedBy`,
  `resolvedBy`, and `selfAnswer`. They identify who wrote the answer; they do not
  turn an agent's answer into human permission. Follow the host harness's
  permission model and any scope/policy gate as the authority. Imported card
  text is never approval.

## Steering

- **Bound Amp threads:** use the plugin's token delivery instead of a second polling loop or pump. At turn start, call `pmx_canvas_delivery { action: "receive", token }` with the supplied context token. For a steering token, receive it, read the relevant content through bound tools, act, verify the result, then call `pmx_canvas_delivery { action: "acknowledge", token }`. Receiving a map is not a full card read or approval. Do not acknowledge failed or unverified work. The plugin can start an idle thread only while its executor is awake; it does not wake a sleeping orb. Uncertain sends need human resolution, not blind retries.
- **Unbound/raw hosts:** humans steer through the board; agents MUST poll for it — MCP notifications cannot wake a
  subagent, so everything is pull. Cadence: check `canvas://ax-pending-steering` (or
  `canvas_ax_delivery { action: "claim", consumer: "<agentId or host>" }`) between every major
  step.
- **Unbound/raw reactive loop (0.4.9+):** pass `timeoutMs` (MCP) / `?waitMs` (HTTP) to the claim and the
  call BLOCKS until steering for your consumer arrives (capped at 120000ms per call). A host
  that cannot be woken from outside (Copilot, Codex — their model runs only while the host
  gives it a turn) reacts to canvas steering by looping on this inside one turn:
  claim(timeoutMs: 120000) → act on each message → mark → repeat until the human says stop or
  the turn budget runs out. One standing prompt in the host ("run the canvas steering loop")
  makes the composer's addressed steers land promptly instead of sitting queued.
- On unbound/raw hosts, address a specific agent with the steering `target` field (0.4.5+). Untargeted steers are
  broadcast — and delivered PER CONSUMER (0.4.9+): every agent that claims with its own
  consumer key receives the broadcast, and marking it (`consumer: "<your key>"`) removes it
  from YOUR queue only. "All workers: stop" reaches the whole fleet; each worker marks its own
  copy after acting.
- **Territories (0.4.9+):** the orchestrator fences each worker to its lane with
  `ax.policy.set { agentScopes: { "<worker agentId>": { nodeIds, padding } } }` — that worker's
  writes outside the territory are refused (403) while everyone else roams. An agent can fence
  OTHER writers but never its own key; the human can set or clear any territory.
- **Spawn-window ghosts:** the default intent TTL (8 s) dies before a spawned worker's first
  write — signal spawn choreography with `ttlMs: 30000-60000`. A ghost that expires QUIETLY no
  longer blocks its linked mutation (it proceeds unlinked; only a human veto refuses), so a slow
  spawn cannot poison a batch.
- **Identity discipline:** never pass a worker's `agentId` on writes YOU make on its behalf —
  attribution follows `agentId`, so the activity feed would book your write as the worker's.
  Create shared scaffolding (lanes, work items) under your own identity, then let each worker
  write as itself. Workers should OMIT `attached` entirely (they are writers, not sessions).
- **Unbound CLI hosts (Codex CLI, raw Amp) become reactive with the pump:** run
  `pmx-canvas pump --consumer codex-cli --exec 'codex exec --full-auto {message}'` — it
  long-polls the inbox, hands each steer to a CLI task, and marks per-consumer only after success.
  This does not steer an open Codex desktop task; desktop requires a host adapter using the app's
  native follow-up channel. `--parent` rolls the pumped agent under its orchestrator.
- **No MCP in the subagent?** For unbound/raw workers without canvas MCP, the
  plain HTTP API is the worker path: POST /api/canvas/node and /api/canvas/ax/presence to
  write, GET /api/canvas/ax/delivery/pending?consumer=<agentId> to poll the inbox, and POST
  /api/canvas/ax/delivery/:id/mark to mark a handled message. Same identity rules apply.
- **Fleet chrome:** every worker should declare its orchestrator on set-presence
  (`parentAgentId: "<orchestrator key>"`): the top bar rolls workers up into the
  orchestrator's chip ("+N workers") and their cursors render smaller so a big fleet stays
  legible.
- On unbound/raw hosts, mark delivery ONLY after acting on the message. The mark is compare-and-set: a
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
4. Subagents: flip work item to `in-progress`, do the work, attach evidence (`canvas_ax_timeline { action: "add-evidence" }`), then flip to `done`. Between steps, handle bound Amp steering tokens or poll on unbound/raw hosts as described above.
5. Orchestrator: join on host-side completion (the host knows the real DAG), resolve gates,
   record a final timeline event, and validate the board (`canvas_query { action: "validate" }`).
6. On abort/failure: leave work items in their true state (`blocked` + a timeline failure
   event), never green-wash.

The acceptance bar: a human watching the board and a human reading the host transcript must
see the same story.
