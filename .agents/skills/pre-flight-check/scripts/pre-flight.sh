#!/bin/bash
set -e

# Pre-flight check hook — surfaces accumulated learning signals at session start.
# Outputs nothing if there are no signals (zero overhead for clean projects).

LEARNINGS_DIR=".learnings"
EVALS_DIR=".evals"
HANDOFF_DIR=".context-surfing"

# Count learning entries
if [ -f "$LEARNINGS_DIR/LEARNINGS.md" ]; then
  learning_count=$(grep -c '^\## \[LRN-' "$LEARNINGS_DIR/LEARNINGS.md" 2>/dev/null) || learning_count=0
else
  learning_count=0
fi

# Count error entries
if [ -f "$LEARNINGS_DIR/ERRORS.md" ]; then
  error_count=$(grep -c '^\## \[ERR-' "$LEARNINGS_DIR/ERRORS.md" 2>/dev/null) || error_count=0
else
  error_count=0
fi

# Count promotion-ready patterns
if [ -f "$LEARNINGS_DIR/LEARNINGS.md" ]; then
  promo_count=$(grep -c 'promotion_ready' "$LEARNINGS_DIR/LEARNINGS.md" 2>/dev/null) || promo_count=0
else
  promo_count=0
fi

# Count failed evals
if [ -f "$EVALS_DIR/EVAL_INDEX.md" ]; then
  eval_fail_count=$(grep -c '| fail |' "$EVALS_DIR/EVAL_INDEX.md" 2>/dev/null) || eval_fail_count=0
else
  eval_fail_count=0
fi

# Count handoff files
if [ -d "$HANDOFF_DIR" ]; then
  handoff_count=$(find "$HANDOFF_DIR" -name "handoff-*.md" -type f 2>/dev/null | wc -l | tr -d ' ')
else
  handoff_count=0
fi

# Calculate total signals
signals=$((learning_count + error_count + promo_count + eval_fail_count + handoff_count))

# Only output if there are signals
if [ "$signals" -gt 0 ]; then
  echo "<pre-flight-check>"
  echo "Active learnings: $learning_count | Recent errors: $error_count | Promotion-ready: $promo_count | Failed evals: $eval_fail_count | Handoffs: $handoff_count"

  # Surface high-priority items
  if [ "$promo_count" -gt 0 ]; then
    echo ""
    echo "Promotion-ready patterns exist — consider running /learning-aggregator."
  fi

  if [ "$eval_fail_count" -gt 0 ]; then
    echo "Failed evals detected — consider running /eval-creator run before starting new work."
  fi

  if [ "$handoff_count" -gt 0 ]; then
    echo "Unread handoff files from previous sessions — read before starting new work."
  fi

  echo "</pre-flight-check>"
fi
