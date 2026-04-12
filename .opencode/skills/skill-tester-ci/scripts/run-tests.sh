#!/bin/bash
# Validates all CI skills: spec compliance + gh-aw workflow compilation.
# Usage: bash skills/skill-tester-ci/scripts/run-tests.sh [skill-name-ci]

set -e

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SKILLS_DIR="$REPO_ROOT/skills"
VALIDATE="$REPO_ROOT/.claude/skills/skill-creator/scripts/quick_validate.py"
TMPDIR=$(mktemp -d)

trap "rm -rf $TMPDIR" EXIT

pass=0; fail=0; compile_pass=0; compile_fail=0
failures=""

echo "## CI Skill Test Results"
echo
echo "**Date:** $(date +%Y-%m-%d)"
echo "**gh-aw version:** $(gh aw --version 2>/dev/null || echo 'not installed')"
echo

# Collect CI skills
ci_skills=""
if [ -n "$1" ]; then
  ci_skills="$1"
else
  for d in "$SKILLS_DIR"/*-ci/; do
    [ -d "$d" ] && ci_skills="$ci_skills $(basename $d)"
  done
fi

# Phase 1: Spec validation
echo "### Spec Validation"
for skill in $ci_skills; do
  skill_dir="$SKILLS_DIR/$skill"
  [ -d "$skill_dir" ] || continue

  if [ -f "$VALIDATE" ]; then
    result=$(python3 "$VALIDATE" "$skill_dir" 2>&1)
    code=$?
    if [ $code -eq 0 ]; then
      echo "  ✓ $skill"
      pass=$((pass + 1))
    else
      echo "  ✗ $skill: $result"
      fail=$((fail + 1))
    fi
  else
    echo "  SKIP $skill (quick_validate.py not found)"
  fi
done
echo

# Phase 2: Workflow compilation
echo "### Workflow Compilation"

if ! command -v gh >/dev/null 2>&1 || ! gh aw --version >/dev/null 2>&1; then
  echo "  SKIP (gh-aw not installed)"
else
  # Setup temp git repo
  mkdir -p "$TMPDIR/.github/workflows"
  cd "$TMPDIR" && git init -q && echo "init" > .gitkeep && git add -A && git commit -q -m "init"

  # Extract workflow blocks
  for skill in $ci_skills; do
    ref="$SKILLS_DIR/$skill/references/workflow-example.md"
    if [ ! -f "$ref" ]; then
      echo "  ⚠ $skill: no references/workflow-example.md"
      continue
    fi

    python3 -c "
import re, sys
content = open('$ref').read()
blocks = re.findall(r'\x60\x60\x60(?:markdown|yaml)?\n(.*?)\n\x60\x60\x60', content, re.DOTALL)
for i, block in enumerate(blocks):
    if '---' in block[:10]:
        suffix = f'-{i}' if i > 0 else ''
        fname = '$skill' + suffix + '.md'
        with open('$TMPDIR/.github/workflows/' + fname, 'w') as f:
            f.write(block)
        print(f'  Extracted {fname}', file=sys.stderr)
" 2>&1
  done

  cd "$TMPDIR" && git add -A && git commit -q -m "workflows"

  # Compile
  compile_out=$(gh aw compile 2>&1)
  compile_exit=$?

  # Parse results
  while IFS= read -r line; do
    if echo "$line" | grep -q "^✓"; then
      name=$(echo "$line" | sed 's/✓ .*workflows\///' | sed 's/ .*//')
      size=$(echo "$line" | grep -o '([0-9.]*.*KB)' || echo "")
      echo "  ✓ $name $size"
      compile_pass=$((compile_pass + 1))
    fi
  done <<< "$compile_out"

  # Show errors
  while IFS= read -r line; do
    if echo "$line" | grep -q "error:"; then
      echo "  ✗ $line"
      compile_fail=$((compile_fail + 1))
    fi
  done <<< "$compile_out"

  cd "$REPO_ROOT"
fi
echo

# Phase 3: Permission checks
echo "### Permission Checks"
for skill in $ci_skills; do
  ref="$SKILLS_DIR/$skill/references/workflow-example.md"
  [ -f "$ref" ] || continue

  issues_write=$(grep -c "issues: write" "$ref" 2>/dev/null || echo "0")
  pr_write=$(grep -c "pull-requests: write" "$ref" 2>/dev/null || echo "0")

  if [ "$issues_write" -gt 0 ] || [ "$pr_write" -gt 0 ]; then
    echo "  ✗ $skill: uses write permissions (blocked in strict mode)"
    fail=$((fail + 1))
  else
    echo "  ✓ $skill"
  fi
done
echo

# Phase 4: Structural checks
echo "### Structural Checks"
for skill in $ci_skills; do
  skill_dir="$SKILLS_DIR/$skill"
  issues=""

  # Has workflow example
  if [ ! -f "$skill_dir/references/workflow-example.md" ]; then
    issues="$issues missing workflow-example.md;"
  fi

  # Has corresponding interactive skill
  interactive=$(echo "$skill" | sed 's/-ci$//')
  if [ ! -d "$SKILLS_DIR/$interactive" ]; then
    issues="$issues no interactive counterpart ($interactive);"
  fi

  if [ -n "$issues" ]; then
    echo "  ⚠ $skill: $issues"
  else
    echo "  ✓ $skill"
  fi
done
echo

# Summary
total_spec=$((pass + fail))
echo "**Spec:** $pass/$total_spec passed"
echo "**Compile:** $compile_pass compiled, $compile_fail errors"
echo "**Permissions:** $([ $fail -eq 0 ] && echo 'clean' || echo "$fail issues")"

exit $((fail + compile_fail))
