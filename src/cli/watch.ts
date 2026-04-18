import {
  ALL_SEMANTIC_WATCH_EVENT_TYPES,
  formatCompactWatchEvent,
  SemanticWatchReducer,
  type SemanticWatchEvent,
  type SemanticWatchEventType,
  type SseMessage,
} from '../shared/semantic-attention.js';

export {
  ALL_SEMANTIC_WATCH_EVENT_TYPES,
  formatCompactWatchEvent,
  SemanticWatchReducer,
};
export type {
  SemanticWatchEvent,
  SemanticWatchEventType,
  SseMessage,
};

export function parseSemanticEventFilter(raw: string | undefined): Set<SemanticWatchEventType> {
  const all = new Set<SemanticWatchEventType>(ALL_SEMANTIC_WATCH_EVENT_TYPES);
  if (!raw || raw.trim().length === 0) return all;

  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is SemanticWatchEventType => all.has(value as SemanticWatchEventType));
  return new Set(values);
}

export async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const separatorIndex = buffer.indexOf('\n\n');
        if (separatorIndex === -1) break;
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const parsed = parseSseMessage(rawEvent);
        if (parsed) yield parsed;
      }
    }

    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      const parsed = parseSseMessage(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseMessage(raw: string): SseMessage | null {
  const lines = raw.split(/\r?\n/);
  let event = 'message';
  let id: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(':') || line.trim().length === 0) continue;
    const separatorIndex = line.indexOf(':');
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    let value = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') event = value;
    if (field === 'id') id = value;
    if (field === 'data') dataLines.push(value);
  }

  if (dataLines.length === 0) return null;
  const rawData = dataLines.join('\n');
  try {
    return { event, id, data: JSON.parse(rawData) };
  } catch {
    return { event, id, data: rawData };
  }
}
