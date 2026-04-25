import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { IMAGE_MIME_MAP } from './canvas-state.js';

const IMAGE_HEADER_BYTES = 512;
const IMAGE_HEADER_READ_TIMEOUT_MS = 5000;
// Set by `chflags hidden`, iCloud Drive, OneDrive, etc. on macOS — the
// metadata exists but the file content has not been downloaded locally.
const MACOS_DATALESS_FLAG = 0x40000000;
// Per macOS `man stat -f %Xf`, this bit is also set on iCloud Documents
// & Files for content-not-yet-downloaded entries on newer OS releases.
const MACOS_BSD_NODUMP_FLAG = 0x00000001;

function fileName(path: string): string {
  return basename(path) || path;
}

function readMacosFileFlags(path: string): number | null {
  if (process.platform !== 'darwin') return null;

  try {
    const raw = execFileSync('/usr/bin/stat', ['-f', '%Xf', path], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    }).trim();
    return raw.length > 0 ? Number.parseInt(raw, 16) : null;
  } catch {
    return null;
  }
}

function isMacosCloudPlaceholder(path: string): boolean {
  const flags = readMacosFileFlags(path);
  if (flags === null) return false;
  // Both flags can indicate iCloud-on-demand status depending on macOS
  // release; treat either as a placeholder.
  return (flags & MACOS_DATALESS_FLAG) !== 0 || (flags & MACOS_BSD_NODUMP_FLAG) !== 0;
}

function assertNotCloudPlaceholder(path: string): void {
  if (isMacosCloudPlaceholder(path)) {
    throw new Error(
      `Invalid image node: "${fileName(path)}" appears to be a cloud-on-demand placeholder. ` +
        'Ensure the file is downloaded locally before adding it as an image.',
    );
  }
}

function readHeaderWithDirectFs(path: string, size: number): Buffer {
  const length = Math.min(IMAGE_HEADER_BYTES, size);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, 'r');
  try {
    const bytesRead = readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

interface ProcessSpawnError {
  code?: string;
  signal?: NodeJS.Signals;
  status?: number;
}

function isProcessSpawnError(value: unknown): value is ProcessSpawnError {
  return value !== null && typeof value === 'object';
}

function readHeaderWithDd(path: string): Buffer {
  return execFileSync('/bin/dd', [`if=${path}`, `bs=${IMAGE_HEADER_BYTES}`, 'count=1'], {
    encoding: 'buffer',
    maxBuffer: IMAGE_HEADER_BYTES,
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: IMAGE_HEADER_READ_TIMEOUT_MS,
  });
}

function readHeaderWithTimeout(path: string, size: number): Buffer {
  // Direct fs read is the fast path on every platform — no fork, no shell,
  // no timeout required because the kernel either returns bytes immediately
  // or fails synchronously. The `dd` escape hatch only matters for macOS
  // cloud-on-demand placeholders, which `assertNotCloudPlaceholder` rejected
  // at the call site, so this path is safe.
  try {
    return readHeaderWithDirectFs(path, size);
  } catch (directError) {
    // On macOS, fall through to `/bin/dd` so a kernel-level stall on a path
    // we did not flag as a placeholder (e.g. an unmounted SMB share that
    // still satisfies `existsSync`) cannot wedge a Bun fiber.
    if (process.platform !== 'darwin' || !existsSync('/bin/dd')) {
      throw directError;
    }
    try {
      return readHeaderWithDd(path);
    } catch (ddError) {
      const reason = isProcessSpawnError(ddError) ? ddError : null;
      const timedOut = reason?.signal === 'SIGTERM' || reason?.code === 'ETIMEDOUT';
      if (timedOut) {
        throw new Error(
          `Invalid image node: could not read image header for "${fileName(path)}" within ${IMAGE_HEADER_READ_TIMEOUT_MS}ms. ` +
            'If this file is stored in OneDrive, iCloud Drive, or another cloud-on-demand provider, download it locally first.',
        );
      }
      const detail = ddError instanceof Error ? ddError.message : String(ddError);
      throw new Error(
        `Invalid image node: could not read "${fileName(path)}" — ${detail}.`,
      );
    }
  }
}

function hasAscii(buffer: Buffer, offset: number, value: string): boolean {
  return buffer.subarray(offset, offset + value.length).toString('ascii') === value;
}

function detectImageMimeType(header: Buffer): string | null {
  if (
    header.length >= 8 &&
    header[0] === 0x89 &&
    hasAscii(header, 1, 'PNG') &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return 'image/jpeg';
  }

  if (header.length >= 6 && (hasAscii(header, 0, 'GIF87a') || hasAscii(header, 0, 'GIF89a'))) {
    return 'image/gif';
  }

  if (header.length >= 12 && hasAscii(header, 0, 'RIFF') && hasAscii(header, 8, 'WEBP')) {
    return 'image/webp';
  }

  if (header.length >= 2 && hasAscii(header, 0, 'BM')) {
    return 'image/bmp';
  }

  if (
    header.length >= 4 &&
    header[0] === 0x00 &&
    header[1] === 0x00 &&
    (header[2] === 0x01 || header[2] === 0x02) &&
    header[3] === 0x00
  ) {
    return 'image/x-icon';
  }

  if (header.length >= 12 && hasAscii(header, 4, 'ftyp')) {
    const brandArea = header.subarray(8, Math.min(header.length, 32)).toString('ascii');
    if (brandArea.includes('avif') || brandArea.includes('avis')) return 'image/avif';
  }

  const text = header.toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) {
    return 'image/svg+xml';
  }

  return null;
}

export function validateLocalImageFile(path: string): { mimeType: string } {
  const name = fileName(path);
  if (!existsSync(path)) {
    throw new Error(`Invalid image node: "${name}" does not exist.`);
  }

  const stat = statSync(path);
  if (!stat.isFile()) {
    throw new Error(`Invalid image node: "${name}" is not a regular file.`);
  }
  if (stat.size <= 0) {
    throw new Error(`Invalid image node: "${name}" is empty.`);
  }

  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (!IMAGE_MIME_MAP[ext]) {
    throw new Error(
      `Invalid image node: "${name}" has unsupported extension ".${ext}". ` +
        `Accepted: ${Object.keys(IMAGE_MIME_MAP).join(', ')}. ` +
        'For non-image files use type="file" (live viewer) or type="webpage" (URL) instead.',
    );
  }

  assertNotCloudPlaceholder(path);
  const header = readHeaderWithTimeout(path, stat.size);
  const mimeType = detectImageMimeType(header);
  if (!mimeType) {
    throw new Error(
      `Invalid image node: "${name}" is not a recognized image file. ` +
        'Expected PNG, JPEG, GIF, SVG, WebP, BMP, ICO, or AVIF image bytes.',
    );
  }

  return { mimeType };
}
