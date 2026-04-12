# Workflow Example (Non-Active)

This is an example template only.
Keep it outside `.github/workflows` so nothing runs automatically.

When you are ready to enable CI automation:
1. Copy this template into `.github/workflows/simplify-and-harden-ci.md`
2. Adjust permissions, policy thresholds, and prompt details
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

Run Simplify & Harden in CI (headless mode) for this pull request.

Rules:
1) Review only files changed in this PR.
2) Do not modify repository files.
3) Simplify pass: detect dead code, naming clarity issues, control-flow complexity,
   unnecessary API surface, and over-abstraction.
4) Harden pass: detect input-validation gaps, injection vectors, auth/authz issues,
   secret exposure, data leaks, and concurrency risks.
5) Document pass: suggest non-obvious rationale comments as findings (do not edit files).
6) Emit structured YAML under key `simplify_and_harden`.
7) If blocking policy is enabled and matching findings exist, fail the run.
```
