# Iterative Plan Refinement Prompts

Reusable prompt templates for improving plans in `plan-interview` without tool-specific assumptions.

Use these as starting points. Adapt wording to the task, repo, and user constraints.

## Template 1: Single Fresh-Eyes Refinement Pass

```text
Carefully re-read the interview answers, constraints, success criteria, and the current plan with fresh eyes before making any revisions.

Review the plan for:
- contradictions or unclear assumptions
- missing edge cases and failure modes
- weak sequencing or risky implementation order
- missing integration details
- missing or weak test strategy (unit/integration/e2e where applicable)
- weak validation/diagnostics/logging guidance

Make the plan better, but do NOT oversimplify and do NOT remove agreed features or functionality unless explicitly approved.

Output:
1) A short summary of what changed and why
2) The revised plan (or git-diff style changes if requested)
```

## Template 2: Multi-Round Refinement Loop

```text
We are staying in plan space to improve execution quality before implementation.

Run one refinement pass on the current plan.

Fresh-eyes start (mandatory):
Re-read the interview answers, constraints, success criteria, and the current plan with fresh eyes before editing.

Goals for this pass:
1. Find contradictions, ambiguity, and missing edge cases
2. Improve architecture and sequencing where it clearly helps users
3. Strengthen testing and validation coverage (unit + integration/e2e where applicable)
4. Add or improve diagnostics/logging guidance for debugging failures
5. Preserve functionality (do NOT oversimplify, do NOT drop agreed scope)

At the end of the pass, provide:
- material improvements made
- unresolved risks/open questions
- whether another refinement pass is likely to produce material gains (yes/no + why)

Stop when changes are mostly wording/style or when two consecutive passes produce no material improvements.
```

## Template 3: Context Refresh Before Deep Refinement

```text
Before refining the plan further, refresh context:
1. Re-read AGENTS.md and README.md (if present and relevant)
2. Re-check the codebase architecture and integration points relevant to this plan
3. Summarize the key constraints/conventions that must shape the plan

Then run a fresh-eyes refinement pass on the plan using those constraints.

Do not rewrite the project or expand scope unnecessarily. Improve the plan within the agreed goals.
```

## Template 4: Multi-Plan Synthesis ("Best of All Worlds")

```text
I have multiple competing plans for the same task. Carefully analyze them with an open mind and be intellectually honest about what each one does better than the current plan.

Then update the current plan to create a single superior hybrid plan that:
- preserves the agreed scope and features
- integrates the best architecture and sequencing ideas
- improves reliability, testability, and observability
- keeps risks and tradeoffs explicit

Do NOT oversimplify and do NOT drop functionality unless explicitly approved.

Output:
1) A concise synthesis summary (what improved and why)
2) Git-diff style changes against the current plan (preferred)
3) Any remaining open questions or tradeoffs that need user confirmation
```

## Template 5: Plan Improvement Review (Diff-Oriented)

```text
Carefully review the entire plan with fresh eyes and propose your best revisions to improve architecture, robustness, reliability, performance, and usefulness.

For each proposed change:
1. Explain the rationale and expected benefit
2. Note any tradeoffs or risks
3. Show the git-diff style change versus the original plan

Guardrails:
- Do NOT oversimplify
- Do NOT remove agreed features/functionality without approval
- Include test strategy and validation/diagnostics impacts where relevant
```
