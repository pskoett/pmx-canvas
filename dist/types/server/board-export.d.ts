export interface ExportManifest {
    boardId: string;
    boardName: string;
    cards: number;
    connections: number;
    /** Cards shown in sandboxed frames: html, charts, diagrams, built apps. */
    frames: number;
    placeholders: Array<{
        nodeId: string;
        title: string;
        reason: string;
    }>;
    files: Array<{
        nodeId: string;
        path: string;
        included: boolean;
    }>;
    attachments: Array<{
        nodeId: string;
        name: string;
    }>;
    sourceDerivedCards: Array<{
        nodeId: string;
        included: boolean;
    }>;
    embeddedImages: number;
    /** Web images the file loads when opened. */
    remoteImages: string[];
    /** Navigable links present in markdown and webpage cards. */
    links: string[];
    /** Statically visible network destinations in sandboxed HTML frames. */
    frameNetworkDestinations: string[];
    /** Scripts in embedded frames can make requests that static inspection cannot enumerate. */
    embeddedCodeCanAccessNetwork: boolean;
    includeFiles: boolean;
}
/** What an export of `boardId` would put in the file, without building it. */
export declare function previewBoardExport(boardId: string, includeFiles: boolean, includeDerivedText?: boolean): Promise<ExportManifest | null>;
export declare function buildBoardExport(boardId: string, includeFiles: boolean, includeDerivedText?: boolean): Promise<{
    html: string;
    manifest: ExportManifest;
} | null>;
/** Writes the export beside the database (`exports/`) and returns its path. */
export declare function writeBoardExport(html: string, boardName: string): string;
export declare function exportsFolder(): string | null;
