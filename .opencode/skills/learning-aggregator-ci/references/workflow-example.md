# Workflow Example (Non-Active)

This is an example template only.
Keep it outside `.github/workflows` so nothing runs automatically.

When you are ready to enable CI automation:
1. Copy this template into `.github/workflows/learning-aggregator-ci.md`
2. Customize the schedule for your team's cadence
3. Validate with `gh aw compile` (add `--actionlint --zizmor` for security scan)

```markdown
---
on:
  schedule:
    - cron: '0 9 * * 1'
  workflow_dispatch:
  issue_comment:
    types: [created]

permissions:
  contents: read
  actions: read
  issues: read
  pull-requests: read

tools:
  github:
    toolsets: [pull_requests, actions, issues]
  cache-memory: true

safe-outputs:
  add-comment:
    max: 1
    hide-older-comments: true
  upload-artifact:
    max-uploads: 1
  call-workflow:
    workflows: [eval-creator-ci]
    max: 1

tracker-id: learning-aggregator

concurrency:
  group: learning-aggregator
  cancel-in-progress: false

strict: true
---

1. Read all files in `.learnings/` directory: `LEARNINGS.md`, `ERRORS.md`, `FEATURE_REQUESTS.md`. If the directory does not exist or is empty, report zero findings and exit.

2. Check cache-memory at `/tmp/gh-aw/cache-memory/learning-aggregator-state.json` for previous aggregation state. If found, load prior pattern groups and recurrence counts as a baseline. Only re-process entries with `Last-Seen` newer than the cached scan date.

3. Parse each entry's structured metadata fields: `Pattern-Key`, `Recurrence-Count`, `First-Seen`, `Last-Seen`, `Priority`, `Status`, `Area`, `Related Files`, `Source`, `Tags`.

4. Group entries by exact `Pattern-Key` match. Do not attempt fuzzy grouping — false positives are worse than ungrouped entries in CI.

5. For each group: sum `Recurrence-Count` across entries, count distinct task references, compute the time window between earliest `First-Seen` and latest `Last-Seen`, collect all evidence summaries.

6. Identify promotion-ready patterns: `Recurrence-Count >= 3` AND `distinct tasks >= 2` AND within a `30-day window`.

7. Identify approaching patterns: `Recurrence-Count >= 2` OR `Priority: high/critical` with any recurrence.

8. Flag entries without `Pattern-Key` as ungrouped with a recommendation to assign one.

9. Flag entries with `Last-Seen` older than 90 days as stale with a recommendation to dismiss.

10. Classify each promotion-ready pattern's gap type: knowledge gap (agent didn't know), tool gap (agent improvised), skill gap (same behavior fails), ambiguity (conflicting interpretations), reasoning failure (agent had knowledge but reasoned wrong).

11. Write updated aggregation state to cache-memory at `/tmp/gh-aw/cache-memory/learning-aggregator-state.json` for the next run.

12. Emit the full gap report as structured YAML under key `learning_aggregator_ci` following the output schema in the skill definition.

13. Upload the gap report YAML as a workflow artifact named `gap-report`.

14. Post a human-readable summary as a comment. Format: promotion-ready patterns first (with evidence and recommended action), then approaching patterns, then ungrouped entries, then stale entries.

15. If any promotion-ready patterns have `eval_candidate: true`, trigger `eval-creator-ci` via call-workflow to create eval cases from the newly promoted patterns.

16. Do not modify any repository files. This workflow is read-only.
```
