import type { Database } from 'bun:sqlite';
export declare const MAX_ATTACHMENT_BYTES: number;
export declare const MAX_INLINE_ATTACHMENT_BYTES: number;
export declare const MAX_ATTACHMENT_NAME_LENGTH = 255;
export declare const MAX_IMPORT_SECTIONS = 32;
export declare const MAX_IMPORT_WARNINGS = 20;
export declare const MAX_IMPORT_TEXT = 200000;
export declare const MAX_IMPORT_TITLE_LENGTH = 500;
export declare const MAX_IMPORT_REFERENCE_LENGTH = 2000;
export declare const MAX_IMPORT_WARNING_LENGTH = 2000;
export declare const MAX_IMPORT_AGENT_DESCRIPTION_LENGTH = 4000;
export declare const MAX_IMPORT_REASON_LENGTH = 4000;
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
    position: {
        x: number;
        y: number;
    };
    sections: ImportSection[];
    warnings: string[];
    agentDescription: string | null;
    reason: string | null;
    committedNodeIds: string[];
    createdAt: string;
    updatedAt: string;
}
export declare function storeAttachment(db: Database, input: {
    boardId: string;
    name: string;
    mime: string;
    bytes: Uint8Array;
}): Attachment;
export declare function getAttachment(db: Database, id: string): Attachment | null;
export declare function readAttachmentBytes(db: Database, id: string): Uint8Array | null;
export declare function copyBoardAttachments(db: Database, sourceBoardId: string, targetBoardId: string, referencedIds: Set<string>): Map<string, string>;
export declare function createImport(db: Database, attachmentId: string, position: {
    x: number;
    y: number;
}): DocumentImport;
export declare function getImport(db: Database, id: string): DocumentImport | null;
export declare function listImports(db: Database, boardId?: string): DocumentImport[];
export declare function updateImport(db: Database, id: string, status: DocumentImportStatus, fields?: {
    sections?: ImportSection[];
    warnings?: string[];
    agentDescription?: string;
    reason?: string;
    committedNodeIds?: string[];
}): DocumentImport;
