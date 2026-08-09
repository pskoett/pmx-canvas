/**
 * Shared core for the agent-native CLI.
 *
 * Holds the command registry (COMMANDS + cmd()), flag parsing, output/die,
 * target resolution (getBaseUrl + global --port/--server-url handling), the
 * operation invoker, and every helper used by two or more command domains.
 * Command modules in src/cli/commands/ import from here only — this module
 * must never import from agent.ts or any command module (cycle-free).
 */
declare function getBaseUrl(): string;
/**
 * Extract the global `--port <n>` / `--server-url <url>` flags (any position,
 * `=` or space-separated value) and set the invocation's target override.
 * Returns the remaining args for command dispatch. Invalid values are a loud
 * `die` — never a silent fallback to the default port. `--server-url` wins
 * over `--port` when both are given.
 */
export declare function extractGlobalTargetFlags(args: string[]): string[];
declare function die(message: string, hint?: string): never;
declare function output(data: unknown): void;
declare function invokeOperation(name: string, input: Record<string, unknown>): Promise<unknown>;
/**
 * `options.boolFlags` marks flags that are boolean FOR THIS COMMAND. Value
 * flags consume the next token verbatim (so a unified diff beginning with
 * `--- a/file` survives), which makes a flag that is boolean here and
 * value-taking elsewhere ambiguous — `--summary` is boolean in `history` /
 * `layout` / `node get` / `validate spec` but carries text in `node add`.
 * Without this per-command override, `history --summary --limit 5` would
 * swallow `--limit` as the summary's value. The global set below holds flags
 * that are boolean everywhere.
 */
declare function parseFlags(args: string[], options?: {
    boolFlags?: readonly string[];
}): {
    positional: string[];
    flags: Record<string, string | true>;
};
declare function requireFlag(flags: Record<string, string | true>, name: string, hint: string): string;
declare function getStringFlag(flags: Record<string, string | true>, ...names: string[]): string | undefined;
declare function optionalNumberFlag(flags: Record<string, string | true>, name: string, hint: string): number | undefined;
/**
 * AX `source` for a CLI-originated action. Defaults to `cli`, but honors an
 * explicit `--source <label>` so an adapterless agent using the CLI as a fallback
 * transport (e.g. `--source codex`) attributes its actions correctly — keeping
 * loop-safety (a consumer never gets back its own steering) accurate (report #69).
 */
declare function resolveAxSource(flags: Record<string, string | true>): string;
declare function optionalFiniteFlag(flags: Record<string, string | true>, name: string, hint: string): number | undefined;
declare function optionalPositiveFiniteFlag(flags: Record<string, string | true>, name: string, hint: string): number | undefined;
declare function optionalPositiveFiniteFlagWithAliases(flags: Record<string, string | true>, hint: string, ...names: string[]): number | undefined;
declare function optionalBooleanFlag(flags: Record<string, string | true>, name: string, hint: string): boolean | undefined;
declare function applyStrictSizeFlags(body: Record<string, unknown>, flags: Record<string, string | true>): void;
declare function isRecord(value: unknown): value is Record<string, unknown>;
declare function parseJsonValue(raw: string, label: string, hint: string): unknown;
declare function readOptionalTextInput(flags: Record<string, string | true>, options: {
    fileFlags?: string[];
    valueFlags?: string[];
    allowStdin?: boolean;
    label: string;
    hint: string;
}): Promise<string | undefined>;
declare function applyCommonGeometryFlags(body: Record<string, unknown>, flags: Record<string, string | true>, hints: {
    x: string;
    y: string;
    width: string;
    height: string;
}): void;
declare function buildJsonRenderRequestBody(flags: Record<string, string | true>): Promise<Record<string, unknown>>;
declare function buildHtmlPrimitiveRequestBody(flags: Record<string, string | true>): Promise<Record<string, unknown>>;
declare function buildGraphRequestBody(flags: Record<string, string | true>, options?: {
    requireData?: boolean;
    allowStdin?: boolean;
}): Promise<Record<string, unknown>>;
declare function runWebArtifactBuildCommand(flags: Record<string, string | true>): Promise<void>;
declare const COMMANDS: Record<string, {
    run: (args: string[]) => Promise<void>;
    help: string;
    examples: string[];
}>;
declare const RESOURCE_COMMAND_ALIASES: Record<string, Record<string, string>>;
declare const RESOURCE_SUBCOMMAND_HINTS: Record<string, Record<string, string>>;
declare function cmd(name: string, help: string, examples: string[], run: (args: string[]) => Promise<void>): void;
declare function showCommandHelp(name: string): void;
declare function readStdin(): Promise<string>;
export { COMMANDS, RESOURCE_COMMAND_ALIASES, RESOURCE_SUBCOMMAND_HINTS, applyCommonGeometryFlags, applyStrictSizeFlags, buildGraphRequestBody, buildHtmlPrimitiveRequestBody, buildJsonRenderRequestBody, cmd, die, getBaseUrl, getStringFlag, invokeOperation, isRecord, optionalBooleanFlag, optionalFiniteFlag, optionalNumberFlag, optionalPositiveFiniteFlag, optionalPositiveFiniteFlagWithAliases, output, parseFlags, parseJsonValue, readOptionalTextInput, readStdin, requireFlag, resolveAxSource, runWebArtifactBuildCommand, showCommandHelp, };
