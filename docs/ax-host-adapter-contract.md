# AX host-adapter contract

PMX Canvas owns the **AX data layer** — work items, approval gates, steering,
evidence, review annotations, elicitations, mode requests, the timeline, host
capabilities, and the tool/prompt policy — over HTTP and MCP. What makes AX
*interactive* on a given coding harness (GitHub Copilot, Codex, Claude Code, …) is
a thin **adapter** that wires PMX's neutral surfaces to that harness's lifecycle.

"Agnostic" means a documented interface plus PMX-side behavior plus one small
reference adapter per harness — not zero-adapter magic. The genuinely harness-owned
acts (waking a turn, per-turn context injection, forwarding native tool hooks,
native modals) still need a per-harness adapter; PMX owns everything on its side of
the line (queues, endpoints, schemas, the canvas-surface fallback).

## The interface

Every adapter implements as much of this as its host allows; PMX provides the
surface each one binds to.

| Adapter method | PMX surface (owned) | Harness-owned part |
| --- | --- | --- |
| `pullContext()` | `GET /api/canvas/ax/context?consumer=<id>` · `canvas://ax-context` — full board **plus** a compact `delivery` lead block | When/where to inject it into the model's turn |
| `deliverSteer()` | `GET /api/canvas/ax/delivery/pending?consumer=<id>` · `canvas_ax_delivery { action: "claim" }` → act → `POST …/delivery/<id>/mark` · `canvas_ax_delivery { action: "mark" }` | Calling the host's native send/wake |
| `ingestActivity(event)` | `POST /api/canvas/ax/activity` · `canvas_ingest_activity` — board auto-reacts | Forwarding the host's tool/session hooks |
| `awaitGate(id)` | `GET /api/canvas/ax/{approval\|elicitation\|mode}/<id>?waitMs=` · `canvas_ax_gate { kind: "approval"\|"elicitation"\|"mode", action: "await" }` | Optionally surfacing a native modal; the agent must await PMX |
| `mirrorLog(event)` *(optional)* | `GET /api/canvas/ax/timeline` · `canvas://ax-timeline` | Writing AX events into the host's own chat/session log |

## Steering is gated, not pushed (#54)

A board action (e.g. an `ax.steer` emit from a surface button) enqueues a steering
message; it does **not** wake the agent. It reaches the next turn only when:

1. **The pin/focus gate is open.** A typical adapter injects `/api/canvas/ax/context`
   only when something is pinned or focused (`pinned.count > 0 || focus.nodeIds.length > 0`).
   A steering board must therefore stay pinned, or its button should also emit
   `ax.focus.set` on the board node, to hold the gate open.
2. **A human message fires the turn.** A sandbox button click cannot itself create a
   new agent turn (an app-platform constraint). Any human prompt triggers the injection.
3. **The agent acts, then acks.** Injected `pendingSteering` / `pendingActivity` is
   *to-do*, not narration: act on it, then `canvas_ax_delivery { action: "mark" }`
   the steering (or resolve the work item / gate). Until acked, steering re-injects every gated turn.

The `delivery` lead block (`GET /api/canvas/ax/context?consumer=<id>`) is the
robustness hedge: it's compact and sits above the full dump, so an adapter can inject
it un-truncated even on a busy board where the full context is clipped. Its
`pendingSteering` is **newest-first** (most recent at index 0), capped at 10, so a
*fresh* steer is always visible even behind a long backlog of old unacked steers
(report #57); `delivery.totalPending` / `delivery.omittedPending` tell the agent how
many more are queued so it can drain the FIFO `…/delivery/pending` endpoint when the
count is non-zero. **Adapters should read `delivery.pendingSteering`** (this compact,
count-bearing block), not `timeline.pendingSteering`.

### Canvas-origin steering does not wake the agent by itself (#59)

Recording a browser-origin `ax.steer` (and the `ok:true` ack a surface button gets —
report #55) means the steer is **queued on the timeline**, not delivered into a live
agent turn. PMX deliberately does not import a host SDK, so the *wake* — turning a
queued steer into a visible turn — is **adapter-owned**: a cooperating host adapter
must drain `…/delivery/pending?consumer=<id>` and call its native send (e.g.
`copilotSession.send`), then `…/delivery/<id>/mark` it. Until an adapter wires that,
canvas-origin steering is delivered on the next human turn, not pushed. A steering
surface should therefore label its button honestly ("queued for the agent's next
turn"), never imply it interrupts the agent now.

## The two primitives that close the loop

- **Activity ingestion (bidirectional board).** Before, AX was one-directional
  (agent → board). With `ingestActivity`, the agent's *real work* flows back: a failed
  tool becomes a blocked work item + a review finding + evidence without the agent
  remembering to push it. Reactions are kind-driven and overridable per call.
- **Blocking gates (gates that actually gate).** Before, an approval gate was inert
  data the agent had to poll. With `canvas_ax_gate { kind: "approval", action: "await" }`
  (and the `?waitMs` HTTP long-poll), the agent requests a gate then *blocks* until the
  human resolves it in the browser — real human-in-the-loop control on any harness.

## What stays harness-owned

Waking a turn, the exact per-turn injection timing, forwarding native tool hooks, and
native blocking modals are the host's job — PMX defines the neutral interface and owns
its side. Model/abort control (`setModel`, `abort`) is intentionally out of scope.

See [`docs/http-api.md`](http-api.md) and [`docs/mcp.md`](mcp.md) for the full surface,
and the per-harness notes under `skills/pmx-canvas/references/`.
