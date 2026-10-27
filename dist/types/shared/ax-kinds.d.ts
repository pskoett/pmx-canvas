/**
 * AX status and kind unions shared by the server's state model and the
 * client's session panel, so a new status cannot be added on one side and
 * silently render unrecognized on the other.
 */
export type AxWorkItemStatus = 'todo' | 'in-progress' | 'blocked' | 'done' | 'cancelled';
/** Authored work cards use the task vocabulary without creating an AX task. */
export declare const WORK_CARD_STATES: Record<AxWorkItemStatus, {
    label: string;
    glyph: string;
}>;
export declare function isWorkCardState(value: unknown): value is AxWorkItemStatus;
/** `held` = auto-held by the unattended-approval policy: the action did NOT proceed. */
export type AxApprovalStatus = 'pending' | 'approved' | 'rejected' | 'held';
export type AxEventKind = 'prompt' | 'assistant-message' | 'tool-start' | 'tool-result' | 'failure' | 'approval' | 'steering' | 'command' | 'note' | 'policy'
/** A human took over a node the agent was editing; the agent yielded (rail-chrome-v2 item 6). */
 | 'yield';
