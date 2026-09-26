# Plan 010 — Attributed ask answers

**Status:** Proposed, scheduled for 0.8 with author on every node
**Date:** 2026-09-26
**Source:** [Product vision, move 7](../product-vision-2026-09.md#7-trust-that-is-not-a-label-s-then-m), decided 2026-09-26 (replaces the 2026-09-24 human-only decision).
**Done when:** an approval answered by an agent is shown and returned as that agent's, one answered in the workbench as the human's, and an agent answering its own ask is marked as a self-answer.

## Why attribution, not a lock

The harness an agent runs in (Claude Code, Codex, Copilot) is what gates its actions. The canvas cannot
stop an agent; a PMX gate works because the agent chose to ask and honours the answer. Gates matter as the
visible ask on the board, as coordination where an orchestrator approves its workers' asks, and as the
record afterwards. A human-only lock would break coordination. The actual defect is that an answer does not
say who gave it, so a self-approved gate reads the same as the human's.

## Changes

1. **Boot secret.** The server mints a random secret at startup and injects it into the workbench HTML
   (`canvasSpaHtml`, beside `__PMX_BOOT_BUNDLE_STAMP`). The client bridge sends it as
   `x-pmx-workbench-token` (not from `?agent=` tabs). The HTTP transport sets `meta.human` only when it
   matches. `x-pmx-workbench` keeps its current meaning.
2. **`resolvedBy` on every answer.** Approval gates, elicitations and mode requests record
   `resolvedBy: { actor: 'human' | 'agent' | 'system', source, agentId? }` and `selfAnswer: true` when the
   agent answering is the one that asked. The TTL sweeper records `system`. Persisted with the ask and
   returned by `await`, `canvas://ax-work` and the timeline event.
3. **Shown to the human.** The session panel and the timeline read "Approved by you", "Approved by
   orchestrator" or "Self-approved by copilot".
4. **Nothing is refused.** Every existing resolve path (MCP, CLI, Copilot extension, SDK) keeps working;
   no withdraw is added.
5. **Docs** state the ceiling: an agent running as the same user can read the workbench HTML, so the
   secret proves nothing against a determined local agent; it separates the human's clicks from casual
   agent calls.

## Tests

- Unit: an answer over HTTP with the secret is `human`; without it, over MCP, CLI and SDK it is `agent`
  with the caller's source; the requester answering its own ask sets `selfAnswer`; the sweeper is `system`.
- Client: the session panel renders the attribution.
- E2E: Approve from the session panel records `human`.
