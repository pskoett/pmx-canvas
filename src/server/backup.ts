/**
 * Library backup (plan 012): the whole workspace database — every board, its
 * snapshots and blobs — copied with `VACUUM INTO`, which is safe while the
 * server runs. Backups are plain files in a folder the human chooses; the
 * schedule lives in the database and runs inside the server.
 */
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { canvasState, PMX_CANVAS_DIR } from './canvas-state.js';

const FILE_PATTERN = /^canvas-(\d{8}T\d{9}Z)(?:-(\d+))?\.db$/;
const DEFAULT_KEEP = 14;
const MIN_INTERVAL_MS = 60_000;
const CHECK_INTERVAL_MS = 60_000;

const META = {
  folder: 'backup_folder',
  everyMs: 'backup_every_ms',
  keep: 'backup_keep',
  lastAt: 'backup_last_at',
  lastPath: 'backup_last_path',
} as const;

export interface BackupFile {
  path: string;
  bytes: number;
  at: string;
}

export interface BackupStatus {
  folder: string;
  keep: number;
  everyMs: number | null;
  lastAt: string | null;
  lastPath: string | null;
  backups: BackupFile[];
}

/** "90s", "30m", "24h", "7d" → milliseconds. */
export function parseBackupInterval(value: string): number | null {
  const match = value.trim().match(/^(\d+)\s*([smhd])$/i);
  if (!match) return null;
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2].toLowerCase() as 's' | 'm' | 'h' | 'd'];
  return Number(match[1]) * unit;
}

function resolveFolder(folder: string): string {
  return isAbsolute(folder) ? folder : resolve(canvasState.workspaceRoot, folder);
}

/** Beside the database: `.pmx-canvas/backups` unless PMX_CANVAS_DB_PATH moved it. */
function defaultFolder(): string {
  const dbPath = canvasState.databasePath;
  return dbPath ? join(dirname(dbPath), 'backups') : join(canvasState.workspaceRoot, PMX_CANVAS_DIR, 'backups');
}

function listBackupFiles(folder: string): BackupFile[] {
  if (!existsSync(folder)) return [];
  // Newest first by the name's timestamp, then its same-millisecond counter.
  const order = (name: string): string => {
    const match = name.match(FILE_PATTERN);
    return `${match?.[1] ?? ''}-${(match?.[2] ?? '1').padStart(6, '0')}`;
  };
  return readdirSync(folder)
    .filter((name) => FILE_PATTERN.test(name))
    .sort((a, b) => order(b).localeCompare(order(a)))
    .map((name) => {
      const path = join(folder, name);
      const stat = statSync(path);
      return { path, bytes: stat.size, at: stat.mtime.toISOString() };
    });
}

export function getBackupStatus(): BackupStatus {
  const everyMs = Number(canvasState.readWorkspaceMeta(META.everyMs));
  const folder = canvasState.readWorkspaceMeta(META.folder) ?? defaultFolder();
  return {
    folder,
    keep: Number(canvasState.readWorkspaceMeta(META.keep)) || DEFAULT_KEEP,
    everyMs: everyMs > 0 ? everyMs : null,
    lastAt: canvasState.readWorkspaceMeta(META.lastAt),
    lastPath: canvasState.readWorkspaceMeta(META.lastPath),
    backups: listBackupFiles(folder),
  };
}

/** Back up now; keeps the newest `keep` backups in the folder and removes older ones. */
export function runBackup(options: { folder?: string; keep?: number } = {}): {
  backup: BackupFile;
  removed: string[];
} {
  const status = getBackupStatus();
  const folder = options.folder ? resolveFolder(options.folder) : status.folder;
  const keep = options.keep ?? status.keep;
  mkdirSync(folder, { recursive: true });

  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  let path = join(folder, `canvas-${stamp}.db`);
  for (let n = 2; existsSync(path); n++) path = join(folder, `canvas-${stamp}-${n}.db`);
  canvasState.backupDatabaseTo(path);

  const removed = listBackupFiles(folder)
    .slice(keep)
    .map((file) => file.path);
  for (const file of removed) rmSync(file, { force: true });

  const at = new Date().toISOString();
  canvasState.writeWorkspaceMeta(META.lastAt, at);
  canvasState.writeWorkspaceMeta(META.lastPath, path);
  return { backup: { path, bytes: statSync(path).size, at }, removed };
}

/** Set the schedule (`everyMs` null turns it off). Folder and keep also apply to manual backups. */
export function setBackupSchedule(options: { everyMs: number | null; folder?: string; keep?: number }): BackupStatus {
  if (options.everyMs !== null && options.everyMs < MIN_INTERVAL_MS) {
    throw new Error('Back up at most once a minute.');
  }
  canvasState.writeWorkspaceMeta(META.everyMs, options.everyMs === null ? null : String(options.everyMs));
  if (options.folder) canvasState.writeWorkspaceMeta(META.folder, resolveFolder(options.folder));
  if (options.keep) canvasState.writeWorkspaceMeta(META.keep, String(options.keep));
  return getBackupStatus();
}

/** Runs a scheduled backup when one is due. Returns whether it ran. */
export function runDueBackup(now = Date.now()): boolean {
  if (!canvasState.databasePath) return false;
  const { everyMs, lastAt } = getBackupStatus();
  if (!everyMs) return false;
  if (lastAt && now - Date.parse(lastAt) < everyMs) return false;
  runBackup();
  return true;
}

/** Rejects anything that is not a canvas database before the live file is touched. */
export function assertRestorableBackup(file: string): void {
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`No backup file at ${file}.`);
  if (resolve(file) === resolve(canvasState.databasePath ?? '')) {
    throw new Error('That is the live database, not a backup.');
  }
  let tables: string[] = [];
  try {
    const db = new Database(file, { readonly: true });
    tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    db.close();
  } catch {
    throw new Error(`${file} is not a SQLite database.`);
  }
  if (!tables.includes('meta') || !tables.includes('nodes')) {
    throw new Error(`${file} is not a PMX Canvas database.`);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startBackupScheduler(): void {
  stopBackupScheduler();
  const check = () => {
    try {
      runDueBackup();
    } catch (error) {
      console.warn('[backup] scheduled backup failed', error);
    }
  };
  check();
  timer = setInterval(check, CHECK_INTERVAL_MS);
  timer.unref?.();
}

export function stopBackupScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
