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
export declare function runAgentCli(args: string[]): Promise<void>;
