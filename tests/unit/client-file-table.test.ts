import { describe, expect, test } from 'bun:test';
import { formatBytes, parseDelimitedText } from '../../src/client/nodes/FileNode.tsx';

// The delimited parser backs the `file` node's CSV/TSV table view. It must stay
// RFC4180-ish (quotes, escapes, embedded newlines) and never throw on ragged
// real-world exports.

describe('parseDelimitedText', () => {
  test('parses a header and rows with LF endings', () => {
    const table = parseDelimitedText('name,age\nada,36\ngrace,45\n', ',');
    expect(table.header).toEqual(['name', 'age']);
    expect(table.rows).toEqual([
      ['ada', '36'],
      ['grace', '45'],
    ]);
  });

  test('a trailing newline produces no phantom empty row', () => {
    expect(parseDelimitedText('a,b\n1,2\n', ',').rows).toHaveLength(1);
    expect(parseDelimitedText('a,b\n1,2', ',').rows).toHaveLength(1);
  });

  test('quoted fields keep the delimiter', () => {
    const table = parseDelimitedText('name,note\n"Doe, Jane",hi\n', ',');
    expect(table.rows[0]).toEqual(['Doe, Jane', 'hi']);
  });

  test('quoted fields keep embedded newlines', () => {
    const table = parseDelimitedText('a,b\n"line1\nline2",tail\n', ',');
    expect(table.rows).toEqual([['line1\nline2', 'tail']]);
  });

  test('escaped double quotes collapse to one quote', () => {
    const table = parseDelimitedText('a,b\n"say ""hi""",2\n', ',');
    expect(table.rows[0]).toEqual(['say "hi"', '2']);
  });

  test('handles CRLF line endings, including inside quoted fields', () => {
    const table = parseDelimitedText('a,b\r\n1,2\r\n"x\r\ny",4\r\n', ',');
    expect(table.header).toEqual(['a', 'b']);
    expect(table.rows).toEqual([
      ['1', '2'],
      ['x\ny', '4'],
    ]);
  });

  test('squares off ragged rows against the header width', () => {
    const table = parseDelimitedText('a,b,c\n1\n1,2,3,4,5\n', ',');
    expect(table.rows).toEqual([
      ['1', '', ''],
      ['1', '2', '3'],
    ]);
  });

  test('parses TSV with a tab delimiter (commas stay in the cell)', () => {
    const table = parseDelimitedText('name\tcity\nada\tLondon, UK\n', '\t');
    expect(table.header).toEqual(['name', 'city']);
    expect(table.rows).toEqual([['ada', 'London, UK']]);
  });

  test('degenerate single-column input yields one column', () => {
    const table = parseDelimitedText('just some prose\nanother line\n', ',');
    expect(table.header).toEqual(['just some prose']);
    expect(table.rows).toEqual([['another line']]);
  });

  test('empty input yields no header and no rows', () => {
    expect(parseDelimitedText('', ',')).toEqual({ header: [], rows: [] });
  });

  test('an empty quoted field is still a record', () => {
    expect(parseDelimitedText('a,b\n"",2\n', ',').rows).toEqual([['', '2']]);
  });
});

describe('formatBytes', () => {
  test('formats bytes, KB and MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(4.2 * 1024 * 1024)).toBe('4.2 MB');
    expect(formatBytes(64 * 1024 * 1024)).toBe('64 MB');
  });
});
