import { type SseMessage } from '../../shared/semantic-attention.js';
import { type AttentionTone } from './attention-store';
/** Show a transient toast from arbitrary client code (e.g. AX action feedback). */
export declare function showToast(tone: AttentionTone, title: string, detail?: string, nodeIds?: string[]): void;
export declare function resetAttentionBridge(): void;
export declare function syncAttentionFromSse(message: SseMessage): void;
