import { type BoardSummary } from '../state/boards-store';
/** A destination picker: select an existing folder, optionally create a child, then move. */
export declare function BoardFolderDialog({ board, folders, onClose, }: {
    board: BoardSummary;
    folders: string[];
    onClose: () => void;
}): import("preact/jsx-runtime").JSX.Element;
