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
export declare function parseBackupInterval(value: string): number | null;
export declare function getBackupStatus(): BackupStatus;
/** Back up now; keeps the newest `keep` backups in the folder and removes older ones. */
export declare function runBackup(options?: {
    folder?: string;
    keep?: number;
}): {
    backup: BackupFile;
    removed: string[];
};
/** Set the schedule (`everyMs` null turns it off). Folder and keep also apply to manual backups. */
export declare function setBackupSchedule(options: {
    everyMs: number | null;
    folder?: string;
    keep?: number;
}): BackupStatus;
/** Runs a scheduled backup when one is due. Returns whether it ran. */
export declare function runDueBackup(now?: number): boolean;
/** Rejects anything that is not a canvas database before the live file is touched. */
export declare function assertRestorableBackup(file: string): void;
export declare function startBackupScheduler(): void;
export declare function stopBackupScheduler(): void;
