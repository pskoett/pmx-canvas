/**
 * File watcher for file-type canvas nodes.
 *
 * Monitors files on disk and pushes content updates to the canvas
 * when they change. This enables real-time file viewing: the agent
 * edits a file, the canvas node updates automatically.
 */
/** Register a callback for when a watched file changes. */
export declare function onFileNodeChanged(cb: (nodeId: string) => void): void;
/** Start watching a file for a given node. */
export declare function watchFileForNode(nodeId: string, filePath: string): void;
/** Stop watching a file for a given node. */
export declare function unwatchFileForNode(nodeId: string, filePath?: string): void;
/** Stop all watchers. */
export declare function unwatchAll(): void;
export declare function rewatchAllFileNodes(): void;
