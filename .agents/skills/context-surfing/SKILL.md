---
name: context-surfing
description: >
  Monitors context window health throughout a session and rides peak context quality for maximum output fidelity.
  Activates automatically after plan-interview and intent-framed-agent. Stays active through execution and hands off
  cleanly to simplify-and-harden and self-improvement when the wave completes naturally or exits via handoff.
  Use this skill whenever a multi-step agent task is underway and session continuity or context drift is a concern.
  Especially important for long-running tasks, complex refactors, or any work where degraded context would silently
  corrupt the output. Trigger even if the user doesn't say "context surfing" — if an agent task is running across
  multiple steps with intent and a plan already established, this skill is live.
---

# Context Surfing

## Install

```bash
npx skills add pskoett/pskoett-ai-skills/skills/context-surfing
```

The agent rides the wave of peak context. When the wave crests, it commits. When it detects drift, it pulls out cleanly — saving state, handing off, and letting the next session catch the next wave.

No wipeouts. No zombie sessions. Only intentional, high-fidelity execution.

---

## Mental Model

Think of context like an ocean wave:

- **Paddling in** = loading the intent frame, plan, and initial context. Energy is building.
- **The peak** = full context coherence. The agent knows exactly what it's doing and why. This is when to execute.
- **The shoulder** = context starting to flatten. Still rideable, but output density is dropping.
- **The close-out** = drift. Contradiction, hedging, second-guessing, or hallucinated details. Wipe-out territory.

The skill's job: ride as long as the wave is good, exit before it closes out.

---

## Lifecycle Position

```
[plan-interview] → [intent-framed-agent] → [context-surfing ACTIVE] → [simplify-and-harden] → [self-improvement]
```

Context Surfing is the execution layer. It wraps all work between intent capture and post-completion review. Simplify-and-harden and self-improvement are the next steps in the pipeline — they run after context-surfing completes, not as conditions that end it.

### Relationship with intent-framed-agent

Both skills are live during execution. They monitor different failure modes:

- **intent-framed-agent** monitors *scope* drift — am I doing the right thing? It fires structured Intent Checks when work moves outside the stated outcome.
- **context-surfing** monitors *context quality* drift — am I still capable of doing it well? It fires when the agent's own coherence degrades (hallucination, contradiction, hedging).

They are complementary, not redundant. An agent can be perfectly on-scope while its context quality degrades (e.g., it's doing the right thing but starting to hallucinate details). Conversely, scope drift can happen with perfect context quality (the agent deliberately chases a tangent). Intent-framed-agent's Intent Checks continue firing alongside context-surfing's wave monitoring.

**Precedence rule:** If both skills fire simultaneously (an Intent Check and a drift exit at the same time), context-surfing's exit takes precedence. Degraded context makes scope checks unreliable — resolve the context issue first, then resume scope monitoring in the next session.

### When to Use the Full Pipeline

Not every task needs all five skills. Match pipeline depth to task complexity:

| Task Type | Skills to Use |
|-----------|---------------|
| Trivial (rename, typo fix) | None — just do it |
| Small (isolated bug fix, single-file change) | `simplify-and-harden` only |
| Medium (feature in known area, multi-file) | `intent-framed-agent` + `simplify-and-harden` |
| Large (complex refactor, new architecture, unfamiliar codebase) | Full pipeline |
| Long-running (multi-session, high context pressure) | Full pipeline with `context-surfing` as the critical skill |

When in doubt, start light. Add skills if you notice drift or quality issues mid-task.

---

## Activation

This skill is live the moment the intent frame and plan are established. No explicit invocation needed.

At activation, load whatever anchors are available:

1. The intent frame (from intent-framed-agent output) — if available
2. The plan (from plan-interview output) — if available
3. The current session state from the Entire CLI (if available)
4. All project context files (see below)

If neither an intent frame nor a plan exists (standalone mode), use the user's original task description combined with project context files as the wave anchor. This is sufficient — the skill degrades gracefully, not catastrophically.

### Entire CLI Integration

Entire CLI ([github.com/entireio/cli](https://github.com/entireio/cli)) provides persistent session state that serves as external ground truth for drift checks and handoff files.

At activation, detect Entire:

```bash
entire status 2>/dev/null
```

- If it succeeds, Entire captures the session passively via hooks — every prompt, tool call, file modification, and checkpoint is recorded to the shadow branch. You don't need to call Entire directly; the harness handles it. Use `entire status` and `entire explain --session <id>` to read back session state when needed.
- If unavailable or failing, continue without it. Use the intent frame and plan file as the wave anchor instead. Track progress via structured comments in your output rather than Entire CLI commands. Do not block execution and do not nag about installation.

The **wave anchor** is not held mentally. It is built from whatever external, persistent artifacts are available — every drift check reads from them directly, never from reconstructed memory.

### Handoffs become learning signals

When context-surfing writes a handoff file on drift exit, that handoff is also captured in the Entire session transcript (via the `Stop` / `SessionEnd` hooks). At cadence, `learning-aggregator --deep` reads those transcripts and extracts:

- Which drift signals most commonly trigger handoffs → potential session design issues
- How many sessions hit drift exit vs completed cleanly → session health baseline
- What context artifacts were missing when drift occurred → promotion candidates for project instruction files

Structured handoff files (`.context-surfing/handoff-<slug>-<timestamp>.md`) with predictable section headers make this parseable. You don't need to do anything special — just keep the handoff format consistent.

- **Full pipeline:** intent frame + plan file + Entire CLI session state
- **Partial pipeline:** whichever of intent frame or plan exists, plus project context files
- **Standalone:** the user's original task description + project context files (CLAUDE.md, AGENTS.md, README.md, etc.)

The anchor is weaker in standalone mode — fewer artifacts to cross-check against — but it is always present. A weak anchor is better than no anchor.

---

## Project Context Files

Before executing anything, scan the project for `.md` files that carry standing context. These are not documentation to skim — they are constraints, decisions, and architectural truth that must stay in the wave at all times.

### Always load at activation
- `CLAUDE.md` — agent configuration, conventions, constraints
- `AGENTS.md` — multi-agent setup, role definitions
- `README.md` — project intent and structure
- Any `.md` in the project root

### Load on demand (when relevant to the current task)
- `.md` files in `skills/`, `docs/`, `.learnings/`, or similar directories
- `SKILL.md` files for any skill being invoked alongside this one

### Rules for context files
1. **They are always part of the wave anchor.** If output contradicts a project `.md` file, that is a drift signal — treat it as a strong one.
2. **Re-read them if the task changes domain or scope.** Don't assume you remembered correctly 20 steps in.
3. **Include their key constraints in the handoff file.** The next session needs to reload them too — note which files were active and whether any were updated during the session.
4. **If a `.md` file is modified during the session**, flag it explicitly in the handoff under a "Modified Context Files" section so the next session re-reads it fresh rather than relying on the handoff summary.

---

## Drift Detection

Continuously monitor for these signals. Strong signals trigger an immediate exit — the wave is closing out. Weak signals trigger the Recovery Protocol first — the shoulder might still be rideable.

### Strong signals (exit immediately)
- The agent contradicts a decision it already made and committed to
- A detail appears in the output that was never in the original context (hallucination)
- The agent re-opens a scope question that was explicitly resolved in the plan
- Output starts re-explaining the task rather than executing it

### Weak signals (trigger recovery)
- Responses are getting longer without getting more useful
- Hedging language increases: "it depends", "could be", "might want to consider"
- The agent switches approaches mid-task without explicit user direction
- References to the original intent become vague or paraphrased instead of precise
- The agent asks a clarifying question it should already know the answer to

### Not drift
- Normal iteration and refinement within scope
- Asking about genuinely new information not in the original context
- Simplifying a previous output (that's the wave working, not breaking)

### The Monitoring Paradox

An agent with degraded context is the least likely to detect its own degradation. The strong signals (hallucination, contradiction) are exactly the ones a compromised agent will miss — because it no longer has the context to recognize the contradiction.

This is an inherent limitation of self-monitoring. Mitigate it with external grounding:

1. **Re-read the wave anchor before each major step.** If an intent frame exists, open it and read it verbatim. If a plan file exists, re-read the relevant section. In standalone mode, re-read the user's original task description. Don't rely on your memory of any of these — open the artifact. If what you're about to do doesn't match what you read, stop.
2. **Use Entire CLI logs as external memory.** If Entire is available, read back your own session log before non-trivial decisions. Your logged state is more reliable than your recalled state.
3. **Treat the user as a drift sensor.** If the user expresses confusion, asks "why are you doing that?", or redirects you — treat it as a strong signal regardless of your own assessment.

The weak signals (hedging, verbosity) are more reliably self-detectable precisely because they're behavioral, not factual. Watch for those as early warnings.

### Recovery Protocol (Wave Re-Anchor)

When weak signals accumulate, don't exit immediately — try to re-anchor first. The shoulder of the wave is still rideable if you can re-ground.

#### Step 1: Pause and re-read

Stop producing output. Re-read whatever wave anchor artifacts are available:

1. If an intent frame exists, open and read it verbatim (not your memory of it)
2. If a plan file exists, open and read the relevant section
3. In standalone mode, re-read the user's original task description and project context files
4. If Entire CLI is available, read back your session log

Compare what you're currently doing against what these artifacts say you should be doing.

#### Step 2: Reconcile

- **If the mismatch resolves** — you can trace a clear line from the anchor to your current work — resume execution. The weak signals were noise, not drift.
- **If uncertainty remains** — you can't confidently reconcile your current work with the anchor — escalate to the user. Present the situation openly: *"I'm noticing some drift. Here's where I am vs where the plan says I should be — how should I proceed?"* Include the specific weak signals you observed and what you found when you re-read the anchor.
- **If the user re-grounds you** — integrate their clarification and resume. The re-anchor succeeded.
- **If the user can't resolve it, or the original intent has fundamentally changed** — proceed to the Exit Protocol.

#### Re-anchor limits

There is no hard cap on recovery attempts. Keep re-anchoring as long as each attempt genuinely resolves the uncertainty and the user confirms alignment. However:

- If you find yourself re-anchoring on consecutive steps, that is itself a weak signal — the wave is flattening and a natural exit may be close.
- Strong signals always bypass recovery and trigger an immediate exit. Recovery is only for the shoulder, never for the close-out.

---

## Riding the Wave

While context is healthy:

1. **Execute with commitment.** No hedge, no re-litigating decisions already made. The plan is the plan.
2. **Check the wave anchor before non-trivial decisions.** Re-read whatever anchor artifacts are available (intent frame, plan, or original task description). If the decision aligns, proceed. If it doesn't, stop.
3. **Track completions.** Log what's done, what's in progress, what's pending as work progresses — not at exit. If Entire CLI is available, use it as the session log. If not, maintain a running status in your output. This feeds the handoff if needed.
4. **Resist scope creep.** If something interesting but out-of-scope appears, note it (in Entire CLI or in your output) — don't chase it.

---

## Exit Protocol (Wave Close-Out)

When a strong signal fires, or the Recovery Protocol fails to re-anchor, execute a clean exit. Do not try to push through.

### Step 1: Stop executing

Immediately pause task execution. Do not produce more output that may be corrupted by the degraded context.

### Step 2: Write the handoff file

Create a file named `.context-surfing/handoff-[slug]-[timestamp].md` (create the `.context-surfing/` directory if it doesn't exist). Add `.context-surfing/` to `.gitignore` — handoff files are session artifacts, not project history.

Structure:

```markdown
# Context Surf Handoff

## Session Info
- Task: [task name / slug]
- Started: [timestamp]
- Ended: [timestamp]
- Exit reason: [what drift signal was detected]

## Intent Frame (if available — read verbatim, do not reconstruct)
[copy directly from the intent-framed-agent artifact, or "N/A — standalone session" if none exists]

## Plan (if available — read verbatim, do not reconstruct)
[copy directly from the plan-interview artifact, or "N/A — standalone session" if none exists]

## Original Task Description (standalone fallback)
[copy the user's original task description if no intent frame or plan exists]

## Completed Work (from Entire CLI session state or running output log)
[pull directly from CLI log or structured output — do not reconstruct from memory]

## In Progress at Exit (from Entire CLI session state or running output log)
[what the session log shows as active at the moment of exit]
[include any partial outputs if useful]

## Pending Work (from plan-interview output — cross-reference session log to confirm what's genuinely not done)
[remaining tasks from the plan, in order]

## Drift Notes
[what specifically triggered the exit — be precise, this helps the next session replan intelligently]

## Active Context Files
[list all .md files loaded during this session — root level and any skill/docs files consulted]

## Modified Context Files
[any .md files that were changed during this session — next session must re-read these, not trust the handoff summary]

## Scope Notes (Out-of-Band)
[anything interesting discovered that's outside scope — flagged for the next session to decide on]

## Recommended Re-entry Point
[where the next session should pick up, and any replanning it should do before continuing]
```

### Step 3: Notify the user

Briefly and clearly:

> "Context wave is done. I've saved the session state to `.context-surfing/[filename]`. The next session should load that file, run plan-interview to replan from [re-entry point], and catch the next wave. Here's what triggered the exit: [one sentence on drift signal]."

Do not over-explain. The handoff file has the details.

---

## Handoff to Next Session

The next session should:
1. Read the handoff file completely before doing anything else
2. If the original session used the full pipeline, run plan-interview using the handoff as input context and re-establish the intent frame via intent-framed-agent
3. If the original session was standalone, use the handoff's original task description and drift notes to re-ground
4. Pick up context-surfing again from the recommended re-entry point

This is not failure. This is the system working correctly. Clean exits produce better total output than zombie sessions that limp to the finish line.

---

## Session Close (Natural Completion)

When the task completes within a healthy wave (no drift exit needed):

1. Confirm all plan items are done (or, in standalone mode, confirm the original task description is satisfied)
2. Note session end in a brief summary (optional, not a full handoff file)
3. Signal readiness for simplify-and-harden — the next skill in the pipeline picks up from here

No handoff file needed for clean completions — just the outputs and a one-liner status.

---

## Interoperability with Other Skills

### What this skill consumes
- **From plan-interview (optional):** The plan file (`docs/plans/plan-NNN-<slug>.md`). Strengthens the wave anchor when available.
- **From intent-framed-agent (optional):** The intent frame artifact. Strengthens the wave anchor when available.
- **From the user (always available):** The original task description. Used as the standalone wave anchor when upstream artifacts are absent.
- **From Entire CLI (optional):** Session state for progress tracking and external memory.

### What this skill produces
- **For simplify-and-harden:** A "ready" signal on natural completion. Simplify-and-harden picks up from the completed work.
- **For the next session (on drift exit):** A handoff file in `.context-surfing/` with full state for session resumption.
- **For self-improvement:** Drift patterns observed during the session can be logged as learnings if they recur.

### Pipeline position
1. `plan-interview` (optional, for requirement shaping)
2. `intent-framed-agent` (execution contract + scope drift monitoring)
3. `context-surfing` (context quality monitoring — runs concurrently with intent-framed-agent during execution)
4. `simplify-and-harden` (post-completion quality/security pass)
5. `self-improvement` (capture recurring patterns and promote durable rules)

---

## Hook Integration

Enable automatic handoff detection at session start. This ensures handoff files from previous context exits are never silently ignored.

### Setup (Claude Code / Codex)

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "./skills/context-surfing/scripts/handoff-checker.sh"
      }]
    }]
  }
}
```

This checks for unread handoff files in `.context-surfing/` on every prompt. If found, it reminds the agent to read the handoff before starting new work (~100 tokens overhead, skips silently when no handoff exists).

### Copilot / Chat Fallback

For agents without hook support, manually check at session start:

```bash
ls .context-surfing/handoff-*.md 2>/dev/null
```

---

## Principles

**Ride the peak, not the whole ocean.** A shorter session with high fidelity beats a long session with gradual corruption.

**Exit is not failure.** The wave close-out is a feature. Detecting it early is the skill.

**The handoff file is the continuity.** It's not documentation overhead — it's what makes the next session as sharp as this one started.

**Never hide the exit.** Always be explicit with the user that a context exit happened and why. Silently continuing in degraded context is the worst outcome.
