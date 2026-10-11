/** Per-process capability used only to distinguish workbench clicks from HTTP agents. */
export declare const workbenchToken: string;
export declare function isWorkbenchToken(value: string | null): boolean;
/** Refuse an old tab's writes after a daemon restart, without downgrading its actor. */
export declare function refuseStaleWorkbenchWrite(req: Request): Response | null;
