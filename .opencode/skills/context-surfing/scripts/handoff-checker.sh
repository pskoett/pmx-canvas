#!/bin/bash
# Context Surfing Handoff Checker Hook
# Triggers on UserPromptSubmit to check for unread handoff files
# If found, reminds the agent to load the handoff before starting new work

set -e

HANDOFF_DIR=".context-surfing"

# Skip if no handoff directory exists
if [ ! -d "$HANDOFF_DIR" ]; then
  exit 0
fi

# Find handoff files (non-empty .md files)
HANDOFF_FILES=$(find "$HANDOFF_DIR" -name "handoff-*.md" -size +0c 2>/dev/null)

if [ -z "$HANDOFF_FILES" ]; then
  exit 0
fi

# Count handoff files
COUNT=$(echo "$HANDOFF_FILES" | wc -l | tr -d ' ')

cat << EOF
<context-surfing-handoff>
Found ${COUNT} unread handoff file(s) from a previous context-surfing session:

$(echo "$HANDOFF_FILES" | while read -r f; do echo "- $f"; done)

Before starting new work, you MUST:
1. Read the handoff file(s) completely
2. Ask the user if they want to resume from the handoff or start fresh
3. If resuming: run plan-interview with the handoff as input, re-establish the intent frame, then pick up context-surfing
4. If starting fresh: confirm with the user, then delete or archive the handoff file(s)

Do not ignore handoff files — they contain session state from a previous context exit.
</context-surfing-handoff>
EOF
