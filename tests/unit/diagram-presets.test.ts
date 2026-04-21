import { describe, expect, test } from 'bun:test';
import {
  EXCALIDRAW_CREATE_VIEW_TOOL,
  EXCALIDRAW_MCP_TRANSPORT,
  EXCALIDRAW_MCP_URL,
  EXCALIDRAW_SERVER_NAME,
  buildExcalidrawOpenMcpAppInput,
  normalizeExcalidrawElements,
} from '../../src/server/diagram-presets.ts';

describe('diagram-presets', () => {
  test('normalizeExcalidrawElements accepts an array and returns a compact JSON string', () => {
    const result = normalizeExcalidrawElements([
      { type: 'rectangle', id: 'r1', x: 0, y: 0, width: 10, height: 10 },
    ]);
    expect(result).toBe('[{"type":"rectangle","id":"r1","x":0,"y":0,"width":10,"height":10}]');
  });

  test('normalizeExcalidrawElements accepts a JSON string and canonicalizes it', () => {
    const result = normalizeExcalidrawElements('[\n  { "type": "ellipse", "id": "e1", "x": 0, "y": 0, "width": 10, "height": 10 }\n]');
    expect(JSON.parse(result)).toEqual([
      { type: 'ellipse', id: 'e1', x: 0, y: 0, width: 10, height: 10 },
    ]);
  });

  test('normalizeExcalidrawElements rejects empty strings', () => {
    expect(() => normalizeExcalidrawElements('')).toThrow(/non-empty/);
    expect(() => normalizeExcalidrawElements('   ')).toThrow(/non-empty/);
  });

  test('normalizeExcalidrawElements rejects invalid JSON', () => {
    expect(() => normalizeExcalidrawElements('[not json')).toThrow(/not valid JSON/);
  });

  test('normalizeExcalidrawElements rejects non-array JSON', () => {
    expect(() => normalizeExcalidrawElements('{"type":"rectangle"}')).toThrow(/JSON array/);
  });

  test('normalizeExcalidrawElements rejects non-array values', () => {
    expect(() => normalizeExcalidrawElements(42 as unknown)).toThrow(/array/);
    expect(() => normalizeExcalidrawElements(null as unknown)).toThrow(/array/);
    expect(() => normalizeExcalidrawElements(undefined as unknown)).toThrow(/array/);
  });

  test('buildExcalidrawOpenMcpAppInput wires transport + tool + server name', () => {
    const built = buildExcalidrawOpenMcpAppInput({
      elements: [{ type: 'rectangle', id: 'r', x: 0, y: 0, width: 1, height: 1 }],
    });
    expect(built.transport).toEqual(EXCALIDRAW_MCP_TRANSPORT);
    expect(built.transport.type).toBe('http');
    expect(built.toolName).toBe(EXCALIDRAW_CREATE_VIEW_TOOL);
    expect(built.serverName).toBe(EXCALIDRAW_SERVER_NAME);
    expect(EXCALIDRAW_MCP_URL).toBe('https://mcp.excalidraw.com/mcp');
    expect(built.toolArguments.elements).toContain('"type":"rectangle"');
    expect(built.title).toBeUndefined();
  });

  test('buildExcalidrawOpenMcpAppInput forwards geometry and title when provided', () => {
    const built = buildExcalidrawOpenMcpAppInput({
      elements: [{ type: 'ellipse', id: 'e', x: 0, y: 0, width: 1, height: 1 }],
      title: '  My diagram  ',
      x: 100,
      y: 200,
      width: 640,
      height: 480,
    });
    expect(built.title).toBe('My diagram');
    expect(built.x).toBe(100);
    expect(built.y).toBe(200);
    expect(built.width).toBe(640);
    expect(built.height).toBe(480);
  });

  test('buildExcalidrawOpenMcpAppInput drops empty title + non-finite geometry', () => {
    const built = buildExcalidrawOpenMcpAppInput({
      elements: [{ type: 'ellipse', id: 'e', x: 0, y: 0, width: 1, height: 1 }],
      title: '   ',
      x: Number.NaN,
      width: Number.POSITIVE_INFINITY,
    });
    expect(built.title).toBeUndefined();
    expect(built.x).toBeUndefined();
    expect(built.width).toBeUndefined();
  });
});
