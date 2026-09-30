import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { buildBoardExport } from '../../src/server/board-export.ts';
import { createCanvas } from '../../src/server/index.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import { executeOperation } from '../../src/server/operations/registry.ts';
import { workbenchToken } from '../../src/server/workbench-auth.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import { createTestWorkspace, makeNode, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

describe('document imports', () => {
  let workspace = '';

  function setup() {
    workspace = createTestWorkspace('pmx-import-');
    resetCanvasForTests(workspace);
    const sdk = createCanvas();
    const board = canvasState.createBoard('imports')!;
    expect(canvasState.switchBoard(board.id)).toBe(true);
    return { sdk, boardId: board.id };
  }

  afterEach(() => {
    if (!workspace) return;
    stopCanvasServer();
    canvasState.close();
    removeTestWorkspace(workspace);
    workspace = '';
  });

  test('requires bounded nonempty attachments and explicit trusted human requests', async () => {
    const { sdk, boardId } = setup();
    expect(() => sdk.attachDocument({ boardId, name: '', bytes: new Uint8Array([1]) })).toThrow();
    expect(() => sdk.attachDocument({ boardId, name: 'empty.pdf', bytes: new Uint8Array() })).toThrow();

    const attached = sdk.attachDocument({ boardId, name: 'résumé.pdf', bytes: new Uint8Array([1, 2, 3]) });
    expect(attached.import.status).toBe('attached');
    expect(canvasState.getNode(attached.nodeId)?.data.attachmentId).toBe(attached.attachment.id);
    expect(sdk.readImport(attached.import.id)?.downloadPath).toBe(
      `/api/canvas/attachments/${attached.attachment.id}/bytes`,
    );
    await expect(sdk.requestImport(attached.import.id, true, 'not-trusted')).rejects.toThrow('trusted human');
    expect((await sdk.requestImport(attached.import.id, true, workbenchToken)).status).toBe('requested');
  });

  for (const transport of ['sdk', 'http']) {
    test(`${transport} attachments avoid current cards and each other, preserving free drop positions`, async () => {
      const { sdk, boardId } = setup();
      const base = transport === 'http' ? startCanvasServer({ workspaceRoot: workspace, port: 0 }) : '';
      const obstacle = makeNode({
        id: 'intro',
        type: 'markdown',
        position: { x: -130, y: 90 },
        size: { width: 610, height: 270 },
      });
      canvasState.addNode(obstacle);
      const before = structuredClone(canvasState.getNode('intro'));
      for (const [i, point] of [
        { x: -80, y: 110 },
        { x: -80, y: 110 },
        { x: -1600, y: 650 },
        {}, // HTTP and SDK default placement must also avoid occupied space.
        {}, // Repeated coordinate-free uploads must not stack.
      ].entries()) {
        let nodeId: string;
        let jobId: string;
        if (transport === 'sdk') {
          const result = sdk.attachDocument({
            boardId,
            name: `source-${i}.pdf`,
            bytes: new Uint8Array([i + 1]),
            ...point,
          });
          nodeId = result.nodeId;
          jobId = result.import.id;
        } else {
          const query = new URLSearchParams({
            boardId,
            name: `source-${i}.pdf`,
            ...(point.x === undefined ? {} : { x: String(point.x), y: String(point.y) }),
          });
          const response = await fetch(`${base}/api/canvas/attachments?${query}`, {
            method: 'POST',
            headers: { 'x-pmx-workbench-token': workbenchToken },
            body: new Uint8Array([i + 1]),
          });
          expect(response.status).toBe(201);
          const result = (await response.json()) as { nodeId: string; import: { id: string } };
          nodeId = result.nodeId;
          jobId = result.import.id;
        }
        const node = canvasState.getNode(nodeId)!;
        for (const other of canvasState.getLayout().nodes.filter((candidate) => candidate.id !== nodeId)) {
          expect(
            node.position.x >= other.position.x + other.size.width + 48 ||
              other.position.x >= node.position.x + node.size.width + 48 ||
              node.position.y >= other.position.y + other.size.height + 48 ||
              other.position.y >= node.position.y + node.size.height + 48,
          ).toBe(true);
        }
        if (i === 2) expect(node.position).toEqual({ x: -1600, y: 650 });
        expect(canvasState.getDocumentImport(jobId)?.position).toEqual({
          x: node.position.x,
          y: node.position.y + 400,
        });
      }
      expect(canvasState.getNode('intro')).toEqual(before);
    });
  }

  test('SDK collision placement cannot escape the agent scope fence', () => {
    const { sdk, boardId } = setup();
    canvasState.addNode(
      makeNode({ id: 'fenced', type: 'markdown', position: { x: 0, y: 0 }, size: { width: 620, height: 420 } }),
    );
    canvasState.setPolicy({ scope: { nodeIds: ['fenced'], padding: 0 } });
    const input = { boardId, name: 'source.pdf', bytes: new Uint8Array([1]) };
    expect(() => sdk.attachDocument(input)).toThrow('explicit x/y');
    expect(() => sdk.attachDocument({ ...input, x: 20, y: 30 })).toThrow('outside');
    expect(canvasState.getLayout().nodes.map((node) => node.id)).toEqual(['fenced']);
    expect(canvasState.listDocumentImports(boardId)).toEqual([]);
  });

  test('re-request creates a new attempt and rejects late cancelled drafts', async () => {
    const { sdk, boardId } = setup();
    const attached = sdk.attachDocument({ boardId, name: 'source.pdf', bytes: new Uint8Array([1]) });
    const requested = await sdk.requestImport(attached.import.id, true, workbenchToken);
    await sdk.cancelImport(requested.id, workbenchToken);
    const retried = await sdk.requestImport(requested.id, true, workbenchToken);
    expect(retried.id).not.toBe(requested.id);
    await expect(sdk.requestImport(requested.id, true, workbenchToken)).rejects.toThrow('active import attempt');
    await expect(sdk.submitImport(requested.id, [{ title: 'Late', markdown: 'ignored' }], 'converter')).rejects.toThrow(
      'cancelled',
    );
    expect((await sdk.submitImport(retried.id, [{ title: 'Good', markdown: 'body' }], 'converter')).status).toBe(
      'drafted',
    );
  });

  test('rejects empty and aggregate-oversized drafts, accepts an inactive-board draft, but will not commit it', async () => {
    const { sdk, boardId } = setup();
    const attached = sdk.attachDocument({ boardId, name: 'source.pdf', bytes: new Uint8Array([1]) });
    const requested = await sdk.requestImport(attached.import.id, true, workbenchToken);
    await expect(sdk.submitImport(requested.id, [], 'converter')).rejects.toThrow();
    await expect(
      sdk.submitImport(requested.id, [{ title: 'x', markdown: 'x'.repeat(200_000) }], 'converter'),
    ).rejects.toThrow('200,000');

    const other = canvasState.createBoard('other')!;
    expect(canvasState.switchBoard(other.id)).toBe(true);
    expect(
      (await sdk.submitImport(requested.id, [{ title: 'Captured draft', markdown: 'draft body' }], 'converter')).status,
    ).toBe('drafted');
    await expect(sdk.commitImport(requested.id, workbenchToken)).rejects.toThrow('captured source board');
    expect(canvasState.getLayout().nodes).toEqual([]);

    expect(canvasState.switchBoard(boardId)).toBe(true);
    const committed = await sdk.commitImport(requested.id, workbenchToken);
    expect(canvasState.getNode(committed.nodeIds[0]!)?.data).toMatchObject({
      title: 'Captured draft',
      content: 'draft body',
    });
  });

  test('commit persists node ids and is not repeatable', async () => {
    const { sdk, boardId } = setup();
    const attached = sdk.attachDocument({ boardId, name: 'source.pdf', bytes: new Uint8Array([1]) });
    const requested = await sdk.requestImport(attached.import.id, true, workbenchToken);
    await sdk.submitImport(requested.id, [{ title: 'A', markdown: 'body' }], 'converter');
    const committed = await sdk.commitImport(requested.id, workbenchToken);
    expect(committed.import.committedNodeIds).toEqual(committed.nodeIds);
    expect(committed.import.sections).toEqual([{ title: 'A', markdown: 'body' }]);
    expect(committed.import.agentDescription).toBe('converter');
    expect(canvasState.getNode(committed.nodeIds[0]!)?.data.source).toMatchObject({
      attachmentId: attached.attachment.id,
    });
    await expect(sdk.commitImport(requested.id, workbenchToken)).rejects.toThrow('committed');
  });

  test('successive import grids avoid existing cards without moving them', async () => {
    const { sdk, boardId } = setup();
    for (const count of [5, 3]) {
      const attached = sdk.attachDocument({
        boardId,
        name: `slides-${count}.pdf`,
        bytes: new Uint8Array([count]),
        x: 90,
        y: 130,
      });
      await sdk.requestImport(attached.import.id, true, workbenchToken);
      await sdk.submitImport(
        attached.import.id,
        Array.from({ length: count }, (_, index) => ({ title: `Slide ${index}`, markdown: 'body' })),
        'fixture',
      );
      // An obstacle added after drafting catches placement based on stale drop-time geometry.
      canvasState.addNode(
        makeNode({
          id: `obstacle-${count}`,
          type: 'markdown',
          position: { x: 570, y: 900 },
          size: { width: 530, height: 370 },
        }),
      );
      const before = structuredClone(canvasState.getLayout().nodes);
      const committed = await sdk.commitImport(attached.import.id, workbenchToken);
      const cards = committed.nodeIds.map((id) => canvasState.getNode(id)!);
      const group = canvasState
        .getLayout()
        .nodes.find((node) => node.type === 'group' && node.data.title === `slides-${count}.pdf`)!;
      expect(group).toBeDefined();
      expect(group.data.children).toEqual(committed.nodeIds);
      for (const other of before) {
        expect(
          group.position.x >= other.position.x + other.size.width + 40 ||
            other.position.x >= group.position.x + group.size.width + 40 ||
            group.position.y >= other.position.y + other.size.height + 40 ||
            other.position.y >= group.position.y + group.size.height + 40,
        ).toBe(true);
      }
      for (const [index, card] of cards.entries()) {
        for (const other of [...before, ...cards.slice(0, index)]) {
          expect(
            card.position.x >= other.position.x + other.size.width + 40 ||
              other.position.x >= card.position.x + card.size.width + 40 ||
              card.position.y >= other.position.y + other.size.height + 40 ||
              other.position.y >= card.position.y + card.size.height + 40,
          ).toBe(true);
        }
      }
      expect(cards[1]!.position).toEqual({ x: cards[0]!.position.x + 440, y: cards[0]!.position.y });
      expect(cards[2]!.position).toEqual({ x: cards[0]!.position.x, y: cards[0]!.position.y + 340 });
      for (const node of before) expect(canvasState.getNode(node.id)).toEqual(node);
    }
  });

  test('an unobstructed import keeps its requested origin', async () => {
    const { sdk, boardId } = setup();
    const attached = sdk.attachDocument({ boardId, name: 'clear.pdf', bytes: new Uint8Array([1]), x: -250, y: 75 });
    await sdk.requestImport(attached.import.id, true, workbenchToken);
    await sdk.submitImport(attached.import.id, [{ title: 'Clear', markdown: 'body' }], 'fixture');
    canvasState.updateNode(attached.nodeId, { position: { x: -250, y: 55 } });
    const committed = await sdk.commitImport(attached.import.id, workbenchToken);
    expect(canvasState.getNode(committed.nodeIds[0]!)!.position).toEqual({ x: -250, y: 475 });
    expect(canvasState.getLayout().nodes.some((node) => node.type === 'group')).toBe(false);
  });

  test('agent request API cannot claim human authority', async () => {
    const { sdk, boardId } = setup();
    const attached = sdk.attachDocument({ boardId, name: 'source.pdf', bytes: new Uint8Array([1]) });
    await expect(
      executeOperation('import.request', { id: attached.import.id, consent: true }, { source: 'sdk' }),
    ).rejects.toMatchObject({ status: 403, message: 'This action requires the human in the workbench.' });
  });

  test('source bytes survive a database restart and snapshot restore', async () => {
    const { sdk, boardId } = setup();
    const sourceBytes = new Uint8Array([0, 255, 17, 3, 240, 65, 0, 128]);
    const attached = sdk.attachDocument({ boardId, name: 'asymmetric-source.bin', bytes: sourceBytes });
    const requested = await sdk.requestImport(attached.import.id, true, workbenchToken);
    await sdk.submitImport(requested.id, [{ title: 'Known title', markdown: 'KNOWN_DERIVED_TEXT_91' }], 'converter');
    const committed = await sdk.commitImport(requested.id, workbenchToken);
    const snapshot = sdk.saveSnapshot('import with source bytes');
    expect(snapshot).not.toBeNull();

    canvasState.removeNode(committed.nodeIds[0]!);
    expect(await sdk.restoreSnapshot(snapshot!.id)).toEqual({ ok: true });
    expect(canvasState.getNode(committed.nodeIds[0]!)?.data.content).toBe('KNOWN_DERIVED_TEXT_91');
    expect(canvasState.readAttachmentBytes(attached.attachment.id)).toEqual(sourceBytes);

    canvasState.flushToDisk();
    canvasState.close();
    canvasState.setWorkspaceRoot(workspace);
    expect(canvasState.readAttachmentBytes(attached.attachment.id)).toEqual(sourceBytes);
    expect(sdk.readImport(requested.id)?.bytes).toEqual(sourceBytes);
    expect(canvasState.switchBoard(boardId)).toBe(true);
    expect(canvasState.getNode(committed.nodeIds[0]!)?.data.content).toBe('KNOWN_DERIVED_TEXT_91');
  });

  test('board copies own only selected attachments, remap protected provenance, and deduplicate byte storage', async () => {
    const { sdk, boardId } = setup();
    const sharedBytes = new Uint8Array([222, 1, 199, 4, 0, 77]);
    const selected = sdk.attachDocument({ boardId, name: 'selected.secret', bytes: sharedBytes });
    const unselected = sdk.attachDocument({ boardId, name: 'unselected.secret', bytes: sharedBytes });
    const requested = await sdk.requestImport(selected.import.id, true, workbenchToken);
    await sdk.submitImport(
      requested.id,
      [{ title: 'Selected derived title', markdown: 'SELECTED_DERIVED_BODY', reference: 'page 7' }],
      'converter',
    );
    const committed = await sdk.commitImport(requested.id, workbenchToken);

    const copy = canvasState.createBoardFromBoard({
      sourceBoardId: boardId,
      name: 'selected import copy',
      nodeIds: committed.nodeIds,
    })!;
    const copiedRead = canvasState.readBoard(copy.id, true)!;
    const copiedCard = copiedRead.layout.nodes.find((node) => node.data.content === 'SELECTED_DERIVED_BODY')!;
    const copiedSource = copiedCard.data.source as { attachmentId: string; filename: string; reference: string };
    expect(copiedSource).toEqual({
      attachmentId: expect.any(String),
      filename: 'selected.secret',
      reference: 'page 7',
    });
    expect(copiedSource.attachmentId).not.toBe(selected.attachment.id);
    expect(canvasState.getAttachment(copiedSource.attachmentId)?.boardId).toBe(copy.id);
    expect(canvasState.readAttachmentBytes(copiedSource.attachmentId)).toEqual(sharedBytes);
    expect(canvasState.listDocumentImports(copy.id).map((job) => job.attachmentId)).toEqual([]);

    const db = new Database(canvasState.databasePath!, { readonly: true });
    try {
      expect(db.query<{ count: number }, []>('SELECT count(*) AS count FROM attachment_bytes').get()?.count).toBe(1);
      expect(
        db
          .query<{ name: string }, [string]>('SELECT name FROM attachments WHERE board_id=? ORDER BY name')
          .all(copy.id),
      ).toEqual([{ name: 'selected.secret' }]);
    } finally {
      db.close();
    }
    expect(canvasState.getAttachment(unselected.attachment.id)?.boardId).toBe(boardId);

    expect(canvasState.switchBoard(copy.id)).toBe(true);
    await expect(
      executeOperation(
        'node.update',
        { id: copiedCard.id, data: { source: { attachmentId: 'forged' } } },
        { source: 'sdk' },
      ),
    ).rejects.toThrow('provenance');
    await expect(
      executeOperation('node.update', { id: copiedCard.id, type: 'file' }, { source: 'sdk' }),
    ).rejects.toThrow('type is immutable');
  });

  test('deleting a source board retains bytes owned by its copy and garbage-collects them after the last owner', async () => {
    const { sdk, boardId } = setup();
    const sourceBytes = new Uint8Array([9, 0, 201, 88, 7]);
    const attached = sdk.attachDocument({ boardId, name: 'retained.dat', bytes: sourceBytes });
    canvasState.addNode(
      makeNode({
        id: 'attachment-card',
        type: 'file',
        data: { title: 'retained.dat', attachmentId: attached.attachment.id },
      }),
    );
    canvasState.flushToDisk();
    const copy = canvasState.createBoardFromBoard({
      sourceBoardId: boardId,
      name: 'owner copy',
      nodeIds: ['attachment-card'],
    })!;
    const copiedAttachmentId = canvasState.readBoard(copy.id, true)!.layout.nodes.find((node) => node.type === 'file')!
      .data.attachmentId as string;

    expect(canvasState.deleteBoard(boardId)).toBe(true);
    expect(canvasState.readAttachmentBytes(attached.attachment.id)).toBeNull();
    expect(canvasState.readAttachmentBytes(copiedAttachmentId)).toEqual(sourceBytes);
    expect(canvasState.deleteBoard(copy.id)).toBe(true);

    const db = new Database(canvasState.databasePath!, { readonly: true });
    try {
      expect(db.query<{ count: number }, []>('SELECT count(*) AS count FROM attachment_bytes').get()?.count).toBe(0);
    } finally {
      db.close();
    }
  });

  test('content edits preserve import provenance while source, path, and type mutations are rejected', async () => {
    const { sdk, boardId } = setup();
    const attached = sdk.attachDocument({ boardId, name: 'locked.pdf', bytes: new Uint8Array([71, 2, 99]) });
    const requested = await sdk.requestImport(attached.import.id, true, workbenchToken);
    await sdk.submitImport(requested.id, [{ title: 'Original title', markdown: 'ORIGINAL_SECRET_TEXT' }], 'converter');
    const { nodeIds } = await sdk.commitImport(requested.id, workbenchToken);
    const id = nodeIds[0]!;
    const source = structuredClone(canvasState.getNode(id)!.data.source);

    await executeOperation(
      'node.update',
      { id, title: 'Edited title', content: 'SAFE_EDITED_TEXT' },
      { source: 'sdk' },
    );
    expect(canvasState.getNode(id)?.data).toMatchObject({ title: 'Edited title', content: 'SAFE_EDITED_TEXT', source });
    await expect(
      executeOperation(
        'node.update',
        { id, data: { source: { attachmentId: attached.attachment.id } } },
        { source: 'sdk' },
      ),
    ).rejects.toThrow('provenance');
    await expect(executeOperation('node.update', { id, path: 'other.pdf' }, { source: 'sdk' })).rejects.toThrow('path');
    await expect(executeOperation('node.update', { id, type: 'file' }, { source: 'sdk' })).rejects.toThrow(
      'type is immutable',
    );
    expect(canvasState.getNode(id)?.data.source).toEqual(source);
  });

  test('exports redact imported title and text by default and never include original bytes', async () => {
    const { sdk, boardId } = setup();
    const byteSecret = 'ORIGINAL_BYTES_SECRET_4f8c';
    const attached = sdk.attachDocument({
      boardId,
      name: 'private-source.bin',
      bytes: new TextEncoder().encode(byteSecret),
    });
    const requested = await sdk.requestImport(attached.import.id, true, workbenchToken);
    await sdk.submitImport(
      requested.id,
      [{ title: 'IMPORTED_SECRET_TITLE_6a', markdown: 'IMPORTED_SECRET_TEXT_7b' }],
      'converter',
    );
    await sdk.commitImport(requested.id, workbenchToken);

    const redacted = await buildBoardExport(boardId, true);
    expect(redacted?.html).toContain('Imported document content');
    expect(redacted?.html).toContain('Imported document text excluded.');
    expect(redacted?.html).not.toContain('IMPORTED_SECRET_TITLE_6a');
    expect(redacted?.html).not.toContain('IMPORTED_SECRET_TEXT_7b');
    expect(redacted?.html).not.toContain(byteSecret);

    const included = await buildBoardExport(boardId, true, true);
    expect(included?.html).toContain('IMPORTED_SECRET_TITLE_6a');
    expect(included?.html).toContain('IMPORTED_SECRET_TEXT_7b');
    expect(included?.html).not.toContain(byteSecret);
    expect(included?.manifest.sourceDerivedCards).toEqual([{ nodeId: expect.any(String), included: true }]);
  });
});
