import { ALL_SEMANTIC_WATCH_EVENT_TYPES, formatCompactWatchEvent, SemanticWatchReducer, type SemanticWatchEvent, type SemanticWatchEventType, type SseMessage } from '../shared/semantic-attention.js';
export { ALL_SEMANTIC_WATCH_EVENT_TYPES, formatCompactWatchEvent, SemanticWatchReducer, };
export type { SemanticWatchEvent, SemanticWatchEventType, SseMessage, };
export declare function parseSemanticEventFilter(raw: string | undefined): Set<SemanticWatchEventType>;
export declare function parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage>;
