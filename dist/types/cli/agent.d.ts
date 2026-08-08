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
import { extractGlobalTargetFlags } from './shared.js';
import './commands/nodes.js';
import './commands/edges.js';
import './commands/groups.js';
import './commands/view.js';
import './commands/query.js';
import './commands/pins.js';
import './commands/history.js';
import './commands/ax.js';
import './commands/webview.js';
import './commands/apps.js';
import './commands/copilot.js';
import './commands/skills.js';
import './commands/smoke.js';
export { extractGlobalTargetFlags };
export declare function runAgentCli(rawArgs: string[]): Promise<void>;
