---
name: learning-aggregator
description: "[Beta] Cross-session analysis of accumulated .learnings/ files. Reads all entries, groups by pattern_key, computes recurrence across sessions, and outputs ranked promotion candidates. This is the outer loop's inspect step — it turns raw learning data into actionable gap reports. Use on a regular cadence (weekly, before major tasks, or at session start for critical projects). Can be invoked manually or scheduled."
---

# Learning Aggregator

Reads accumulated `.learnings/` files across all sessions, finds patterns, and produces a ranked list of promotion candidates. This is the outer loop's **inspect** step.

Without this skill, `.learnings/` is a write-only log. Patterns accumulate but nobody synthesizes them. The same gap resurfaces two weeks later because no one looked.

## When to Use

- **Weekly cadence** — scheduled or manual, review accumulated learnings
- **Before major tasks** — check if the task area has known patterns
- **After a burst of sessions** — consolidate findings from a sprint or incident
- **When self-improvement flags `promotion_ready`** — verify the flag with full context

## What It Produces

A **gap report** — a ranked list of patterns that have crossed (or are approaching) the promotion threshold, with evidence and recommended actions.

## Step 1: Read All Learning Files

Read these files in `.learnings/`:

| File | Contains |
|------|----------|
| `LEARNINGS.md` | Corrections, knowledge gaps, best practices, recurring patterns |
| `ERRORS.md` | Command failures, API errors, exceptions |
| `FEATURE_REQUESTS.md` | Missing capabilities |

Parse each entry's metadata:
- `Pattern-Key` — the stable deduplication key
- `Recurrence-Count` — how many times this pattern has been seen
- `First-Seen` / `Last-Seen` — date range
- `Priority` — low / medium / high / critical
- `Status` — pending / promotion_ready / promoted / dismissed
- `Area` — frontend / backend / infra / tests / docs / config
- `Related Files` — which parts of the codebase are affected
- `Source` — conversation / error / user_feedback / simplify-and-harden
- `Tags` — free-form labels

## Step 2: Group and Aggregate

Group entries by `Pattern-Key`. For each group:

1. **Sum recurrences** across all entries with the same key
2. **Count distinct tasks** — how many different sessions/tasks encountered this
3. **Compute time window** — days between First-Seen and Last-Seen
4. **Collect all related files** — union of all entries' file references
5. **Take highest priority** across entries in the group
6. **Collect evidence** — the Summary and Details from each entry

For entries without a `Pattern-Key`, use conservative grouping only:
- **Exact match**: Same `Area` AND at least 2 identical `Tags`
- **File overlap**: Same `Related Files` path (exact path match, not substring)
- **Do NOT fuzzy-match** on Summary text — false groupings are worse than ungrouped entries

Flag ungrouped entries separately with a recommendation to assign a `Pattern-Key`. Ungrouped entries are common and expected — they may be one-off issues or genuinely novel problems.

## Step 3: Rank and Classify

### Promotion Threshold
An entry is **promotion-ready** when:
- `Recurrence-Count >= 3` across the group
- Seen in `>= 2 distinct tasks`
- Within a `30-day window`

### Approaching Threshold
An entry is **approaching** when:
- `Recurrence-Count >= 2` or
- `Priority: high/critical` with any recurrence

### Classification
For each promotion candidate, classify the gap type:

| Gap Type | Signal | Fix Target |
|----------|--------|------------|
| **Knowledge gap** | Agent didn't know X | Update project instruction files (CLAUDE.md, AGENTS.md, .github/copilot-instructions.md) |
| **Tool gap** | Agent improvised around missing capability | Add or update MCP tool / script |
| **Skill gap** | Same behavior pattern keeps failing | Create or update a skill (use `/skill-creator`, validate with `quick_validate.py`, register `skill-check` eval) |
| **Ambiguity** | Conflicting interpretations of spec/prompt | Tighten instructions or add examples |
| **Reasoning failure** | Agent had the knowledge but reasoned wrong | Add explicit decision rules or constraints |

## Step 4: Produce Gap Report

Output a structured report:

```markdown
## Learning Aggregator: Gap Report

**Scan date:** YYYY-MM-DD
**Period:** [since date] to [now]
**Entries scanned:** N
**Patterns found:** N
**Promotion-ready:** N
**Approaching threshold:** N

### Promotion-Ready Patterns

#### 1. [Pattern-Key] — [Summary]

- **Recurrence:** N times across M tasks
- **Window:** First-Seen → Last-Seen
- **Priority:** high
- **Gap type:** knowledge gap
- **Area:** backend
- **Related files:** path/to/file.ext
- **Evidence:**
  - [LRN-YYYYMMDD-001] Summary of first occurrence
  - [LRN-YYYYMMDD-002] Summary of second occurrence
  - [ERR-YYYYMMDD-001] Summary of related error
- **Recommended action:** Add rule to project instruction files (CLAUDE.md, AGENTS.md, .github/copilot-instructions.md): "[concise prevention rule]"
- **Eval candidate:** Yes — [description of what to test]

#### 2. ...

### Approaching Threshold

#### 1. [Pattern-Key] — [Summary]
- **Recurrence:** 2 times across 1 task
- **Needs:** 1 more recurrence or 1 more distinct task
- ...

### Ungrouped Entries (no Pattern-Key)

- [LRN-YYYYMMDD-005] "Summary" — needs pattern_key assignment
- ...

### Dismissed / Stale

- Entries with Last-Seen > 90 days ago and Status: pending → recommend dismissal
```

## Step 5: Handoff

The gap report feeds into:

1. **harness-updater agent** — takes promotion-ready patterns and applies them to project instruction files (CLAUDE.md, AGENTS.md, .github/copilot-instructions.md)
2. **eval-creator skill** — takes eval candidates and creates permanent test cases
3. **Human review** — for patterns classified as "reasoning failure" or "ambiguity" (these need human judgment)

## Filtering

- `--since YYYY-MM-DD` — only scan entries after this date
- `--min-recurrence N` — raise the promotion threshold
- `--area AREA` — filter to a specific area (frontend, backend, etc.)

## Persistence

By default, reads `.learnings/` from the working directory. When `repo-memory` is configured, reads from the memory branch instead — giving a complete view across all environments and sessions, even in fresh clones or ephemeral workspaces.

### Tracker-id in gap reports

Each promotion candidate in the gap report includes a `tracker` field set to the pattern-key. This tracker propagates through the full chain: harness-updater embeds it as a comment in project instruction files, eval-creator references it in eval cases. To audit the full lifecycle of a pattern, search for `tracker:[pattern-key]` across the repo and GitHub.

## What This Skill Does NOT Do

- Does not modify `.learnings/` files (read-only analysis)
- Does not apply promotions (that's harness-updater)
- Does not create evals (that's eval-creator)
- Does not fix code or run tests
- Does not replace human judgment for ambiguous patterns
