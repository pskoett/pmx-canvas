---
title: PMX-AX Core Primitives and Host Adapter Plan
status: draft
date: 2026-06-07
---

# PMX-AX Core Primitives and Host Adapter Plan

## Summary

PMX-AX is the host-agnostic agent experience layer for PMX Canvas. It belongs
in PMX core, not in any single adapter. PMX-AX defines durable primitives,
state, node interaction contracts, permissions, delivery semantics, and audit
history. Host adapters such as GitHub Copilot, Codex, Claude, MCP, or CLI map
their native capabilities into PMX-AX, but they do not define PMX-AX.

The GitHub Copilot app is the first rich native adapter. Its SDK surfaces are
useful as a parity check, but the implementation must keep a clean boundary:

- **PMX-AX core owns:** primitives, state, node capabilities, interaction
  schemas, policy, approvals, timeline, delivery status, and host capability
  negotiation.
- **PMX Canvas UI owns:** native node interactions, visible work surfaces,
  human steering, and spatial collaboration.
- **Renderer transports own:** how a specific renderer emits interactions
  safely, for example native client events, json-render actions, sandboxed HTML
  `postMessage`, or MCP app bridges.
- **Host adapters own:** mapping PMX-AX to host-specific APIs such as Copilot
  hooks, tools, slash commands, system messages, permission hooks, and session
  messaging.

This plan remakes the earlier Copilot-focused AX work into a core PMX-AX plan.
Copilot remains important, but only as one adapter.

## Product Thesis

Chat is where humans instruct and resolve ambiguity. PMX Canvas is where the
work becomes visible. PMX-AX is the contract that lets humans and agents operate
on that visible work together.

The core loop should be:

```text
human or agent interacts with a node
  -> node emits a validated AX interaction
  -> PMX-AX records durable state and timeline
  -> PMX Canvas updates visible work surfaces
  -> host adapter exposes relevant context, prompts, tools, approvals, or events
  -> agent can react, continue, or ask for clarification
```

The key shift is that AX interactions are not limited to HTML nodes. HTML needs
a bridge because it is sandboxed, but PMX-AX applies to any node type that
declares or receives an allowed capability.

## Design Principles

1. **Core before adapter.** PMX-AX primitives must work through PMX HTTP, SDK,
   MCP, CLI, and browser UI before they depend on a host adapter.
2. **Adapters map, they do not own.** Copilot, Codex, Claude, CLI, and MCP
   adapters translate host capabilities into PMX-AX concepts.
3. **Node-bound by default.** AX interactions should know which node, actor,
   and surface created them.
4. **Capability-gated.** Not every node can do every AX action. Node type and
   node metadata must define what is allowed.
5. **Validated interaction envelope.** All node-originated interactions use one
   normalized event shape and strict payload validation.
6. **Visible, auditable, replayable.** Work state and decisions should be
   inspectable through PMX Canvas and reconstructable through a bounded
   timeline.
7. **Safe transport boundaries.** Sandboxed HTML, MCP apps, native nodes, and
   host adapters use different transports, but converge on the same PMX-AX
   endpoint and schema.
8. **No arbitrary execution.** Node interactions can request PMX-AX primitives,
   never arbitrary shell, tool, MCP, or host execution.
9. **Delivery has state.** Instructions and events need pending, delivered,
   failed, acknowledged, and ignored outcomes.
10. **Backwards-compatible state.** AX additions must preserve existing canvas,
    snapshot, MCP, HTTP, CLI, and SDK behavior.

## Core PMX-AX Model

### State partitions

| Partition | Contents | Persistence | Snapshot behavior |
|---|---|---|---|
| Canvas-bound AX state | focus, work items, approvals, review annotations, node AX capabilities, interaction state | `.pmx-canvas/canvas.db` | included in snapshots |
| Timeline AX state | events, evidence, steering, tool/session records, delivery outcomes | `.pmx-canvas/canvas.db` with retention | not restored by snapshots |
| Host/session AX state | host capabilities, active adapter sessions, delivery cursors | persisted only where useful | not restored by snapshots |
| Policy AX state | permission rules, tool policies, command registry, mode rules | PMX project config or DB, depending on durability need | included when project-scoped |

### Core primitives

| PMX-AX primitive | Core meaning | Example node use | Host adapter mapping |
|---|---|---|---|
| `canvas-surface` | A visible shared workbench surface. | Workbench, grouped board, node gallery. | Copilot `createCanvas().open()`, browser canvas, Codex browser panel. |
| `context` | Agent-readable context from pins, focus, selected nodes, and policy. | Pin a design note, focus a file node. | Copilot `additionalContext`, MCP resources, CLI `ax context`. |
| `focus` | Current node or node set requiring attention. | User focuses an incident node. | Host prompt context, adapter actions. |
| `node-capability` | What AX actions a node can emit or anchor. | Meeting board can create work; file node can create review. | Mostly core; adapters may report support. |
| `node-interaction` | Validated event emitted by an eligible node. | Drag agenda item to action lane. | Adapter may turn selected interactions into prompts or UI. |
| `work-item` | Visible task, plan step, or follow-up tied to nodes. | Status node updates a task; meeting board creates action. | Host tasks/tools if supported. |
| `approval-gate` | PMX-owned human approval before a high-impact action. | Deploy node asks for approval. | Copilot permission hooks where safe. |
| `evidence-item` | Inspectable artifact: log, file, diff, screenshot, test output, tool result. | File node marks itself as evidence. | Tool results, screenshots, host evidence surfaces. |
| `review-annotation` | Comment or finding anchored to node, file, region, or diff. | File node emits review comment. | PR review comments where adapter supports it. |
| `steering-message` | Human instruction from PMX surface to an active agent. | "Investigate this failing lane first." | Copilot `session.send()`, CLI prompt, future Codex bridge. |
| `agent-event` | Normalized prompt, response, tool, failure, approval, or state event. | Timeline node shows session activity. | Host session hooks/events. |
| `command` | Named user-invoked intent. | `/pmx-plan`, `/promote-context`. | Copilot slash commands, CLI commands, MCP tools. |
| `tool-policy` | Allowed, excluded, or approval-required tool rules. | Node requests "read-only investigation mode". | Copilot `availableTools`, `excludedTools`, permission hooks. |
| `prompt-policy` | System/context/prompt injection rules. | Context node requests concise mode. | Copilot `systemMessage`, modified prompt, additional context. |
| `mode-request` | Request or approval for mode transition. | Plan node asks to exit planning and execute. | Copilot exit plan mode, auto mode switch hooks. |
| `elicitation` | Structured request for human input. | Form node asks for missing migration owner. | Copilot `onUserInputRequest`, `onElicitationRequest`, `session.ui`. |
| `host-capability` | What the current adapter can support. | Copilot supports canvases/hooks/tools, CLI does not support UI prompts. | Host capability report. |
| `delivery` | State of adapter-bound instructions/events. | Steering pending, sent, acked, failed. | Adapter cursors, delivered markers, retry policy. |

## Node AX Capability Model

AX should be available to most node types where useful, not all nodes and not
all actions.

### Capability sources

Capabilities can come from two places:

1. **Server-side node-type registry** for safe defaults.
2. **Per-node metadata** for explicit opt-in or narrowed permission.

Example shape:

```ts
interface NodeAxCapabilities {
  enabled: boolean;
  allowed: Array<
    | 'ax.event.record'
    | 'ax.steer'
    | 'ax.work.create'
    | 'ax.work.update'
    | 'ax.evidence.add'
    | 'ax.approval.request'
    | 'ax.approval.resolve'
    | 'ax.review.add'
    | 'ax.focus.set'
    | 'ax.command.invoke'
    | 'ax.elicitation.request'
    | 'ax.mode.request'
  >;
  requiresApproval?: string[];
  delivery?: 'record-only' | 'notify-agent' | 'send-to-agent';
}
```

### Initial node capability matrix

| Node type | AX fit | Example allowed interactions |
|---|---|---|
| `markdown` | High | steer, evidence, work create, command invoke |
| `context` | High | focus, steer, evidence, prompt policy |
| `status` | High | work update, approval request, event record |
| `file` | High | evidence add, review add, focus |
| `json-render` | High | structured action events, work update, elicitation request |
| `graph` | Medium | evidence add, focus set, event record for selected data |
| `html` / `html-primitive` | High when opted in | work, steering, approvals, review, evidence via sandbox bridge |
| `mcp-app` / `web-artifact` | Medium to high | app bridge events where trusted and schema-validated |
| `image` | Medium | evidence add, review annotation |
| `ledger` / `trace` | High | evidence add, event record |
| `group` | Medium | focus, work grouping, command invoke |
| `prompt` / `response` | Internal | agent-event, context, delivery state |

Default rule: a node can anchor AX state, but only eligible nodes can emit AX
interactions.

## Node Interaction Envelope

All node-originated AX interactions should converge on one normalized shape:

```ts
interface PmxAxInteraction {
  type: string;
  sourceNodeId: string;
  sourceSurface?: 'native-node' | 'json-render' | 'html-node' | 'mcp-app' | 'adapter';
  actor?: {
    kind: 'human' | 'agent' | 'system';
    id?: string;
    displayName?: string;
  };
  payload: Record<string, unknown>;
  correlationId?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}
```

The shared server endpoint should validate:

- source node exists
- node type can emit the interaction
- node metadata allows the interaction
- payload matches the schema for the requested PMX-AX primitive
- requested delivery mode is allowed
- action does not request arbitrary tool or host execution

Suggested endpoint:

```text
POST /api/canvas/ax/interaction
```

It should map valid interactions onto existing PMX-AX operations:

- `ax.event.record` -> timeline event
- `ax.steer` -> steering message and delivery queue
- `ax.work.create` -> work item
- `ax.work.update` -> work item patch
- `ax.evidence.add` -> evidence item
- `ax.approval.request` -> approval gate
- `ax.approval.resolve` -> approval resolution
- `ax.review.add` -> review annotation
- `ax.focus.set` -> focus state
- `ax.command.invoke` -> PMX command intent, not arbitrary host command
- `ax.elicitation.request` -> PMX input request
- `ax.mode.request` -> PMX mode transition request

## Interaction Transports

| Transport | Used by | Mechanism | Trust boundary |
|---|---|---|---|
| Native client event | PMX-rendered nodes | direct client API call to PMX HTTP | trusted PMX client, still server-validated |
| json-render action | json-render nodes | structured action callback to PMX client | schema-driven, server-validated |
| HTML bridge | `html` and `html-primitive` nodes | sandboxed iframe `postMessage` to parent | opaque origin, token and source validation |
| MCP app bridge | `mcp-app` nodes | explicit app bridge where available | app identity and schema validation |
| MCP client surface | MCP-capable agents and clients | MCP resources, prompts, tools, and notifications over the PMX MCP server | client capability and policy validation |
| Host adapter action | Copilot, Codex, host-native apps | host adapter invokes PMX AX endpoint | host capability and policy validation |

HTML is therefore one transport, not the AX model.

## Adapterless MCP Support

PMX-AX should work for agents and clients that do not support Copilot-style
extensions. MCP is the main agnostic integration path.

The baseline should be:

```text
agent/client -> PMX MCP resources/tools/prompts -> PMX-AX core
```

This means Claude Desktop, Claude Code, Codex with MCP, Cursor, Windsurf, raw
MCP clients, shell agents, and custom scripts can participate in PMX-AX without
a host-native extension when they can access the PMX MCP server.

| Capability | Adapterless MCP path | Host-native enhancement |
|---|---|---|
| Read PMX context | `canvas://ax-context`, `canvas_get_ax_context`, and an MCP prompt template such as `pmx-current-context` | Adapter injects context automatically into the host prompt. |
| Keep prompt context fresh | MCP resource notifications and explicit resource reads | Adapter hook injects on every prompt submission. |
| Send PMX steering to an active agent | Pending steering exposed through MCP resources/tools, e.g. `canvas://ax-pending-steering`, `canvas_claim_ax_delivery`, `canvas_mark_ax_delivery` | Adapter calls host session APIs such as Copilot `session.send()`. |
| Ask human for structured input | PMX elicitation state exposed through MCP resources/tools | Adapter maps to host UI elicitation APIs. |
| Gate tool use | PMX tool policy exposed through MCP resources/tools and optional MCP pre-tool hooks where supported | Adapter maps to host tool filtering and permission hooks. |

Important limitation: generic MCP cannot universally force text into a host chat
thread. PMX can make pending steering visible and claimable through MCP, and
MCP-aware agents can read and act on it. Direct host-chat injection still
requires either MCP-client support for that behavior or a host-native adapter.

## Host and MCP Capability Matrix

The Copilot SDK exposes features that should be represented as core PMX-AX
concepts where generally useful. Anything host-specific stays adapter-only.

| Host/client surface | PMX-AX core concept | Adapter or MCP responsibility |
|---|---|---|
| Custom tools | `command`, `agent-action`, `tool-policy` | Expose approved PMX actions as host tools. |
| Slash commands | `command` | Register host commands that invoke PMX command intents. |
| System message control | `prompt-policy` | Apply PMX policy to host `systemMessage` or additional context. |
| Tool filtering | `tool-policy` | Map PMX allowed/excluded/approval-required tools to host controls. |
| User input / elicitation | `elicitation` | Render host UI prompts and record answers in PMX-AX. |
| Exit plan mode | `mode-request` | Map PMX mode approvals to host plan-mode hooks. |
| Auto mode switch | `mode-request` | Record and mediate host mode-change requests. |
| MCP Apps passthrough | `host-capability`, `canvas-surface` | Report support and route app surfaces where safe. |
| Pre-MCP tool hook | `tool-policy`, `agent-event` | Audit or mutate MCP calls according to PMX policy. |
| Hook mutation details | `prompt-policy`, `tool-policy`, `agent-event` | Map modified prompt/args/result/output suppression to PMX policy and timeline. |
| Canvas schema validation | `canvas-surface`, `command`, `agent-action` | Validate canvas input/action schemas and avoid reserved names. |
| Canvas identity/state model | `host-capability`, `delivery` | Treat `canvasId`, `extensionId`, and `instanceId` as host IDs, not PMX durable IDs. |
| MCP resources/prompts | `context`, `prompt-policy` | Expose PMX context through resources and prompt templates for adapterless clients. |
| MCP steering queue | `steering-message`, `delivery` | Let MCP clients claim, act on, and mark pending steering delivered. |

## Copilot Adapter Rules

The Copilot adapter should stay thin:

- import `@github/copilot-sdk/extension` only in the extension package
- open the existing PMX `/workbench`
- expose actions that call PMX HTTP APIs
- inject PMX context through prompt hooks
- map host session/tool events into PMX timeline
- deliver explicit pending steering messages into the active Copilot session
- report host capabilities into PMX-AX
- never own durable PMX state

Durable PMX state must not be keyed by Copilot `instanceId`. Use PMX node IDs,
project IDs, adapter session IDs, and delivery cursors instead.

## Delivery Semantics

PMX-AX needs explicit delivery state for anything that crosses from PMX into an
agent, MCP client, or host.

```ts
type DeliveryStatus =
  | 'pending'
  | 'delivered'
  | 'acknowledged'
  | 'failed'
  | 'ignored'
  | 'expired';
```

Minimum requirements:

- steering messages have delivery status and source adapter
- adapters and MCP clients can claim and mark messages delivered
- PMX prevents loops, for example Copilot-originated steering should not be sent
  back into the same Copilot session
- failed delivery is visible in timeline diagnostics
- delivery cursors survive adapter or MCP client restart where useful

Likely HTTP additions:

```text
GET  /api/canvas/ax/delivery/pending?consumer=copilot
GET  /api/canvas/ax/delivery/pending?consumer=mcp
POST /api/canvas/ax/delivery/:id/mark
POST /api/canvas/ax/steer/:id/delivered
```

The exact route shape can change, but delivery must be a first-class PMX-AX
concern.

## Permission and Policy Model

PMX approvals and host permissions overlap but are not identical.

PMX core should define:

- approval gates for PMX-owned actions
- tool policy for allowed, excluded, and approval-required tools
- prompt policy for context and system-message injection
- node capability policy for emitted interactions
- mode transition policy for plan/execute/autonomous workflows

Adapters should map these to host primitives where available:

- Copilot permission hooks
- Copilot available/excluded tools
- Copilot user input and elicitation hooks
- Copilot plan-mode and auto-mode hooks
- CLI confirmation prompts
- MCP tool gating

If a host lacks a feature, PMX should degrade to record-only, visible approval
state, or a clear unsupported capability status.

## Affected Files and Areas

### Core PMX-AX

- `src/server/ax-state.ts`
  - extend primitive types, node capabilities, interactions, delivery, policy,
    commands, elicitation, and mode requests
- `src/server/canvas-state.ts`
  - own PMX-AX state and persistence integration
- `src/server/canvas-db.ts`
  - additive tables for interactions, delivery, policy, commands, or mode state
    where needed
- `src/server/agent-context.ts`
  - build bounded context from pins, focus, node capabilities, and delivery state
- `src/server/canvas-serialization.ts`
  - include canvas-bound PMX-AX state in snapshots

### HTTP and SSE

- `src/server/server.ts`
  - shared `/api/canvas/ax/interaction`
  - delivery routes
  - command/policy/mode/elicitation routes if not covered by existing AX routes
  - SSE events for AX state, timeline, delivery, and node interaction outcomes

### Client/browser

- `src/client/nodes/HtmlNode.tsx`
  - sandbox bridge transport only for HTML/html-primitive
- `src/server/html-surface.ts`
  - inject `window.PMX_AX.emit(...)` helper when bridge is enabled
- json-render node renderer
  - emit structured PMX-AX interactions from native actions where applicable
- native node renderers
  - expose selected PMX-AX actions in node menus or inline controls
- SSE bridge/client store
  - update visible AX state live

### SDK, MCP, and CLI

- `src/server/index.ts`
  - PMX SDK methods for interactions, delivery, policy, commands, elicitation,
    and mode requests
- `src/mcp/server.ts` and `src/mcp/canvas-access.ts`
  - MCP resources/tools/prompts for PMX-AX state, interactions, delivery,
    policy, command intents, and adapterless prompt context
  - resources such as `canvas://ax-context`, `canvas://ax-timeline`,
    `canvas://ax-pending-steering`, and `canvas://ax-delivery`
  - prompt templates such as `pmx-current-context` so MCP-aware clients can
    inject PMX context without a host-native adapter
  - delivery tools such as `canvas_claim_ax_delivery` and
    `canvas_mark_ax_delivery` so MCP clients can act on pending steering
- `src/cli/index.ts` and `src/cli/agent.ts`
  - `pmx-canvas ax interaction`
  - `pmx-canvas ax delivery`
  - `pmx-canvas ax command`
  - `pmx-canvas ax policy`
  - `pmx-canvas ax mode`

### Copilot adapter

- `.github/extensions/pmx-canvas/extension.mjs`
  - map Copilot SDK hooks/actions/tools/commands to PMX-AX
  - inject PMX context and prompt policy
  - report host capabilities
  - consume delivery queue for explicit steering
  - record host events and tool evidence
  - avoid `console.log`; use `session.log()`

### Docs and skills

- `docs/http-api.md`
- `docs/sdk.md`
- `docs/mcp.md`
- `docs/cli.md`
- `docs/node-types.md`
- `skills/pmx-canvas/SKILL.md`
- `skills/pmx-canvas/references/html-primitives.md`
- `skills/pmx-canvas/references/github-copilot-app-adapter.md`

## Implementation Plan

### Phase 0: Reframe and inventory

- [ ] Rename the plan and docs language from Copilot-first AX to PMX-AX core.
- [ ] Inventory existing AX implementation and mark what is already done:
  focus, context, work, approvals, evidence, review, timeline, host capability.
- [ ] Inventory Copilot SDK surfaces and classify them as:
  core PMX-AX concept, adapter mapping, or out of scope.
- [ ] Add static guard that PMX core imports no Copilot SDK packages.

### Phase 1: Node AX capability and interaction core

- [ ] Add node AX capability types and normalizers.
- [ ] Add a server-side default capability registry per node type.
- [ ] Add optional per-node `data.axCapabilities` metadata.
- [ ] Add shared `PmxAxInteraction` envelope and validation.
- [ ] Add `/api/canvas/ax/interaction`.
- [ ] Map interaction types to existing AX operations.
- [ ] Emit SSE for accepted and rejected interactions.
- [ ] Add tests for capability allow/deny behavior.

### Phase 2: Native node and json-render interactions

- [ ] Add client helpers for native node renderers to submit AX interactions.
- [ ] Add node menu or inline controls for obvious native actions:
  status -> work update, file -> evidence/review, context -> focus/steer.
- [ ] Add json-render action mapping to AX interactions.
- [ ] Add visible ack/error feedback for interaction outcomes.
- [ ] Add tests for native and json-render interaction submission.

### Phase 3: Sandboxed HTML transport

- [ ] Add opt-in HTML bridge capability.
- [ ] Inject `window.PMX_AX.emit(type, payload, options?)` from
      `html-surface.ts` when enabled.
- [ ] Use iframe `postMessage` to parent with token, node ID, event type,
      payload, and correlation ID.
- [ ] Validate iframe source, token, node ID, node capability, and payload in
      `HtmlNode.tsx` before calling the shared PMX endpoint.
- [ ] Keep iframe sandbox as `allow-scripts` only.
- [ ] Add ack/error responses back into the iframe.
- [ ] Update at least one interactive HTML primitive, preferably Meeting
      Liveboard, so moving an item to Actions creates or updates a work item
      and records an event.

### Phase 4: Delivery, steering, and agent reaction

- [ ] Add delivery status to steering and other adapter-bound events.
- [ ] Add pending delivery query and mark-delivered routes.
- [ ] Add loop prevention by source adapter/session.
- [ ] Add MCP resources/tools for pending steering and delivery state so
      adapterless MCP clients can read, claim, act on, and acknowledge steering.
- [ ] Add an MCP prompt template for current PMX context so MCP-aware clients can
      inject PMX context without a host-native extension.
- [ ] Update Copilot adapter to consume explicit pending steering and call
      `session.send()` only for allowed delivery items.
- [ ] Record delivery success/failure in PMX timeline.
- [ ] Add CLI/MCP visibility into pending and failed delivery.

### Phase 5: Policy, commands, mode, and elicitation

- [ ] Add PMX command primitive and registry.
- [ ] Map Copilot slash commands to PMX command intents.
- [ ] Add prompt policy for additional context, modified prompt, and system
      message append/customization.
- [ ] Add tool policy for available tools, excluded tools, and
      approval-required tools.
- [ ] Add mode request primitive for plan exit and auto mode changes.
- [ ] Add elicitation primitive for structured human input.
- [ ] Map Copilot hooks to these PMX concepts where available.

### Phase 6: MCP app and web artifact bridge

- [ ] Define which MCP app and web-artifact interactions are trusted enough to
      bridge into PMX-AX.
- [ ] Add app identity and schema validation.
- [ ] Route app interactions through the same `/api/canvas/ax/interaction`
      endpoint.
- [ ] Keep unsafe or unknown app interactions record-only or disabled.

### Phase 7: Documentation and verification

- [ ] Update HTTP, SDK, MCP, CLI, node type, and skill docs.
- [ ] Update Copilot adapter reference to describe it as a host mapping.
- [ ] Add examples for:
  - status node updating work
  - file node creating evidence
  - Meeting Liveboard creating action work
  - Copilot adapter delivering steering
- [ ] Run repo-standard validation.

## Success Criteria

- PMX-AX is documented and implemented as core PMX architecture, not Copilot
  glue.
- Eligible node types can emit or anchor AX interactions through a shared
  validated endpoint.
- HTML/html-primitive nodes use a sandbox-safe bridge, but the AX model is not
  HTML-specific.
- Work items, approvals, evidence, review annotations, steering, context, focus,
  commands, policy, mode requests, and delivery semantics have PMX-owned types.
- Copilot SDK primitives map clearly to PMX-AX concepts or are explicitly
  adapter-only.
- PMX core imports no Copilot SDK code.
- Durable PMX state is not keyed by Copilot `instanceId`.
- Agent-readable context and timeline expose node-originated interactions.
- Adapter-bound steering has visible pending, delivered, failed, or ignored
  state.
- Adapterless MCP clients can access current PMX context through resources,
  tools, and prompt templates.
- Adapterless MCP clients can see and claim pending PMX steering through MCP
  resources/tools even when they cannot inject directly into a host chat.
- Existing canvas behavior remains backward-compatible.

## Test Strategy

### Unit tests

- `tests/unit/ax-state.test.ts` or equivalent:
  - interaction envelope validation
  - node capability allow/deny rules
  - delivery status transitions
  - prompt/tool/mode policy normalization
- `tests/unit/canvas-state.test.ts`
  - canvas-bound PMX-AX state persists and snapshots
  - timeline state persists but is retention-bounded
- `tests/unit/server-api.test.ts`
  - `/api/canvas/ax/interaction` accepts valid payloads
  - rejects disabled node, disallowed action, invalid payload, unknown node
  - maps valid interactions to work/evidence/review/steering/focus
  - delivery routes round-trip
- `tests/unit/html-surface.test.ts`
  - bridge script is injected only when enabled
  - unsafe token values are sanitized
  - helper API shape is present
- `tests/unit/client-*`
  - iframe source/token validation
  - ack/error postMessage behavior
  - json-render/native interaction submission
- `tests/unit/mcp-server.test.ts`
  - exposes PMX context as MCP resources and prompt templates
  - exposes pending steering/delivery state through MCP resources/tools
  - claim/mark delivery tools update PMX delivery state
- Static tests:
  - no PMX core imports `@github/copilot-sdk`
  - every PMX-AX operation has HTTP, SDK, MCP, and CLI coverage or an explicit
    documented exception

### Adapter tests

- Copilot extension declares valid canvas/action schemas.
- No reserved `canvas.*` action names.
- Adapter uses `session.log()`, not `console.log()`.
- Adapter maps host capabilities into PMX host-capability state.
- Adapter does not own durable PMX state.
- Adapter avoids delivery loops for Copilot-originated steering.

### Integration tests

- Start PMX server.
- Add a status node with AX capability.
- Submit interaction to update/create a work item.
- Add an HTML Meeting Liveboard node.
- Move item into Actions and verify:
  - work item exists
  - timeline event exists
  - context/timeline APIs expose the result
  - browser shows ack or error
- Exercise Copilot adapter manually or through static harness:
  - open PMX workbench
  - pin/focus node
  - verify prompt context injection
  - create pending steering
  - verify delivery or visible unsupported state

## Validation Commands

Use existing repo commands only:

```bash
bun run typecheck
bun run test
bun run build
```

If client behavior changes significantly, also run the relevant Playwright
coverage:

```bash
bun run test:web-canvas
```

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| PMX-AX becomes Copilot-shaped. | Codex, MCP, CLI, and future hosts become second-class. | Keep core PMX concepts neutral and SDK mapping adapter-only. |
| AX interactions become HTML-only. | Native nodes and structured PMX surfaces cannot participate. | Build shared node interaction layer first, then add HTML as one transport. |
| Over-broad node permissions. | Arbitrary artifact code can steer agents or mutate state. | Capability registry, per-node opt-in, strict schemas, no arbitrary execution. |
| Adapter delivery loops. | Copilot sends messages back to itself repeatedly. | Source/session tracking, delivery cursors, loop-prevention tests. |
| Timeline becomes noisy. | Agent context degrades. | Retention, summaries, filters, delivery status, and context budget rules. |
| Policy overlaps host permissions badly. | Confusing approval behavior. | PMX approval is canonical; host permissions are mapped where safe. |
| Durable state tied to host instance IDs. | State breaks when panels close/reopen. | Use PMX node/project/session IDs; treat host instance IDs as transient. |
| Bridge creates security regressions. | Sandbox or origin protections weaken. | Keep `allow-scripts` only, validate parent/iframe source and token, test rejection paths. |

## Open Questions

- Which node types should have AX emission enabled by default, if any?
- Should project owners be able to configure node AX capabilities globally?
- Which PMX commands should be first-class in the command registry?
- How much prompt/system-message mutation should PMX allow by default?
- Should delivery be limited to steering messages first, or generalized across
  all adapter-bound AX events immediately?
- Which MCP app bridge interactions are safe enough for first-pass support?
- Should PMX expose a visible "AX inbox" for pending delivery, approvals, and
  elicitation requests?

## Rejected Alternatives

### Build only an HTML Node AX Bridge

Rejected because it solves the sandboxed artifact problem but misses the larger
AX model. HTML is one transport. PMX-AX must support native nodes, json-render,
files, status nodes, context nodes, MCP apps, and adapters.

### Treat GitHub Copilot SDK parity as the PMX-AX model

Rejected because PMX Canvas must stay host-agnostic. Copilot SDK features are a
high-value adapter mapping and parity checklist, not the source of truth.

### Store adapter state inside Copilot canvas instances

Rejected because `instanceId` is transient host UI state. Durable PMX-AX state
must live in PMX Canvas state and be keyed by PMX domain IDs.

### Allow arbitrary HTML iframes to call PMX APIs directly

Rejected for untrusted or semi-trusted sandboxed nodes. Local does not mean
trusted: HTML nodes can contain pasted code, generated artifacts, CDN scripts,
or copied examples. If arbitrary iframe code can call PMX APIs directly, it can
bypass node capabilities and access every enabled local endpoint for canvas
mutation, steering, approvals, evidence, or future privileged actions.

The parent-mediated bridge preserves the sandbox, binds each interaction to the
originating node and iframe token, and validates intent before PMX state
changes.

Trusted built-in PMX app surfaces may still call internal PMX APIs directly when
they are first-party, same-origin, and covered by normal server validation. This
rejection applies to arbitrary `html`, generated `html-primitive`, and other
semi-trusted iframe content.
