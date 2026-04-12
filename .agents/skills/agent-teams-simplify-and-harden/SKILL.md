---
name: agent-teams-simplify-and-harden
description: "Implementation + audit loop using parallel agent teams with structured simplify, harden, and document passes. Spawns implementation agents to do the work, then audit agents to find complexity, security gaps, and spec deviations, then loops until code compiles cleanly, all tests pass, and auditors find zero issues or the loop cap is reached. Use when: implementing features from a spec or plan, hardening existing code, fixing a batch of issues, or any multi-file task that benefits from a build-verify-fix cycle."
---

# Agent Teams Simplify & Harden

## Install

```bash
npx skills add pskoett/pskoett-ai-skills/skills/agent-teams-simplify-and-harden
```

A two-phase team loop that produces production-quality code: **implement**, then **audit using simplify + harden passes**, then **fix audit findings**, then **re-audit**, repeating until the codebase is solid or the loop cap is reached.

## When to Use

- Implementing multiple features from a spec or plan
- Hardening a codebase after a batch of changes
- Fixing a list of issues or gaps identified in a review
- Any task touching 5+ files where quality gates matter

## Pipeline Integration

This skill replaces stages 2–4 of the standard pipeline (execution, review, learning) with a team-based loop. It can follow `plan-interview` or run standalone — every upstream artifact is optional.

```
[plan-interview] → [agent-teams-simplify-and-harden] → [self-improvement]
                    ├─ intent frame (team lead)
                    ├─ implement (parallel agents)
                    ├─ audit (parallel agents)
                    ├─ drift check (team lead, between rounds)
                    └─ learning loop output → self-improvement
```

When a plan file from `plan-interview` exists, the skill extracts tasks from it. When no plan exists, the team lead runs a brief inline planning phase. Context-surfing runs as a lightweight drift check for the team lead between loop rounds — sub-agents are short-lived and don't need it.

## The Pattern

```
┌──────────────────────────────────────────────────────────┐
│                  TEAM LEAD (you)                          │
│                                                           │
│  Phase 1: IMPLEMENT (+ document pass on fix rounds)       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│  │ impl-1   │ │ impl-2   │ │ impl-3   │  ...            │
│  │ (general │ │ (general │ │ (general │                 │
│  │ purpose) │ │ purpose) │ │ purpose) │                 │
│  └──────────┘ └──────────┘ └──────────┘                 │
│       │             │            │                        │
│       ▼             ▼            ▼                        │
│  ┌─────────────────────────────────────┐                 │
│  │  Verify: compile + tests            │                 │
│  └─────────────────────────────────────┘                 │
│       │                                                   │
│  Phase 2: SIMPLIFY & HARDEN AUDIT                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│  │ simplify │ │ harden   │ │ spec     │  ...            │
│  │ auditor  │ │ auditor  │ │ auditor  │                 │
│  │ (Explore)│ │ (Explore)│ │ (Explore)│                 │
│  └──────────┘ └──────────┘ └──────────┘                 │
│       │             │            │                        │
│       ▼             ▼            ▼                        │
│  Exit conditions met?                                     │
│    YES → Produce summary. Ship it.                        │
│    NO  → back to Phase 1 with findings as tasks           │
│          (max 3 audit rounds)                             │
└──────────────────────────────────────────────────────────┘
```

## Loop Limits and Exit Conditions

The loop exits when ANY of these are true:

1. **Clean audit**: All auditors report zero findings
2. **Low-only round**: All findings in a round are severity `low` -- fix them inline (team lead or a single impl agent) and exit without re-auditing
3. **Loop cap reached**: 3 audit rounds have completed. After the third round, fix remaining critical/high findings inline and exit. Log any unresolved medium/low findings in the final summary.

**Budget guidance:** Track the cumulative diff growth across rounds. If fix rounds have added more than 30% on top of the original implementation diff, tighten the scope: skip medium/low simplify findings and focus only on harden patches and spec gaps.

## Step-by-Step Procedure

### 0. Plan and Frame

**If a plan file exists** (from `plan-interview` at `docs/plans/plan-NNN-<slug>.md` or user-provided): read it, extract the implementation checklist, and use those as the task list for step 2.

**If no plan exists**, run a brief inline planning interview:

1. What needs to be built, fixed, or hardened? (features, bugs, targets)
2. What's the spec or source of truth? (doc, issue, PR, or verbal description)
3. What are the acceptance criteria?

Turn the answers into a concrete task list. This is not a full `plan-interview` — just enough to break the work into parallelizable units.

**Intent frame:** Before creating the team, the team lead emits:

```markdown
## Intent Frame #1

**Outcome:** [What the team session will deliver]
**Approach:** [Team structure, number of agents, audit dimensions]
**Constraints:** [Scope boundaries, loop cap, budget limits]
**Success criteria:** [Clean audit or loop cap with all critical/high resolved]
**Estimated complexity:** [Small / Medium / Large — based on task count and file count]
```

Confirm with the user before proceeding. This anchors all subsequent drift checks.

### 1. Create the Team

```
TeamCreate:
  team_name: "<project>-harden"
  description: "Implement and harden <description>"
```

### 2. Create Tasks

Break the work into discrete, parallelizable tasks. Each task should be independent enough for one agent to complete without blocking on others.

```
TaskCreate for each unit of work:
  subject: "Implement <specific thing>"
  description: "Detailed requirements, file paths, acceptance criteria"
  activeForm: "Implementing <thing>"
```

Set up dependencies if needed:
```
TaskUpdate: { taskId: "2", addBlockedBy: ["1"] }
```

### 3. Spawn Implementation Agents

Spawn `general-purpose` agents (they can read, write, and edit files). One per task or one per logical group. Run them **in parallel**.

```
Task tool (spawn teammate):
  subagent_type: general-purpose
  team_name: "<project>-harden"
  name: "impl-<area>"
  mode: bypassPermissions
  prompt: |
    You are an implementation agent on the <project>-harden team.
    Your name is impl-<area>.

    Check TaskList for your assigned tasks and complete them.
    After completing each task, mark it completed and check for more.

    Quality gates:
    - Code must compile cleanly (substitute your project's compile
      command, e.g. bunx tsc --noEmit, cargo build, go build ./...)
    - Tests must pass (substitute your project's test command,
      e.g. bun test, pytest, go test ./...)
    - Follow existing code patterns and conventions

    When all your tasks are done, notify the team lead.
```

### 4. Wait for Implementation to Complete

Monitor agent messages. When all implementation agents report done:

1. Run compile/type checks to verify clean build
2. Run tests to verify all pass
3. If either fails, fix or assign fixes before proceeding

Before spawning auditors, collect the list of files modified in this session:
```bash
git diff --name-only <base-branch>  # or: git diff --name-only HEAD~N
```
You will pass this file list to each auditor.

### 5. Spawn Audit Agents

Spawn `Explore` agents (read-only -- they cannot edit files, which prevents them from "fixing" issues silently). Each auditor covers a different concern using the Simplify & Harden methodology.

**Recommended audit dimensions:**

| Auditor | Focus | Mindset |
|---------|-------|---------|
| **simplify-auditor** | Code clarity and unnecessary complexity | "Is there a simpler way to express this?" |
| **harden-auditor** | Security and resilience gaps | "If someone malicious saw this, what would they try?" |
| **spec-auditor** | Implementation vs spec/plan completeness | "Does the code match what was asked for?" |

Full prompt templates for each auditor are in `references/auditor-prompts.md`. Each prompt enforces: read-only scope, fresh-eyes start, structured finding format, and explicit zero-findings reporting.

#### Simplify Auditor

Spawned as `Explore` agent. Checks: dead code, naming, control flow, API surface, over-abstraction, consolidation. Categorizes findings as **cosmetic** or **refactor** (refactor bar: "clearly wrong, not just imperfect"). Reports file, line, category, fix, severity.

#### Harden Auditor

Spawned as `Explore` agent. Checks: input validation, error handling, injection vectors, auth/authz, secrets, data exposure, dependency risk, race conditions. Categorizes findings as **patch** or **security refactor**. Reports file, line, category, severity, attack vector, fix.

#### Spec Auditor

Spawned as `Explore` agent. Checks: missing features, incorrect behavior, incomplete implementation, contract violations, test coverage, acceptance criteria gaps. Categorizes findings as **missing**, **incorrect**, **incomplete**, or **untested**. Reports file, line, category, spec reference, severity.

### 6. Process Audit Findings

Collect findings from all auditors. For each finding:

- **Critical/High**: Create a task and assign to an implementation agent
- **Medium**: Create a task, include in next implementation round
- **Low/Cosmetic**: Include in next round only if trivial to fix; otherwise note in the final summary and skip

**Refactor gate:** For findings categorized as **refactor** or **security refactor**, evaluate whether the refactor is genuinely necessary before creating a task. The bar: "Would a senior engineer say the current state is clearly wrong, not just imperfect?" Reject refactor proposals that are style preferences or marginal improvements.

**Exit check:** If all findings in this round are severity `low`, fix them inline and skip re-auditing (see Loop Limits).

When creating fix tasks, bundle a **document pass** into each implementation agent's work:

> After fixing your assigned issues, add up to 5 single-line comments
> across the files you touched on non-obvious decisions:
> - Logic that needs more than 5 seconds of "why does this exist?" thought
> - Workarounds or hacks, with context and a TODO for removal conditions
> - Performance choices and why the current approach was picked
>
> Do NOT comment on the audit fixes themselves -- only on decisions
> from the original implementation that lack explanation.

This keeps the document pass lightweight and scoped. Auditors in subsequent rounds should not flag these comments as findings.

### 7. Loop

If there are findings to fix:

1. Create tasks from findings (include document pass instructions)
2. Spawn implementation agents (or reuse idle ones via SendMessage)
3. Wait for fixes
4. Run compile + test verification
5. **Drift check (team lead):** Before the next audit round, re-read the intent frame and plan/task breakdown. Compare the current state of the work against the original scope. If audit findings are pulling the team into unrelated areas or the scope has expanded beyond what was framed, re-scope or exit the loop early and produce the summary.
6. Check loop limits (see "Loop Limits and Exit Conditions")
7. If not exiting: spawn audit agents again (fresh agents, not reused -- clean context)
8. Repeat

### 8. Final Verification and Summary

When exit conditions are met:

1. Compile / type check -- must be clean
2. Tests -- must all pass
3. No `// TODO` or `// FIXME` comments introduced without corresponding tasks

Produce a final summary for the session:

```
## Hardening Summary

**Audit rounds completed:** 2 of 3 max
**Exit reason:** Clean audit (all auditors reported zero findings)

### Findings by round

Round 1:
- simplify-auditor: 4 cosmetic, 1 refactor (rejected -- style preference)
- harden-auditor: 2 patches, 1 security refactor (approved)
- spec-auditor: 1 missing feature

Round 2:
- simplify-auditor: 0 findings
- harden-auditor: 0 findings
- spec-auditor: 0 findings

### Actions taken
- Fixed: 6 findings (4 cosmetic, 2 patches, 1 security refactor, 1 missing feature -- rejected refactor excluded)
- Skipped: 1 refactor proposal (reason: style preference, not a defect)
- Document pass: 3 comments added across 2 files

### Unresolved
- None

### Out-of-scope observations
- <any out-of-scope items auditors flagged, for future reference>

### Learning loop
learning_loop:
  target_skill: "self-improvement"
  candidates:
    - pattern_key: "harden.input_validation"
      auditor: "harden-auditor"
      rounds_to_resolve: 1
      severity: "high"
      suggested_rule: "Validate and bound-check external inputs before use."
    - pattern_key: "simplify.dead_code"
      auditor: "simplify-auditor"
      rounds_to_resolve: 1
      severity: "low"
      suggested_rule: "Remove dead code and unused imports before finalizing."
```

Normalize recurring audit findings across rounds into `pattern_key` entries using the same format as `simplify-and-harden`. This feeds into `self-improvement` for cross-task pattern tracking and promotion.

Adapt the format to your context. The goal is a clear record of what was found, what was fixed, what was skipped and why, and what remains.

### 9. Cleanup

Send shutdown requests to all agents, then delete the team:

```
SendMessage type: shutdown_request to each agent
TeamDelete
```

## Agent Sizing Guide

| Codebase / Task Size | Impl Agents | Audit Agents |
|----------------------|-------------|--------------|
| Small (< 10 files) | 1-2 | 2 (simplify + harden) |
| Medium (10-30 files) | 2-3 | 2-3 |
| Large (30+ files) | 3-5 | 3 (simplify + harden + spec) |

More agents = more parallelism but more coordination overhead. For most tasks, 2-3 implementation agents and 2-3 auditors is the sweet spot.

## Tips

- **Implementation agents should be `general-purpose`** -- they need write access
- **Audit agents should be `Explore`** -- read-only prevents them from silently "fixing" things, which defeats the purpose of auditing
- **Fresh audit agents each round** -- don't reuse auditors from previous rounds; they carry context that biases them toward "already checked" areas
- **Task descriptions must be specific** -- include file paths, function names, exact behavior expected. Vague tasks produce vague implementations.
- **Run compile + tests between phases** -- don't spawn auditors on broken code; fix compilation/test errors first
- **Keep the loop tight** -- if auditors find only 1-2 low-severity cosmetic issues, fix them yourself instead of spawning a full implementation round
- **Assign tasks before spawning** -- set `owner` on tasks via TaskUpdate so agents know what to work on immediately
- **Simplify-first posture** -- when processing audit findings, prioritize cosmetic cleanups that reduce noise before tackling refactors. Cleanup is the default, refactoring is the exception
- **Security over style** -- when budget or time is constrained, prioritize harden findings over simplify findings
- **Pass the file list** -- always give auditors the explicit list of modified files. Don't rely on them figuring out scope on their own.

## Example: Implementing Spec Features

```
0.  Plan: Read spec (or run inline interview), break into 8 tasks
0b. Emit Intent Frame #1, confirm with user
1.  TeamCreate: "feature-harden"
2.  TaskCreate x8 (one per feature)
3.  Spawn 3 impl agents, assign ~3 tasks each
4.  Wait → all done → compile clean → tests pass
5.  Collect modified file list (git diff --name-only)
6.  Spawn 3 auditors: simplify-auditor, harden-auditor, spec-auditor
7.  Simplify-auditor finds 4 cosmetic + 1 refactor proposal
8.  Harden-auditor finds 2 patches + 1 security refactor
9.  Spec-auditor finds 1 missing feature
10. Team lead evaluates refactors (approve security refactor,
    reject simplify refactor), creates fix + document tasks
11. Spawn 2 impl agents for fixes
12. Wait → compile clean → tests pass
13. Drift check: re-read intent frame, scope looks good
14. Round 2: Spawn 3 fresh auditors
15. Auditors find 0 issues → exit condition met
16. Produce hardening summary + learning loop output
17. Shutdown agents, TeamDelete
```

## Quality Gates (Non-Negotiable)

These must pass before the loop can exit:

1. Clean compile / type check -- zero errors
2. Tests -- zero failures
3. Exit condition met (clean audit, low-only round, or loop cap reached with critical/high findings resolved)
4. No `// TODO` or `// FIXME` comments introduced without corresponding tasks

## Interoperability with Other Skills

### What this skill consumes
- **From plan-interview (optional):** Plan file (`docs/plans/plan-NNN-<slug>.md`). When available, tasks are extracted from the implementation checklist. When absent, the team lead runs an inline planning phase.
- **From the user (always available):** Task description, spec, or feature list. Used as the source of truth when no plan file exists.

### What this skill produces
- **For self-improvement:** Learning loop candidates from recurring audit findings, same `pattern_key` format as `simplify-and-harden`.
- **For the user:** Hardening summary with full audit trail across all rounds.

### Pipeline position

This skill replaces stages 2–4 of the standard pipeline with a team-based loop:

1. `plan-interview` (optional — or inline planning in Phase 0)
2. **`agent-teams-simplify-and-harden`** (team lead + intent frame + implement + audit + drift checks + learning loop)
3. `self-improvement` (consumes learning loop output for cross-task pattern tracking)

The team lead runs its own intent frame (not consumed from `intent-framed-agent`) and lightweight context-surfing drift checks between rounds (not the full exit/handoff protocol). Sub-agents are short-lived and do not run pipeline skills.
