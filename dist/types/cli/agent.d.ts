#!/usr/bin/env bun
/**
 * Agent-native CLI for pmx-canvas.
 *
 * Designed for non-interactive use by coding agents:
 * - Every input is a flag (no interactive prompts)
 * - JSON output by default
 * - Progressive --help discovery
 * - Fail fast with actionable errors
 * - Idempotent operations where possible
 * - --yes for destructive actions, --dry-run for preview
 */
/**
 * Extract the global `--port <n>` / `--server-url <url>` flags (any position,
 * `=` or space-separated value) and set the invocation's target override.
 * Returns the remaining args for command dispatch. Invalid values are a loud
 * `die` — never a silent fallback to the default port. `--server-url` wins
 * over `--port` when both are given.
 */
export declare function extractGlobalTargetFlags(args: string[]): string[];
export declare function runAgentCli(rawArgs: string[]): Promise<void>;
