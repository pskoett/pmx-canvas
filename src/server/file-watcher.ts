/**
 * File watcher for file-type canvas nodes.
 *
 * Monitors files on disk and pushes content updates to the canvas
 * when they change. This enables real-time file viewing: the agent
 * edits a file, the canvas node updates automatically.
 */

import { watch, existsSync, readFileSync, statSync } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { canvasState } from './canvas-state.js';

function logFileWatcherWarning(action: string, error: unknown, details?: Record<string, unknown>): void {
  console.warn(`[file-watcher] ${action}`, { error, ...(details ?? {}) });
}

interface WatchedFile {
  path: string;
  nodeIds: Set<string>;
  watcher: FSWatcher;
  lastMtime: number;
}

const watched = new Map<string, WatchedFile>();
let onFileChanged: ((nodeId: string) => void) | null = null;

/** Register a callback for when a watched file changes. */
export function onFileNodeChanged(cb: (nodeId: string) => void): void {
  onFileChanged = cb;
}

/** Start watching a file for a given node. */
export function watchFileForNode(nodeId: string, filePath: string): void {
  if (!filePath || !existsSync(filePath)) return;

  const existing = watched.get(filePath);
  if (existing) {
    existing.nodeIds.add(nodeId);
    return;
  }

  try {
    const stat = statSync(filePath);
    const watcher = watch(filePath, { persistent: false }, (eventType) => {
      if (eventType !== 'change') return;
      handleFileChange(filePath);
    });

    watched.set(filePath, {
      path: filePath,
      nodeIds: new Set([nodeId]),
      watcher,
      lastMtime: stat.mtimeMs,
    });
  } catch (error) {
    logFileWatcherWarning('watch setup failed', error, { nodeId, filePath });
  }
}

/** Stop watching a file for a given node. */
export function unwatchFileForNode(nodeId: string, filePath?: string): void {
  for (const [path, entry] of watched) {
    if (filePath && path !== filePath) continue;
    entry.nodeIds.delete(nodeId);
    if (entry.nodeIds.size === 0) {
      entry.watcher.close();
      watched.delete(path);
    }
  }
}

/** Stop all watchers. */
export function unwatchAll(): void {
  for (const entry of watched.values()) {
    entry.watcher.close();
  }
  watched.clear();
}

function handleFileChange(filePath: string): void {
  const entry = watched.get(filePath);
  if (!entry) return;

  // Debounce: check mtime to avoid duplicate events
  try {
    if (!existsSync(filePath)) return;
    const stat = statSync(filePath);
    if (stat.mtimeMs === entry.lastMtime) return;
    entry.lastMtime = stat.mtimeMs;

    const content = readFileSync(filePath, 'utf-8');
    const lineCount = content.split('\n').length;
    const updatedAt = new Date(stat.mtimeMs).toISOString();

    // Update all nodes watching this file
    for (const nodeId of entry.nodeIds) {
      const node = canvasState.getNode(nodeId);
      if (!node) continue;
      canvasState.updateNode(nodeId, {
        data: {
          ...node.data,
          fileContent: content,
          lineCount,
          updatedAt,
        },
      });
      onFileChanged?.(nodeId);
    }
  } catch (error) {
    logFileWatcherWarning('handle file change failed', error, { filePath });
  }
}
