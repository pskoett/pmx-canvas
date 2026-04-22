export type MenuState = {
    kind: 'node';
    x: number;
    y: number;
    nodeId: string;
} | {
    kind: 'canvas';
    x: number;
    y: number;
    canvasX: number;
    canvasY: number;
};
export declare function useContextMenu(): {
    menu: MenuState | null;
    openNodeMenu: (e: MouseEvent, nodeId: string) => void;
    openCanvasMenu: (e: MouseEvent, canvasX: number, canvasY: number) => void;
    closeMenu: () => void;
};
interface ContextMenuProps {
    menu: MenuState;
    onClose: () => void;
}
export declare function ContextMenu({ menu, onClose }: ContextMenuProps): import("preact").JSX.Element | null;
export {};
