#!/bin/bash
# Validates all interactive skills against the Agent Skills spec and project conventions.
# Usage: bash skills/skill-tester/scripts/run-tests.sh [skill-name]
#   No args: test all non-CI skills
#   With arg: test only the named skill

set -e

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SKILLS_DIR="$REPO_ROOT/skills"
PLUGIN_DIR="$REPO_ROOT/plugin/skills"
VALIDATE="$REPO_ROOT/.claude/skills/skill-creator/scripts/quick_validate.py"

pass=0; warn=0; fail=0
failures=""
warnings=""

check_skill() {
  local skill_dir="$1"
  local skill=$(basename "$skill_dir")

  # Skip CI skills
  [[ "$skill" == *-ci ]] && return
  [[ "$skill" == "skill-tester" ]] && return
  [[ "$skill" == "skill-tester-ci" ]] && return

  # 1. Anthropic spec validation
  if [ -f "$VALIDATE" ]; then
    result=$(python3 "$VALIDATE" "$skill_dir" 2>&1)
    code=$?
    if [ $code -ne 0 ]; then
      failures="${failures}\n  ✗ $skill: spec: $result"
      fail=$((fail + 1))
      return
    fi
  fi

  # 2. Name matches folder
  name=$(head -10 "$skill_dir/SKILL.md" | grep "^name:" | sed 's/name: *//' | tr -d '"')
  if [ "$name" != "$skill" ]; then
    failures="${failures}\n  ✗ $skill: name mismatch: frontmatter='$name' folder='$skill'"
    fail=$((fail + 1))
    return
  fi

  # 3. Line count
  lines=$(wc -l < "$skill_dir/SKILL.md" | tr -d ' ')
  if [ "$lines" -gt 600 ]; then
    failures="${failures}\n  ✗ $skill: $lines lines (hard limit 600)"
    fail=$((fail + 1))
    return
  elif [ "$lines" -gt 500 ]; then
    warnings="${warnings}\n  ⚠ $skill: $lines lines (soft limit 500)"
    warn=$((warn + 1))
  fi

  # 4. No README.md
  if [ -f "$skill_dir/README.md" ]; then
    failures="${failures}\n  ✗ $skill: contains README.md (not allowed per spec)"
    fail=$((fail + 1))
    return
  fi

  # 5. Scripts executable
  if [ -d "$skill_dir/scripts" ]; then
    for script in "$skill_dir"/scripts/*.sh; do
      [ -f "$script" ] || continue
      if [ ! -x "$script" ]; then
        failures="${failures}\n  ✗ $skill: $(basename $script) not executable"
        fail=$((fail + 1))
        return
      fi
      # Syntax check
      if ! bash -n "$script" 2>/dev/null; then
        failures="${failures}\n  ✗ $skill: $(basename $script) has syntax errors"
        fail=$((fail + 1))
        return
      fi
    done
  fi

  # 6. Description non-empty
  desc=$(head -10 "$skill_dir/SKILL.md" | grep "^description:" | sed 's/description: *//')
  if [ -z "$desc" ] || [ "$desc" = '""' ]; then
    failures="${failures}\n  ✗ $skill: empty description"
    fail=$((fail + 1))
    return
  fi

  pass=$((pass + 1))
}

echo "## Skill Test Results"
echo
echo "**Date:** $(date +%Y-%m-%d)"

if [ -n "$1" ]; then
  # Test single skill
  if [ -d "$SKILLS_DIR/$1" ]; then
    check_skill "$SKILLS_DIR/$1"
  else
    echo "Skill not found: $1"
    exit 1
  fi
else
  # Test all
  for d in "$SKILLS_DIR"/*/; do
    check_skill "$d"
  done
fi

total=$((pass + warn + fail))
echo "**Skills tested:** $total"
echo "**Passed:** $pass"
echo "**Warnings:** $warn"
echo "**Failed:** $fail"
echo

if [ $fail -gt 0 ]; then
  echo "### Failures"
  echo -e "$failures"
  echo
fi

if [ $warn -gt 0 ]; then
  echo "### Warnings"
  echo -e "$warnings"
  echo
fi

if [ $pass -gt 0 ]; then
  echo "### Passed"
  for d in "$SKILLS_DIR"/*/; do
    skill=$(basename "$d")
    [[ "$skill" == *-ci ]] && continue
    [[ "$skill" == "skill-tester" ]] && continue
    [[ "$skill" == "skill-tester-ci" ]] && continue
    echo "  ✓ $skill"
  done
fi

exit $fail
