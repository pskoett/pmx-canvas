interface MenuState {
    x: number;
    y: number;
    nodeId: string;
}
export declare function useContextMenu(): {
    menu: MenuState | null;
    openMenu: (e: MouseEvent, nodeId: string) => void;
    closeMenu: () => void;
};
interface ContextMenuProps {
    x: number;
    y: number;
    nodeId: string;
    onClose: () => void;
}
export declare function ContextMenu({ x, y, nodeId, onClose }: ContextMenuProps): import("preact/src").JSX.Element | null;
export {};
