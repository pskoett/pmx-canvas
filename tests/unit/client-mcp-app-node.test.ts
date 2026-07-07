import { describe, expect, test } from 'bun:test';
import { isSameOriginFrameDocumentUrl } from '../../src/client/nodes/McpAppNode.tsx';

describe('McpAppNode same-origin frame document trust', () => {
  test('trusts PMX-served frame documents on the current origin', () => {
    expect(isSameOriginFrameDocumentUrl('/api/canvas/frame-documents/frame-1', 'http://localhost:4313/workbench')).toBe(
      true,
    );
    expect(
      isSameOriginFrameDocumentUrl('http://localhost:4313/api/canvas/frame-documents/frame-1', 'http://localhost:4313'),
    ).toBe(true);
  });

  test('does not trust external URLs or unrelated same-origin paths', () => {
    expect(
      isSameOriginFrameDocumentUrl('https://example.com/api/canvas/frame-documents/frame-1', 'http://localhost:4313'),
    ).toBe(false);
    expect(isSameOriginFrameDocumentUrl('/api/canvas/json-render/view?nodeId=node-1', 'http://localhost:4313')).toBe(
      false,
    );
  });
});
