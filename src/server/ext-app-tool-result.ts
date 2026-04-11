import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

interface NormalizeExtAppToolResultInput {
  result: unknown;
  success?: boolean;
  error?: string;
  content?: string;
  detailedContent?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCallToolResult(value: unknown): value is CallToolResult {
  return (
    isRecord(value) &&
    Array.isArray(value.content) &&
    value.content.every(
      (item) => isRecord(item) && typeof item.type === 'string',
    )
  );
}

function firstNonEmptyString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) return value;
    }
  }
  return undefined;
}

function serializeExtAppResultValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value);
  } catch (error) {
    console.debug('[ext-app-tool-result] stringify failed', error);
    return String(value);
  }
}

export function normalizeExtAppToolResult(
  input: NormalizeExtAppToolResultInput,
): CallToolResult {
  const isError = input.success === false;

  if (isCallToolResult(input.result)) {
    return {
      ...input.result,
      isError: input.result.isError === true || isError,
    };
  }

  const resultRecord = isRecord(input.result) ? input.result : null;
  const text =
    firstNonEmptyString(
      input.detailedContent,
      input.content,
      resultRecord?.detailedContent,
      resultRecord?.content,
      resultRecord?.textResultForLlm,
      resultRecord?.text,
      resultRecord?.message,
      typeof input.result === 'string' ? input.result : undefined,
      input.error,
    ) ?? serializeExtAppResultValue(input.result);

  return {
    content: text ? [{ type: 'text', text }] : [],
    isError,
  };
}
