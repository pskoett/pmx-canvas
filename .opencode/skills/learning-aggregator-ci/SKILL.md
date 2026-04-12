---
name: learning-aggregator-ci
description: "[Beta] CI-only learning aggregation workflow using gh-aw (GitHub Agentic Workflows). Scans .learnings/ files on a schedule, groups entries by pattern_key, identifies promotion-ready patterns, and posts a gap report as a PR or issue comment. Use when: you want automated cross-session pattern detection in CI/headless pipelines without interactive prompts. For interactive use, use learning-aggregator."
---

# Learning Aggregator CI

## Install

```bash
npx skills add pskoett/pskoett-ai-skills/skills/learning-aggregator-ci
```

For interactive sessions, use:

```bash
npx skills add pskoett/pskoett-ai-skills/skills/learning-aggregator
```

## Purpose

Runs the outer loop's **inspect** step in CI. Reads accumulated `.learnings/` files, groups entries by `pattern_key`, computes cross-session recurrence, and produces a ranked gap report — all without human interaction.

The interactive `learning-aggregator` skill is designed for in-session use where the user can review and act on findings immediately. This CI variant runs on a schedule (weekly, per-sprint, or on-demand) and posts its findings as a GitHub issue comment for async review.

## Context Limitation (Important)

CI agents do not have session context. They cannot see what the user is currently working on or what task area is relevant. The CI variant scans **all** `.learnings/` entries without relevance filtering. The gap report is comprehensive rather than targeted.

## Prerequisites

- GitHub Actions enabled on the repository
- `gh` CLI authenticated with repo access
- `gh-aw` extension installed (`gh extension install github/gh-aw`, v0.40.1+)
- `.learnings/` directory with structured entries from `self-improvement`

## CI Contract

Hard rules for headless execution:

1. **Read-only** — do not modify `.learnings/` files, project instruction files (CLAUDE.md, AGENTS.md, .github/copilot-instructions.md), or any repo files
2. **Headless** — no interactive prompts, no approval gates
3. **Structured output** — emit findings as YAML under `learning_aggregator_ci` key
4. **Single comment** — post one consolidated comment per run, not per finding
5. **Deterministic** — same `.learnings/` state produces the same gap report

## Authoring Workflow (gh-aw)

1. Copy `references/workflow-example.md` into `.github/workflows/learning-aggregator-ci.md`
2. Customize the schedule for your cadence (supports fuzzy schedules like `weekly on mondays`)
3. Validate: `gh aw compile` (optionally add `--actionlint --zizmor` for full security scan)
4. Push to enable

### Persistence and Chaining

- **`cache-memory:`** stores aggregation state (pattern groups, recurrence counts) across runs. Survives up to 90 days in Actions cache. Avoids re-scanning unchanged entries on every run.
- **`call-workflow:`** triggers `eval-creator-ci` after aggregation completes to create evals from newly promoted patterns. Compile-time fan-out with proper dependency wiring.
- **`upload-artifact:`** persists the gap report YAML for consumption by downstream workflows or human review.

## Workflow Rules

The CI agent follows these rules in order:

1. Read all files in `.learnings/`: `LEARNINGS.md`, `ERRORS.md`, `FEATURE_REQUESTS.md`
2. Parse each entry's metadata: `Pattern-Key`, `Recurrence-Count`, `First-Seen`, `Last-Seen`, `Priority`, `Status`, `Area`, `Related Files`, `Tags`
3. Group entries by `Pattern-Key` (exact match only — no fuzzy grouping in CI)
4. For each group: sum recurrences, count distinct tasks, compute time window, collect evidence
5. Flag entries without `Pattern-Key` as ungrouped
6. Classify each group's gap type: knowledge gap, tool gap, skill gap, ambiguity, or reasoning failure
7. Rank groups by: promotion-ready first, then approaching threshold, then by priority (critical > high > medium > low)
8. Emit structured YAML under key `learning_aggregator_ci`
9. Post gap report as a comment on the triggering issue or as a new issue if running on schedule
10. Do not modify repository files

## Output Schema

```yaml
learning_aggregator_ci:
  version: "0.1.0"
  source:
    run_id: "<workflow run ID>"
    trigger: "schedule | workflow_dispatch | issue_comment"
    scan_date: "YYYY-MM-DD"
  scan:
    entries_total: 42
    entries_with_pattern_key: 35
    entries_ungrouped: 7
    patterns_found: 18
    promotion_ready: 3
    approaching_threshold: 5
  promotion_ready:
    - pattern_key: "harden.input_validation"
      recurrence_count: 5
      distinct_tasks: 3
      window_days: 21
      priority: "high"
      gap_type: "knowledge_gap"
      area: "backend"
      evidence:
        - "LRN-20260301-001: Missing bounds check on pagination params"
        - "ERR-20260308-002: Unconstrained string length caused OOM"
        - "LRN-20260315-003: API params not validated before DB query"
      recommended_action: "Add to project instruction files: Always validate and bound-check external inputs before use"
      eval_candidate: true
  approaching:
    - pattern_key: "simplify.dead_code"
      recurrence_count: 2
      distinct_tasks: 1
      priority: "low"
      needs: "1 more distinct task"
  ungrouped:
    - id: "LRN-20260320-005"
      summary: "Discovered undocumented rate limit on external API"
      recommendation: "Assign pattern_key for future tracking"
  stale:
    - pattern_key: "harden.error_handling"
      last_seen: "2025-12-01"
      recommendation: "Dismiss — not seen in 90+ days"
  summary:
    promotion_ready_total: 3
    approaching_total: 5
    ungrouped_total: 7
    stale_total: 1
    followup_required: true
```

## Recommended Outputs

| Output | Destination | Content |
|--------|------------|---------|
| Gap report | Issue comment or new issue | Human-readable summary with promotion candidates and evidence |
| YAML artifact | Workflow artifact | Machine-readable `learning_aggregator_ci` payload |
| Check annotation | Check run summary | Count of promotion-ready and approaching patterns |

## Trigger Configuration

**Recommended: weekly schedule + manual dispatch**

```yaml
on:
  schedule:
    - cron: '0 9 * * 1'  # Monday 9am UTC
  workflow_dispatch:
  issue_comment:
    types: [created]
```

The schedule ensures regular outer-loop cadence. Manual dispatch allows on-demand runs after incidents or sprints. Issue comment trigger allows `/aggregate-learnings` commands.

## Integration with Other Skills

### Upstream (feeds from)
- `self-improvement` and `self-improvement-ci` — produce `.learnings/` entries
- `simplify-and-harden-ci` — produces `learning_loop.candidates` consumed by self-improvement-ci

### Downstream (feeds into)
- **harness-updater** (interactive) — takes promotion-ready patterns from the gap report and applies them
- **eval-creator-ci** — takes eval candidates and creates permanent test cases
- **Human review** — gap report posted as issue comment for team triage

### Data Flow

```
self-improvement → .learnings/*.md
                       ↓
              learning-aggregator-ci (scheduled)
                       ↓
              gap report (issue comment + artifact)
                       ↓
              harness-updater (interactive, human-gated)
                       ↓
              eval-creator-ci (creates evals from promoted patterns)
```

## Differences from Interactive Version

| Aspect | Interactive (`learning-aggregator`) | CI (`learning-aggregator-ci`) |
|--------|------|------|
| Trigger | Manual or session-start | Scheduled cron or workflow_dispatch |
| Relevance filter | Filters by current task area | Scans all entries (no task context) |
| Grouping | Conservative + area/tag matching | Pattern-key exact match only |
| Output | In-session gap report | Issue comment + YAML artifact |
| Human interaction | User reviews inline | Async review via GitHub |
| Scope | Current session context | Full .learnings/ history |
