# Copilot Instructions

## Agent Skill Pipeline

This repo ships an agent-facing skill pipeline under `.agents/skills/`, `.claude/skills/`, and `.opencode/skills/`.

- Use `skill-pipeline` to classify coding tasks and route them through the right depth.
- For larger implementation work, prefer the pipeline of `plan-interview`, `intent-framed-agent`, `context-surfing`, `verify-gate`, `simplify-and-harden`, and `self-improvement`.
- Use `learning-aggregator` and `eval-creator` for cross-session improvement loops.
- Use the `*-ci` variants for headless CI workflows only.

## Learnings

After solving non-obvious issues, consider logging to `.learnings/` using the `self-improvement` skill format.

- Corrections and best practices: `.learnings/LEARNINGS.md`
- Failures and debugging outcomes: `.learnings/ERRORS.md`
- Missing capabilities: `.learnings/FEATURE_REQUESTS.md`

Promote broadly reusable patterns into `CLAUDE.md`, `AGENTS.md`, or this file when they should guide future sessions.
