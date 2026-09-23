import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
/** SEP-2640 methods are protocol requests, not model-facing canvas tools. */
export declare function registerSkillExtension(server: McpServer, catalog?: {
    skills: import("../server/bundled-skills.js").SkillEntry[];
    files: Map<string, {
        uri: string;
        mimeType: string;
    } & ({
        text: string;
    } | {
        blob: string;
    })>;
}): void;
