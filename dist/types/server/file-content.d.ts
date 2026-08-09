/**
 * Shared disk reader for `file` canvas nodes.
 *
 * Both entry points that put a file on the canvas — `buildFileNodeData`
 * (creation) and the file watcher (live updates) — go through here so their
 * notion of "what this file is" can never drift. Reading a file blind with
 * `readFileSync(path, 'utf-8')` turned binaries into mojibake and had no size
 * ceiling at all, so a multi-GB file was pulled into memory as a string.
 */
/** Text past this many bytes is stored truncated instead of whole. */
export declare const MAX_FILE_TEXT_BYTES: number;
export type FileNodeContent = 
/** Missing, unreadable, or not a regular file — the node stays path-backed. */
{
    kind: 'unavailable';
} | {
    kind: 'binary';
    byteSize: number;
    mtimeMs: number;
    mimeType?: string;
} | {
    kind: 'text';
    byteSize: number;
    mtimeMs: number;
    text: string;
    lineCount: number;
    truncated: boolean;
};
/**
 * PDF check straight from a path, for the byte route's server-derived
 * Content-Type. Reads only the magic-byte prefix. Any read failure is "not a
 * PDF" — the caller then serves an opaque download rather than an inline type.
 */
export declare function isPdfFilePath(filePath: string): boolean;
/**
 * Classify a file and read at most `MAX_FILE_TEXT_BYTES` of it.
 *
 * Never throws: an unreadable path is reported as `unavailable`, matching the
 * pre-existing behavior where a bad path still rendered as a file node.
 */
export declare function readFileNodeContent(filePath: string): FileNodeContent;
/**
 * Map a read result onto `file` node data in place, clearing the fields the new
 * state contradicts (a file that turns binary must not keep stale decoded text).
 */
export declare function applyFileContentToNodeData(data: Record<string, unknown>, content: FileNodeContent): Record<string, unknown>;
