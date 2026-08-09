/**
 * Shared disk reader for `file` canvas nodes.
 *
 * Both entry points that put a file on the canvas — `buildFileNodeData`
 * (creation) and the file watcher (live updates) — go through here so their
 * notion of "what this file is" can never drift. Reading a file blind with
 * `readFileSync(path, 'utf-8')` turned binaries into mojibake and had no size
 * ceiling at all, so a multi-GB file was pulled into memory as a string.
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { extname } from 'node:path';

/** Text past this many bytes is stored truncated instead of whole. */
export const MAX_FILE_TEXT_BYTES = 2 * 1024 * 1024;

/** Bytes sniffed to classify a file without reading all of it. */
const SNIFF_BYTES = 8192;

const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');

export type FileNodeContent =
  /** Missing, unreadable, or not a regular file — the node stays path-backed. */
  | { kind: 'unavailable' }
  | { kind: 'binary'; byteSize: number; mtimeMs: number; mimeType?: string }
  | { kind: 'text'; byteSize: number; mtimeMs: number; text: string; lineCount: number; truncated: boolean };

function isPdfFile(prefix: Buffer, filePath: string): boolean {
  if (prefix.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) return true;
  return extname(filePath).toLowerCase() === '.pdf';
}

/**
 * PDF check straight from a path, for the byte route's server-derived
 * Content-Type. Reads only the magic-byte prefix. Any read failure is "not a
 * PDF" — the caller then serves an opaque download rather than an inline type.
 */
export function isPdfFilePath(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, 'r');
    const prefix = Buffer.alloc(PDF_MAGIC.length);
    const read = readSync(fd, prefix, 0, PDF_MAGIC.length, 0);
    return isPdfFile(prefix.subarray(0, read), filePath);
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // best effort
      }
    }
  }
}

/**
 * Classify a file and read at most `MAX_FILE_TEXT_BYTES` of it.
 *
 * Never throws: an unreadable path is reported as `unavailable`, matching the
 * pre-existing behavior where a bad path still rendered as a file node.
 */
export function readFileNodeContent(filePath: string): FileNodeContent {
  let fd: number | null = null;
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return { kind: 'unavailable' };
    const byteSize = stat.size;
    const mtimeMs = stat.mtimeMs;

    fd = openSync(filePath, 'r');

    // Classify from a prefix only — never read a huge file just to type it.
    const sniff = Buffer.alloc(Math.min(SNIFF_BYTES, byteSize));
    const prefix = sniff.subarray(0, sniff.length > 0 ? readSync(fd, sniff, 0, sniff.length, 0) : 0);

    // A PDF need not carry a NUL byte in its header, so the magic bytes decide
    // first; `.pdf` is the secondary signal for the same call.
    if (isPdfFile(prefix, filePath)) {
      return { kind: 'binary', byteSize, mtimeMs, mimeType: 'application/pdf' };
    }
    if (prefix.includes(0x00)) {
      return { kind: 'binary', byteSize, mtimeMs };
    }

    const readLength = Math.min(byteSize, MAX_FILE_TEXT_BYTES);
    const buffer = Buffer.alloc(readLength);
    let filled = 0;
    while (filled < readLength) {
      const read = readSync(fd, buffer, filled, readLength - filled, filled);
      if (read <= 0) break;
      filled += read;
    }

    // `stream: true` makes the decoder hold back a multi-byte sequence the cap
    // sliced in half instead of emitting U+FFFD; we never flush, so the partial
    // trailing bytes are simply dropped and the text ends on a real character.
    const text = new TextDecoder('utf-8').decode(buffer.subarray(0, filled), { stream: true });

    return {
      kind: 'text',
      byteSize,
      mtimeMs,
      text,
      lineCount: text.split('\n').length,
      truncated: byteSize > MAX_FILE_TEXT_BYTES,
    };
  } catch {
    return { kind: 'unavailable' };
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * Map a read result onto `file` node data in place, clearing the fields the new
 * state contradicts (a file that turns binary must not keep stale decoded text).
 */
export function applyFileContentToNodeData(
  data: Record<string, unknown>,
  content: FileNodeContent,
): Record<string, unknown> {
  if (content.kind === 'unavailable') return data;

  data.byteSize = content.byteSize;
  data.updatedAt = new Date(content.mtimeMs).toISOString();

  if (content.kind === 'binary') {
    data.binary = true;
    delete data.fileContent;
    delete data.lineCount;
    delete data.truncated;
    if (content.mimeType) {
      data.mimeType = content.mimeType;
    } else {
      delete data.mimeType;
    }
    return data;
  }

  data.fileContent = content.text;
  data.lineCount = content.lineCount;
  delete data.binary;
  delete data.mimeType;
  if (content.truncated) {
    data.truncated = true;
  } else {
    delete data.truncated;
  }
  return data;
}
