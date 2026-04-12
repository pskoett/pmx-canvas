# Workflow Example (Non-Active)

This is an example template only.
Keep it outside `.github/workflows` so nothing runs automatically.

When you are ready to enable CI automation:
1. Copy this template into `.github/workflows/self-improvement-ci.md`
2. Adjust thresholds and promotion policy
3. Validate with `gh aw compile --validate --strict`

```markdown
---
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  workflow_dispatch:

permissions:
  contents: read
  actions: read
  pull-requests: read

tools:
  github:
    toolsets: [pull_requests, actions]
safe-outputs:
  add-comment:
    max: 1
strict: true
---

Run Self-Improvement CI for this pull request.

Rules:
1) Collect failure and warning signals from relevant checks.
2) Ingest `simplify_and_harden.learning_loop.candidates` when available.
3) Deduplicate findings by `pattern_key`.
4) Emit structured YAML under key `self_improvement_ci` with recurrence metadata.
5) Recommend promotion when recurrence thresholds are met.
6) Do not modify repository files in CI.
```
