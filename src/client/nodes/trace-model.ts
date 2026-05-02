export interface TraceDisplayModel {
  toolName: string;
  category: string;
  status: string;
  duration: string;
  resultSummary: string;
  error: string;
}

export function buildTraceDisplayModel(data: Record<string, unknown>): TraceDisplayModel {
  return {
    toolName: (data.toolName as string) || (data.title as string) || 'unknown',
    category: (data.category as string) || 'other',
    status: (data.status as string) || 'running',
    duration: (data.duration as string) || '',
    resultSummary: (data.resultSummary as string) || (data.content as string) || '',
    error: (data.error as string) || '',
  };
}
