import { describe, expect, test } from 'bun:test';
import {
  EXCALIDRAW_CREATE_VIEW_TOOL,
  EXCALIDRAW_MCP_TRANSPORT,
  EXCALIDRAW_MCP_URL,
  EXCALIDRAW_SERVER_NAME,
  buildExcalidrawCheckpointId,
  buildExcalidrawOpenMcpAppInput,
  buildExcalidrawRestoreCheckpointToolInput,
  ensureExcalidrawCheckpointId,
  inferExcalidrawCameraUpdate,
  normalizeExcalidrawCheckpointDataForToolInput,
  normalizeExcalidrawElements,
  normalizeExcalidrawElementsForToolInput,
} from '../../src/server/diagram-presets.ts';

describe('diagram-presets', () => {
  test('normalizeExcalidrawElements accepts an array and returns a compact JSON string', () => {
    const result = normalizeExcalidrawElements([{ type: 'rectangle', id: 'r1', x: 0, y: 0, width: 10, height: 10 }]);
    expect(result).toBe('[{"type":"rectangle","id":"r1","x":0,"y":0,"width":10,"height":10}]');
  });

  test('normalizeExcalidrawElements accepts a JSON string and canonicalizes it', () => {
    const result = normalizeExcalidrawElements(
      '[\n  { "type": "ellipse", "id": "e1", "x": 0, "y": 0, "width": 10, "height": 10 }\n]',
    );
    expect(JSON.parse(result)).toEqual([{ type: 'ellipse', id: 'e1', x: 0, y: 0, width: 10, height: 10 }]);
  });

  test('normalizeExcalidrawElements seeds empty arrays so the hosted editor can open', () => {
    expect(JSON.parse(normalizeExcalidrawElements([]))).toEqual([
      expect.objectContaining({
        type: 'rectangle',
        id: 'pmx-start',
        label: { text: 'PMX Canvas', fontSize: 24 },
      }),
    ]);
    expect(JSON.parse(normalizeExcalidrawElements('[]'))).toEqual([
      expect.objectContaining({
        type: 'rectangle',
        id: 'pmx-start',
        label: { text: 'PMX Canvas', fontSize: 24 },
      }),
    ]);
  });

  test('normalizeExcalidrawElements preserves shorthand labels for Excalidraw conversion', () => {
    const result = JSON.parse(
      normalizeExcalidrawElements([
        {
          type: 'rectangle',
          id: 'box',
          x: 10,
          y: 20,
          width: 220,
          height: 100,
          label: { text: 'Inside box', fontSize: 24 },
        },
      ]),
    );
    expect(result[0]).toMatchObject({
      type: 'rectangle',
      id: 'box',
      label: { text: 'Inside box', fontSize: 24 },
    });
    expect(result[0].boundElements).toBeUndefined();
    expect(result).toHaveLength(1);
  });

  test('normalizeExcalidrawElementsForToolInput adds a camera update for visible content', () => {
    const result = JSON.parse(
      normalizeExcalidrawElementsForToolInput([
        { type: 'rectangle', id: 'r1', x: 1000, y: 800, width: 120, height: 80 },
      ]),
    );
    expect(result[0]).toMatchObject({ type: 'cameraUpdate' });
    expect(result[0].width / result[0].height).toBeCloseTo(4 / 3, 2);
    expect(result[1]).toMatchObject({ type: 'rectangle', id: 'r1' });
  });

  test('normalizeExcalidrawElementsForToolInput converts bound text into hosted-app labels', () => {
    const result = JSON.parse(
      normalizeExcalidrawElementsForToolInput([
        {
          type: 'rectangle',
          id: 'box',
          x: 10,
          y: 20,
          width: 220,
          height: 100,
          boundElements: [],
        },
        {
          type: 'text',
          id: 'box-label',
          x: 24,
          y: 52,
          width: 180,
          height: 24,
          text: 'Bound label',
          containerId: 'box',
        },
      ]),
    );

    const box = result.find((element: Record<string, unknown>) => element.id === 'box');
    const label = result.find((element: Record<string, unknown>) => element.id === 'box-label');
    expect(box).toMatchObject({
      label: { text: 'Bound label' },
    });
    expect(box.boundElements).toBeUndefined();
    expect(label).toBeUndefined();
  });

  test('normalizeExcalidrawElementsForToolInput converts canonical centered container text into labels', () => {
    const result = JSON.parse(
      normalizeExcalidrawElementsForToolInput([
        {
          type: 'rectangle',
          id: 'r1',
          x: 200,
          y: 200,
          width: 240,
          height: 100,
          boundElements: [{ type: 'text', id: 't1' }],
        },
        {
          type: 'text',
          id: 't1',
          x: 200,
          y: 200,
          width: 240,
          height: 100,
          text: 'Centered?',
          fontSize: 20,
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: 'r1',
        },
      ]),
    );

    const box = result.find((element: Record<string, unknown>) => element.id === 'r1');
    const label = result.find((element: Record<string, unknown>) => element.id === 't1');
    expect(box).toMatchObject({
      label: {
        text: 'Centered?',
        fontSize: 20,
        textAlign: 'center',
        verticalAlign: 'middle',
      },
    });
    expect(box.boundElements).toBeUndefined();
    expect(label).toBeUndefined();
  });

  test('normalizeExcalidrawElementsForToolInput preserves shorthand labels for hosted-app conversion', () => {
    const result = JSON.parse(
      normalizeExcalidrawElementsForToolInput([
        {
          type: 'rectangle',
          id: 'box',
          x: 100,
          y: 80,
          width: 220,
          height: 90,
          label: { text: 'Shorthand label', fontSize: 18 },
        },
      ]),
    );

    const box = result.find((element: Record<string, unknown>) => element.id === 'box');
    const label = result.find((element: Record<string, unknown>) => element.id === 'box-label');
    expect(box).toMatchObject({
      label: { text: 'Shorthand label', fontSize: 18 },
    });
    expect(box.boundElements).toBeUndefined();
    expect(label).toBeUndefined();
  });

  test('normalizeExcalidrawElementsForToolInput converts one-sided bound text into a hosted-app label', () => {
    const result = JSON.parse(
      normalizeExcalidrawElementsForToolInput([
        {
          type: 'rectangle',
          id: 'box',
          x: 10,
          y: 20,
          width: 220,
          height: 100,
        },
        {
          type: 'text',
          id: 'box-label',
          x: 24,
          y: 52,
          width: 180,
          height: 24,
          text: 'One-sided label',
          containerId: 'box',
        },
      ]),
    );

    const box = result.find((element: Record<string, unknown>) => element.id === 'box');
    const label = result.find((element: Record<string, unknown>) => element.id === 'box-label');
    expect(box).toMatchObject({ label: { text: 'One-sided label' } });
    expect(box.boundElements).toBeUndefined();
    expect(label).toBeUndefined();
  });

  test('normalizeExcalidrawElementsForToolInput converts boundElements-only text into a hosted-app label', () => {
    const result = JSON.parse(
      normalizeExcalidrawElementsForToolInput([
        {
          type: 'rectangle',
          id: 'box',
          x: 10,
          y: 20,
          width: 220,
          height: 100,
          boundElements: [{ type: 'text', id: 'box-label' }],
        },
        {
          type: 'text',
          id: 'box-label',
          x: 24,
          y: 52,
          width: 180,
          height: 24,
          text: 'Reverse-only label',
        },
      ]),
    );

    const box = result.find((element: Record<string, unknown>) => element.id === 'box');
    const label = result.find((element: Record<string, unknown>) => element.id === 'box-label');
    expect(box).toMatchObject({ label: { text: 'Reverse-only label' } });
    expect(box.boundElements).toBeUndefined();
    expect(label).toBeUndefined();
  });

  test('normalizeExcalidrawElementsForToolInput seeds defaults for non-renderable arrays', () => {
    const result = JSON.parse(
      normalizeExcalidrawElementsForToolInput([
        { type: 'cameraUpdate', x: 0, y: 0, width: 400, height: 300 },
        { type: 'delete', ids: 'missing' },
        { id: 'shape-without-type', x: 20, y: 20 },
        { type: 'text', id: 'empty-text', text: '   ' },
      ]),
    );

    expect(result[0]).toMatchObject({ type: 'cameraUpdate' });
    expect(result[1]).toMatchObject({ type: 'rectangle', id: 'pmx-start' });
  });

  test('inferExcalidrawCameraUpdate accounts for point-based elements', () => {
    const camera = inferExcalidrawCameraUpdate([
      {
        type: 'line',
        id: 'l1',
        x: 50,
        y: 70,
        points: [
          [0, 0],
          [140, 90],
        ],
      },
    ]);
    expect(camera).toMatchObject({ type: 'cameraUpdate' });
    expect(camera?.width).toBeGreaterThanOrEqual(320);
    expect(camera?.height).toBeGreaterThanOrEqual(240);
    expect((camera?.width as number) / (camera?.height as number)).toBeCloseTo(4 / 3, 2);
  });

  test('normalizeExcalidrawCheckpointDataForToolInput extracts saved elements and camera', () => {
    const result = normalizeExcalidrawCheckpointDataForToolInput(
      JSON.stringify({
        elements: [{ type: 'ellipse', id: 'saved', x: 10, y: 20, width: 30, height: 40 }],
      }),
    );
    const parsed = result ? JSON.parse(result) : [];
    expect(parsed[0]).toMatchObject({ type: 'cameraUpdate' });
    expect(parsed[1]).toMatchObject({ type: 'ellipse', id: 'saved' });
  });

  test('buildExcalidrawRestoreCheckpointToolInput reopens the exact saved Excalidraw scene', () => {
    expect(JSON.parse(buildExcalidrawRestoreCheckpointToolInput('checkpoint-1'))).toEqual([
      { type: 'restoreCheckpoint', id: 'checkpoint-1' },
    ]);
  });

  test('buildExcalidrawRestoreCheckpointToolInput includes a 4:3 camera for saved elements', () => {
    const result = JSON.parse(
      buildExcalidrawRestoreCheckpointToolInput(
        'checkpoint-1',
        JSON.stringify({
          elements: [{ type: 'diamond', id: 'edited', x: -140, y: -150, width: 740, height: 660 }],
        }),
      ),
    );
    expect(result[0]).toEqual({ type: 'restoreCheckpoint', id: 'checkpoint-1' });
    expect(result[1]).toMatchObject({ type: 'cameraUpdate' });
    expect(result[1].width / result[1].height).toBeCloseTo(4 / 3, 2);
  });

  test('checkpoint IDs are stable and injected into tool results', () => {
    expect(buildExcalidrawCheckpointId('node id!*')).toBe('pmx-node-id');
    expect(ensureExcalidrawCheckpointId({ content: [] }, 'node id!*')).toMatchObject({
      structuredContent: { checkpointId: 'pmx-node-id' },
    });
    expect(
      ensureExcalidrawCheckpointId({ content: [], structuredContent: { checkpointId: 'existing' } }, 'ignored'),
    ).toMatchObject({ structuredContent: { checkpointId: 'existing' } });
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

  test('buildExcalidrawOpenMcpAppInput normalizes MCP diagram elements through the shared repair path', () => {
    const built = buildExcalidrawOpenMcpAppInput({
      elements: [
        { type: 'cameraUpdate', x: 0, y: 0, width: 400, height: 300 },
        { type: 'delete', ids: 'nothing-visible' },
      ],
    });

    const elements = JSON.parse(built.toolArguments.elements);
    expect(elements[0]).toMatchObject({ type: 'cameraUpdate' });
    expect(elements[1]).toMatchObject({ type: 'rectangle', id: 'pmx-start' });
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
