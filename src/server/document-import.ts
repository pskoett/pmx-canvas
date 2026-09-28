import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_INLINE_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENT_NAME_LENGTH = 255;
export const MAX_IMPORT_SECTIONS = 32;
export const MAX_IMPORT_WARNINGS = 20;
export const MAX_IMPORT_TEXT = 200_000;
export const MAX_IMPORT_TITLE_LENGTH = 500;
export const MAX_IMPORT_REFERENCE_LENGTH = 2_000;
export const MAX_IMPORT_WARNING_LENGTH = 2_000;
export const MAX_IMPORT_AGENT_DESCRIPTION_LENGTH = 4_000;
export const MAX_IMPORT_REASON_LENGTH = 4_000;

export interface Attachment {
  id: string;
  boardId: string;
  sha256: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}

export interface ImportSection {
  title: string;
  markdown: string;
  reference?: string;
}
export type DocumentImportStatus = 'attached' | 'requested' | 'drafted' | 'unavailable' | 'cancelled' | 'committed';
export interface DocumentImport {
  id: string;
  boardId: string;
  attachmentId: string;
  status: DocumentImportStatus;
  position: { x: number; y: number };
  sections: ImportSection[];
  warnings: string[];
  agentDescription: string | null;
  reason: string | null;
  committedNodeIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface AttachmentRow {
  id: string;
  board_id: string;
  sha256: string;
  name: string;
  mime: string;
  size: number;
  created_at: string;
}
interface ImportRow {
  id: string;
  board_id: string;
  attachment_id: string;
  status: DocumentImportStatus;
  position_x: number;
  position_y: number;
  sections: string | null;
  warnings: string | null;
  agent_description: string | null;
  reason: string | null;
  committed_node_ids: string | null;
  created_at: string;
  updated_at: string;
}
const attachment = (r: AttachmentRow): Attachment => ({
  id: r.id,
  boardId: r.board_id,
  sha256: r.sha256,
  name: r.name,
  mime: r.mime,
  size: r.size,
  createdAt: r.created_at,
});
const imported = (r: ImportRow): DocumentImport => ({
  id: r.id,
  boardId: r.board_id,
  attachmentId: r.attachment_id,
  status: r.status,
  position: { x: r.position_x, y: r.position_y },
  sections: r.sections ? (JSON.parse(r.sections) as ImportSection[]) : [],
  warnings: r.warnings ? (JSON.parse(r.warnings) as string[]) : [],
  agentDescription: r.agent_description,
  reason: r.reason,
  committedNodeIds: r.committed_node_ids ? (JSON.parse(r.committed_node_ids) as string[]) : [],
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function storeAttachment(
  db: Database,
  input: { boardId: string; name: string; mime: string; bytes: Uint8Array },
): Attachment {
  if (!input.name.trim() || input.name.length > MAX_ATTACHMENT_NAME_LENGTH)
    throw new Error(`Attachment name must be 1-${MAX_ATTACHMENT_NAME_LENGTH} characters.`);
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_ATTACHMENT_BYTES)
    throw new Error(`Attachment must contain 1-${MAX_ATTACHMENT_BYTES} bytes.`);
  const sha256 = new Bun.CryptoHasher('sha256').update(input.bytes).digest('hex');
  const value: Attachment = {
    id: randomUUID(),
    boardId: input.boardId,
    sha256,
    name: input.name,
    mime: input.mime,
    size: input.bytes.byteLength,
    createdAt: new Date().toISOString(),
  };
  db.transaction(() => {
    db.run('INSERT OR IGNORE INTO attachment_bytes (sha256,data,size) VALUES (?,?,?)', [
      sha256,
      input.bytes,
      value.size,
    ]);
    db.run('INSERT INTO attachments (id,board_id,sha256,name,mime,size,created_at) VALUES (?,?,?,?,?,?,?)', [
      value.id,
      value.boardId,
      value.sha256,
      value.name,
      value.mime,
      value.size,
      value.createdAt,
    ]);
  })();
  return value;
}

export function getAttachment(db: Database, id: string): Attachment | null {
  const row = db
    .query<AttachmentRow, [string]>('SELECT id,board_id,sha256,name,mime,size,created_at FROM attachments WHERE id=?')
    .get(id);
  return row ? attachment(row) : null;
}
export function readAttachmentBytes(db: Database, id: string): Uint8Array | null {
  return (
    db
      .query<{ data: Uint8Array }, [string]>(
        'SELECT b.data FROM attachment_bytes b JOIN attachments a ON a.sha256=b.sha256 WHERE a.id=?',
      )
      .get(id)?.data ?? null
  );
}
export function copyBoardAttachments(
  db: Database,
  sourceBoardId: string,
  targetBoardId: string,
  referencedIds: Set<string>,
): Map<string, string> {
  const map = new Map<string, string>();
  const rows = db
    .query<AttachmentRow, string[]>(
      `SELECT id,board_id,sha256,name,mime,size,created_at FROM attachments WHERE board_id=? AND id IN (${[...referencedIds].map(() => '?').join(',') || "''"})`,
    )
    .all(sourceBoardId, ...referencedIds);
  for (const row of rows) {
    const id = randomUUID();
    map.set(row.id, id);
    db.run('INSERT INTO attachments (id,board_id,sha256,name,mime,size,created_at) VALUES (?,?,?,?,?,?,?)', [
      id,
      targetBoardId,
      row.sha256,
      row.name,
      row.mime,
      row.size,
      new Date().toISOString(),
    ]);
  }
  return map;
}
export function createImport(db: Database, attachmentId: string, position: { x: number; y: number }): DocumentImport {
  const a = getAttachment(db, attachmentId);
  if (!a) throw new Error('Attachment not found.');
  const now = new Date().toISOString(),
    id = randomUUID();
  db.run(
    "INSERT INTO document_imports (id,board_id,attachment_id,status,position_x,position_y,created_at,updated_at) VALUES (?,?,?,'attached',?,?,?,?)",
    [id, a.boardId, attachmentId, position.x, position.y, now, now],
  );
  return getImport(db, id)!;
}
export function getImport(db: Database, id: string): DocumentImport | null {
  const r = db.query<ImportRow, [string]>('SELECT * FROM document_imports WHERE id=?').get(id);
  return r ? imported(r) : null;
}
export function listImports(db: Database, boardId?: string): DocumentImport[] {
  const rows = boardId
    ? db
        .query<ImportRow, [string]>('SELECT * FROM document_imports WHERE board_id=? ORDER BY created_at DESC')
        .all(boardId)
    : db.query<ImportRow, []>('SELECT * FROM document_imports ORDER BY created_at DESC').all();
  return rows.map(imported);
}
export function updateImport(
  db: Database,
  id: string,
  status: DocumentImportStatus,
  fields: {
    sections?: ImportSection[];
    warnings?: string[];
    agentDescription?: string;
    reason?: string;
    committedNodeIds?: string[];
  } = {},
): DocumentImport {
  db.run(
    'UPDATE document_imports SET status=?,sections=COALESCE(?,sections),warnings=COALESCE(?,warnings),agent_description=COALESCE(?,agent_description),reason=COALESCE(?,reason),committed_node_ids=COALESCE(?,committed_node_ids),updated_at=? WHERE id=?',
    [
      status,
      fields.sections ? JSON.stringify(fields.sections) : null,
      fields.warnings ? JSON.stringify(fields.warnings) : null,
      fields.agentDescription ?? null,
      fields.reason ?? null,
      fields.committedNodeIds ? JSON.stringify(fields.committedNodeIds) : null,
      new Date().toISOString(),
      id,
    ],
  );
  return getImport(db, id)!;
}
