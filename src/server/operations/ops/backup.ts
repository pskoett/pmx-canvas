/**
 * Library backup (plan 012): backup.status / backup.run / backup.schedule /
 * backup.restore. HTTP, CLI and SDK only — backing up and restoring are the
 * human's maintenance, not agent tools, so there is no MCP surface.
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import {
  assertRestorableBackup,
  getBackupStatus,
  parseBackupInterval,
  runBackup,
  setBackupSchedule,
} from '../../backup.js';
import { restoreCanvasLibrary } from '../../canvas-operations.js';
import { canvasState } from '../../canvas-state.js';
import { defineOperation, OperationError, type Operation } from '../types.js';
import { boardsPayload } from './boards.js';

function requireDatabase(): void {
  if (!canvasState.databasePath) throw new OperationError('Backups need a workspace database.', 409);
}

function positiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new OperationError(`${field} must be a whole number of 1 or more.`);
  return parsed;
}

const statusShape = {};
const statusSchema = z.looseObject(statusShape);

const backupStatusOperation = defineOperation<z.infer<typeof statusSchema>, Record<string, unknown>>({
  name: 'backup.status',
  mutates: false,
  input: statusSchema,
  inputShape: statusShape,
  http: { method: 'GET', path: '/api/canvas/backup' },
  handler: () => {
    requireDatabase();
    return { ok: true, ...getBackupStatus() };
  },
});

const runShape = {
  to: z.unknown().optional().describe('Folder to write the backup to (default: the configured folder)'),
  keep: z.unknown().optional().describe('How many backups to keep in that folder'),
};
const runSchema = z.looseObject(runShape);

const backupRunOperation = defineOperation<z.infer<typeof runSchema>, Record<string, unknown>>({
  name: 'backup.run',
  mutates: false,
  input: runSchema,
  inputShape: runShape,
  http: { method: 'POST', path: '/api/canvas/backup' },
  handler: (input) => {
    requireDatabase();
    const result = runBackup({
      ...(typeof input.to === 'string' && input.to.trim() ? { folder: input.to.trim() } : {}),
      ...(positiveInteger(input.keep, 'keep') ? { keep: positiveInteger(input.keep, 'keep') } : {}),
    });
    return { ok: true, ...result, status: getBackupStatus() };
  },
});

const scheduleShape = {
  every: z.unknown().optional().describe('Interval like "24h", "30m", "7d"; "off" or null stops scheduled backups'),
  to: z.unknown().optional().describe('Backup folder'),
  keep: z.unknown().optional().describe('How many backups to keep'),
};
const scheduleSchema = z.looseObject(scheduleShape);

const backupScheduleOperation = defineOperation<z.infer<typeof scheduleSchema>, Record<string, unknown>>({
  name: 'backup.schedule',
  mutates: false,
  input: scheduleSchema,
  inputShape: scheduleShape,
  http: { method: 'POST', path: '/api/canvas/backup/schedule' },
  handler: (input) => {
    requireDatabase();
    const off = input.every === null || input.every === 'off';
    const everyMs = off ? null : parseBackupInterval(String(input.every ?? ''));
    if (!off && everyMs === null) throw new OperationError('every must look like "30m", "24h" or "7d", or be "off".');
    try {
      const status = setBackupSchedule({
        everyMs,
        ...(typeof input.to === 'string' && input.to.trim() ? { folder: input.to.trim() } : {}),
        ...(positiveInteger(input.keep, 'keep') ? { keep: positiveInteger(input.keep, 'keep') } : {}),
      });
      return { ok: true, ...status };
    } catch (error) {
      throw new OperationError(error instanceof Error ? error.message : String(error));
    }
  },
});

const restoreShape = {
  file: z.unknown().optional().describe('Backup file to restore'),
};
const restoreSchema = z.looseObject(restoreShape);

const backupRestoreOperation = defineOperation<z.infer<typeof restoreSchema>, Record<string, unknown>>({
  name: 'backup.restore',
  mutates: false,
  input: restoreSchema,
  inputShape: restoreShape,
  http: { method: 'POST', path: '/api/canvas/backup/restore' },
  handler: (input, ctx) => {
    requireDatabase();
    const file = typeof input.file === 'string' ? input.file.trim() : '';
    if (!file) throw new OperationError('file is required.');
    try {
      assertRestorableBackup(file);
    } catch (error) {
      throw new OperationError(error instanceof Error ? error.message : String(error));
    }
    const previous = `${canvasState.databasePath}.before-restore`;
    restoreCanvasLibrary(file);
    // `reloaded` tells open tabs to take the board fresh even when its id is unchanged.
    ctx.emit('boards-changed', { ...boardsPayload(), reloaded: true });
    return { ok: true, restored: file, previous, ...boardsPayload() };
  },
});

export const backupOperations: Operation[] = [
  backupStatusOperation,
  backupRunOperation,
  backupScheduleOperation,
  backupRestoreOperation,
];
