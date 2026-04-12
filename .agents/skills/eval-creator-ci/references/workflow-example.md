# Workflow Example (Non-Active)

This is an example template only.
Keep it outside `.github/workflows` so nothing runs automatically.

When you are ready to enable CI automation:
1. Copy this template into `.github/workflows/eval-creator-ci.md`
2. Customize trigger, gate policy, and schedule
3. Validate with `gh aw compile` (add `--actionlint --zizmor` for security scan)

## Run Mode (per-PR regression check)

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
  cache-memory: true

safe-outputs:
  add-comment:
    max: 1
    hide-older-comments: true
  upload-artifact:
    max-uploads: 1

tracker-id: eval-creator

concurrency:
  group: eval-creator-run
  cancel-in-progress: false

strict: true
---

1. Read `.evals/EVAL_INDEX.md` to get the list of all eval cases. If the file does not exist or `.evals/` is empty, report zero evals and exit cleanly.

2. Check cache-memory at `/tmp/gh-aw/cache-memory/eval-run-history.json` for previous run results. Skip evals where the target files have not changed since last successful run (use git diff against cached commit SHA).

3. For each eval case file listed in the index, read its frontmatter and verification method.

4. Check the precondition for each eval. If the precondition is not met (e.g., required file does not exist, project does not use the relevant framework), mark the eval as `skip` and move to the next one.

5. Execute the verification method:
   - `grep-check`: Use grep/ripgrep to search target files for the pattern. Compare result to `expect` (found or not_found).
   - `command-check`: Run the specified command. Check exit code against `expect_exit`. Optionally check output content.
   - `file-check`: Verify the target file exists and optionally that the specified section exists within it.
   - `rule-check`: Read the target file and search for the expected content string. Compare to `expect` (found or not_found).

6. Record the result (pass, fail, skip) for each eval case.

7. Write updated run history to cache-memory at `/tmp/gh-aw/cache-memory/eval-run-history.json` with current commit SHA and results.

8. Emit the full results as structured YAML under key `eval_creator_ci` following the output schema in the skill definition.

9. Upload the results YAML as a workflow artifact named `eval-results`.

10. Post a human-readable summary as a PR comment. Format: failures first (with eval ID, pattern-key, expected vs actual, recovery action), then passes, then skips.

11. If gate policy is `strict`: fail the check run if any eval fails. If `critical-only`: fail only if a failed eval's source pattern has severity critical or high. If `advisory`: report only, do not fail.

12. Do not modify source code files. Only `.evals/EVAL_INDEX.md` metadata (last-run, last-result) may be updated.
```

## Create Mode (triggered by learning-aggregator-ci)

```markdown
---
on:
  workflow_call:
    inputs:
      gap_report_artifact:
        description: "Artifact name containing the gap report YAML"
        required: false
        type: string
        default: "gap-report"
  schedule:
    - cron: '0 10 * * 1'  # Monday 10am UTC (after learning-aggregator-ci)
  workflow_dispatch:

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
  upload-artifact:
    max-uploads: 1

tracker-id: eval-creator

concurrency:
  group: eval-creator-create
  cancel-in-progress: false

strict: true
---

1. If triggered via workflow_call: download the gap report artifact. Otherwise, read the most recent `learning_aggregator_ci` workflow artifact or gap report issue comment.

2. Extract promotion-ready patterns where `eval_candidate` is true.

3. Check cache-memory at `/tmp/gh-aw/cache-memory/eval-created-patterns.json` for patterns that already have eval cases. Skip duplicates.

4. For each new candidate, determine the appropriate verification method:
   - Knowledge gaps about conventions → `rule-check` (verify the rule exists in project instruction files)
   - Input validation patterns → `grep-check` (search for unvalidated input patterns)
   - Tool/dependency patterns → `command-check` (run the relevant tool command)
   - File structure patterns → `file-check` (verify expected files/sections exist)

5. Create an eval case file in `.evals/cases/` with proper frontmatter: id, pattern-key, source learning IDs, promoted-rule text, verification method, expected result, and recovery action.

6. Create the `.evals/` and `.evals/cases/` directories if they do not exist.

7. Add each new eval case to `.evals/EVAL_INDEX.md`. Create the index file if it does not exist.

8. Update cache-memory with the newly created pattern keys to prevent re-creation on next run.

9. Emit the creation results as structured YAML under key `eval_creator_ci` with `mode: create`.

10. Post a summary comment listing the new eval cases created.

11. Commit the new files with message: "chore: add eval cases from learning-aggregator-ci [skip ci]".

12. Do not modify source code files. Only write to `.evals/` directory.
```
