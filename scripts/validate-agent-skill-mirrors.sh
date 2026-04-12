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
  "simplify-and-harden"
  "simplify-and-harden-ci"
  "skill-pipeline"
  "verify-gate"
)

for root in "${ROOTS[@]}"; do
  if [ ! -d "$root" ]; then
    echo "Missing skills root: $root" >&2
    exit 1
  fi
done

list_files() {
  local skill_root="$1"
  find "$skill_root" -type f | LC_ALL=C sort | sed "s#^$skill_root/##"
}

baseline_root="${ROOTS[0]}"

for skill in "${SKILLS[@]}"; do
  baseline_skill_dir="$baseline_root/$skill"

  if [ ! -d "$baseline_skill_dir" ]; then
    echo "Missing baseline skill: $baseline_skill_dir" >&2
    exit 1
  fi

  baseline_files="$(list_files "$baseline_skill_dir")"

  for root in "${ROOTS[@]:1}"; do
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
