/**
 * Shared helpers for the AX operation modules (ax-state.ts, ax-work.ts, and the
 * later timeline/delivery waves). These were replicated per-file during the
 * plan-007 Slice B migration; centralizing them here keeps one definition site
 * as more AX op files land.
 *
 * `normalizeAxSource` / `normalizeAxNodeIds` are reimplemented from server.ts
 * because `operations/` must never import server.ts (the SSE emitter is injected;
 * see plan-005). This module likewise must not import server.ts or index.ts.
 */
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { PmxAxSource } from '../../ax-state.js';
export declare const AX_SOURCES: readonly ["agent", "api", "browser", "cli", "codex", "copilot", "mcp", "sdk", "system"];
/** Zod schema for the optional `source` field shared by AX MCP tool shapes. */
export declare const AX_SOURCE_SHAPE: z.ZodOptional<z.ZodEnum<{
    agent: "agent";
    api: "api";
    browser: "browser";
    cli: "cli";
    codex: "codex";
    copilot: "copilot";
    mcp: "mcp";
    sdk: "sdk";
    system: "system";
}>>;
/** An absent or unrecognized source falls back to the per-surface default. */
export declare function normalizeAxSource(value: unknown, fallback: PmxAxSource): PmxAxSource;
export declare function normalizeAxNodeIds(value: unknown): string[];
/** The plain JSON tool result shared by AX ops whose MCP body is the wire body. */
export declare function axJsonResult(result: unknown): CallToolResult;
