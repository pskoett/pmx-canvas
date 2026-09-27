/** The Home category migrated 0.6 snapshots land on, so they do not bury the boards in use. */
export declare const MIGRATED_SNAPSHOT_CATEGORY = "From old snapshots";
/** Slash-separated folder paths shared by the UI, HTTP/MCP and SDK. */
export declare function normalizeBoardCategory(value: string | null): string | null;
/** Includes implicit parents, so a board in A/B can also be moved into A. */
export declare function categoryAncestors(path: string): string[];
