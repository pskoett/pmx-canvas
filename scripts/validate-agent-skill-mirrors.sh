#!/bin/bash
set -euo pipefail

ROOTS=(".agents/skills" ".claude/skills" ".opencode/skills")
SKILLS=(
  "agent-teams-simplify-and-harden"
  "context-surfing"
  "eval-creator"
  "eval-creator-ci"
  "intent-framed-agent"
  "learning-aggregator"
  "learning-aggregator-ci"
  "plan-interview"
  "pre-flight-check"
  "self-improvement"
  "self-improvement-ci"
  "skill-tester"
  "skill-tester-ci"
  "simplify-and-harden"
  "simplify-and-harden-ci"
  "skill-pipeline"
  "verify-gate"
)

# Only validate roots that are present in this checkout. `.claude/skills/` is
# often excluded by a global gitignore and therefore absent in CI; skipping
# missing roots lets the check still guard drift between whatever trees ARE
# committed without producing false-negative CI failures.
EXISTING_ROOTS=()
for root in "${ROOTS[@]}"; do
  if [ -d "$root" ]; then
    EXISTING_ROOTS+=("$root")
  else
    echo "Skipping missing skills root: $root (not present in this checkout)" >&2
  fi
done

if [ "${#EXISTING_ROOTS[@]}" -lt 1 ]; then
  echo "No skills roots found to validate." >&2
  exit 1
fi

list_files() {
  local skill_root="$1"
  find "$skill_root" -type f | LC_ALL=C sort | sed "s#^$skill_root/##"
}

baseline_root="${EXISTING_ROOTS[0]}"

for skill in "${SKILLS[@]}"; do
  baseline_skill_dir="$baseline_root/$skill"

  if [ ! -d "$baseline_skill_dir" ]; then
    echo "Missing baseline skill: $baseline_skill_dir" >&2
    exit 1
  fi

  baseline_files="$(list_files "$baseline_skill_dir")"

  for root in "${EXISTING_ROOTS[@]:1}"; do
    skill_dir="$root/$skill"

    if [ ! -d "$skill_dir" ]; then
      echo "Missing mirrored skill: $skill_dir" >&2
      exit 1
    fi

    current_files="$(list_files "$skill_dir")"

    if [ "$baseline_files" != "$current_files" ]; then
      echo "File list mismatch for $skill between $baseline_root and $root" >&2
      diff <(printf '%s\n' "$baseline_files") <(printf '%s\n' "$current_files") || true
      exit 1
    fi

    while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      if ! cmp -s "$baseline_skill_dir/$rel" "$skill_dir/$rel"; then
        echo "Content mismatch for $skill/$rel between $baseline_root and $root" >&2
        exit 1
      fi
    done <<EOF
$baseline_files
EOF
  done
done

echo "Agent skill mirrors are in sync."
