import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_FILE_TEXT_BYTES, readFileNodeContent } from '../../src/server/file-content.ts';

describe('readFileNodeContent', () => {
  let root = '';

  function workspaceFile(name: string, contents: string | Buffer): string {
    if (!root) root = mkdtempSync(join(tmpdir(), 'pmx-canvas-file-content-'));
    const path = join(root, name);
    writeFileSync(path, contents);
    return path;
  }

  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = '';
    }
  });

  test('reads a plain text file whole', () => {
    const path = workspaceFile('notes.ts', 'export const a = 1;\nexport const b = 2;\n');
    const content = readFileNodeContent(path);

    expect(content.kind).toBe('text');
    if (content.kind !== 'text') return;
    expect(content.text).toBe('export const a = 1;\nexport const b = 2;\n');
    expect(content.lineCount).toBe(3);
    expect(content.byteSize).toBe(40);
    expect(content.truncated).toBe(false);
    expect(typeof content.mtimeMs).toBe('number');
  });

  test('classifies a file with NUL bytes as binary and never decodes it', () => {
    const path = workspaceFile('blob.bin', Buffer.from([0x89, 0x50, 0x00, 0x4e, 0x47, 0x00, 0x0d]));
    const content = readFileNodeContent(path);

    expect(content.kind).toBe('binary');
    if (content.kind !== 'binary') return;
    expect(content.byteSize).toBe(7);
    expect(content.mimeType).toBeUndefined();
    expect(content).not.toHaveProperty('text');
  });

  test('detects a PDF by magic bytes even without NUL bytes in the header', () => {
    const path = workspaceFile('report.pdf', '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n');
    const content = readFileNodeContent(path);

    expect(content.kind).toBe('binary');
    if (content.kind !== 'binary') return;
    expect(content.mimeType).toBe('application/pdf');
  });

  test('treats a .pdf extension as a secondary PDF signal', () => {
    const path = workspaceFile('no-magic.pdf', Buffer.from([0x00, 0x01, 0x02, 0x03]));
    const content = readFileNodeContent(path);

    expect(content.kind).toBe('binary');
    if (content.kind !== 'binary') return;
    expect(content.mimeType).toBe('application/pdf');
  });

  test('truncates over-cap text at the byte cap without splitting a character', () => {
    // "é" is two UTF-8 bytes, so an odd-length prefix of this padding lands the
    // cap mid-sequence — the reader must drop the partial byte, not emit U+FFFD.
    const filler = 'é'.repeat(MAX_FILE_TEXT_BYTES);
    const path = workspaceFile('huge.txt', `x${filler}`);
    const content = readFileNodeContent(path);

    expect(content.kind).toBe('text');
    if (content.kind !== 'text') return;
    expect(content.truncated).toBe(true);
    expect(content.byteSize).toBeGreaterThan(MAX_FILE_TEXT_BYTES);
    expect(Buffer.byteLength(content.text, 'utf-8')).toBeLessThanOrEqual(MAX_FILE_TEXT_BYTES);
    expect(content.text.includes('�')).toBe(false);
    expect(content.text.endsWith('é')).toBe(true);
  });

  test('does not mark an at-cap text file truncated', () => {
    const path = workspaceFile('at-cap.txt', 'a'.repeat(MAX_FILE_TEXT_BYTES));
    const content = readFileNodeContent(path);

    expect(content.kind).toBe('text');
    if (content.kind !== 'text') return;
    expect(content.truncated).toBe(false);
    expect(content.text.length).toBe(MAX_FILE_TEXT_BYTES);
  });

  test('reports missing and non-file paths as unavailable instead of throwing', () => {
    const path = workspaceFile('present.txt', 'here');
    expect(readFileNodeContent(join(root, 'nope.txt')).kind).toBe('unavailable');
    expect(readFileNodeContent(root).kind).toBe('unavailable');
    expect(readFileNodeContent(path).kind).toBe('text');
  });
});
