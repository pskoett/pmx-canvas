import { z } from 'zod';
export declare const CANVAS_APP_URI = "ui://pmx/canvas";
export declare const CANVAS_APP_WRITE_CONTRACT = "pmx-embedded-workbench-v4";
export declare const canvasAppSnapshotSchema: z.ZodObject<{
    boardId: z.ZodNullable<z.ZodString>;
    boardName: z.ZodString;
    boards: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
    }, z.core.$strip>>;
    revision: z.ZodString;
    nodes: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodString;
        title: z.ZodString;
        text: z.ZodString;
        contentRevision: z.ZodNumber;
        editableContent: z.ZodOptional<z.ZodString>;
        position: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, z.core.$strip>;
        size: z.ZodObject<{
            width: z.ZodNumber;
            height: z.ZodNumber;
        }, z.core.$strip>;
        image: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    edges: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        from: z.ZodString;
        to: z.ZodString;
        label: z.ZodString;
    }, z.core.$strip>>;
    pinnedNodeIds: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type CanvasAppSnapshot = z.infer<typeof canvasAppSnapshotSchema>;
/** Share only curated text, never image bytes or the whole board's contents. */
export declare function canvasAppContext(snapshot: Pick<CanvasAppSnapshot, 'boardId' | 'boardName' | 'pinnedNodeIds'> & {
    nodes: Pick<CanvasAppSnapshot['nodes'][number], 'id' | 'type' | 'title' | 'text' | 'contentRevision'>[];
}, selectedIds: string[], focusedIds?: string[]): {
    boardId: string | null;
    boardName: string;
    selectedNodeIds: string[];
    focusedNodeIds: string[];
    pinnedNodeIds: string[];
    nodes: {
        id: string;
        type: string;
        title: string;
        contentRevision: number;
        text: string;
    }[];
};
