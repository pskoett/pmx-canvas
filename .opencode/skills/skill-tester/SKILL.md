---
name: skill-tester
description: "Validates all interactive skills in this repo against the Agent Skills spec, project conventions, and structural requirements. Runs quick_validate.py, checks line limits, verifies cross-references, and tests hook scripts. Use when skills have been added or modified and you want to verify everything passes before committing or submitting."
---

# Skill Tester

Validates all interactive (non-CI) skills in this repo. Runs the Anthropic skill-creator's `quick_validate.py` plus project-specific checks.

## When to Use

- After adding or modifying a skill
- Before committing changes
- Before submitting the plugin for Anthropic review
- As part of the outer loop when eval-creator needs to verify skill quality

## Checks

### 1. Anthropic Spec Validation

Run `quick_validate.py` on every skill in `skills/` (excluding `-ci` variants):

```bash
for d in skills/*/; do
  skill=$(basename "$d")
  [[ "$skill" == *-ci ]] && continue
  python3 .claude/skills/skill-creator/scripts/quick_validate.py "$d"
done
```

**Pass criteria:** Exit code 0 for every skill. Frontmatter has only allowed keys (`name`, `description`, `license`, `allowed-tools`, `metadata`, `compatibility`). Name is kebab-case, max 64 chars. Description max 1024 chars, no angle brackets.

### 2. Project Convention Checks

For each skill directory:

| Check | Rule | Severity |
|-------|------|----------|
| Name matches folder | Frontmatter `name` == directory name | Error |
| Line limit | SKILL.md under 500 lines (soft), under 600 lines (hard) | Warning / Error |
| No README.md | Skill folders must not contain README.md | Error |
| Scripts executable | All `.sh` files in `scripts/` must have execute permission | Error |
| References exist | Files referenced in SKILL.md body actually exist in `references/` | Warning |
| Description non-empty | Description field is present and non-empty | Error |

### 3. Cross-Reference Validation

Verify that all skills listed in these files actually exist as directories:

- `CLAUDE.md` — Skill References section
- `AGENTS.md` — Skill References section
- `.github/copilot-instructions.md` — Skill References section
- `README.md` — Skills table

Also verify reverse: every skill directory is listed in all four files.

### 4. Hook Script Testing

For each skill with a `scripts/` directory:

```bash
# Syntax check
bash -n scripts/*.sh

# Verify shebang
head -1 scripts/*.sh | grep -q "^#!/bin/bash"

# Verify executable
test -x scripts/*.sh
```

### 5. Plugin Skill Validation

For skills that exist in both `skills/` and `plugin/skills/`:

| Check | Rule |
|-------|------|
| Plugin frontmatter keys | Only Claude Code-specific keys (`hooks`, `user-invocable`, `argument-hint`) added beyond spec |
| Content alignment | Body content matches or plugin has extracted references |
| Beta markers consistent | If `skills/` copy has `[Beta]`, plugin copy should too |

## Output Format

```markdown
## Skill Test Results

**Date:** YYYY-MM-DD
**Skills tested:** N
**Passed:** N
**Warnings:** N
**Failed:** N

### Failures
- [skill-name]: [check]: [error message]

### Warnings
- [skill-name]: [check]: [warning message]

### All Passed
- [list of clean skills]
```

## Running

Invoke manually:
```
/skill-tester
```

Or run the script directly:
```bash
bash skills/skill-tester/scripts/run-tests.sh
```

## What This Skill Does NOT Do

- Does not test CI skills (use `skill-tester-ci` for those)
- Does not modify skills — reports findings only
- Does not run behavioral evals (trigger testing) — use skill-creator's `run_eval.py` for that
- Does not replace the eval-creator regression framework — this tests skill structure, not promoted rules
