export interface WeeklyMetric {
  week: string;
  leadTimeHours: number;
  deployments: number;
  changeFailureRate: number;
  mttrMinutes: number;
}

export interface StageCount {
  stage: string;
  defects: number;
}

export interface OwnershipSlice {
  name: string;
  value: number;
}

export interface GateRow {
  gate: string;
  owner: string;
  status: string;
  delta: string;
}

export interface ComponentRisk {
  service: string;
  readiness: number;
  note: string;
}

export interface TraceEvent {
  title: string;
  toolName: string;
  category: 'mcp' | 'file' | 'subagent' | 'other';
  status: 'running' | 'success' | 'failed';
  duration: string;
  resultSummary: string;
}

export const pipelineStages = [
  'Plan',
  'Code',
  'Build',
  'Test',
  'Canary',
  'Deploy',
  'Observe',
] as const;

export const weeklyMetrics: WeeklyMetric[] = [
  { week: 'W14', leadTimeHours: 27, deployments: 14, changeFailureRate: 9.8, mttrMinutes: 52 },
  { week: 'W15', leadTimeHours: 24, deployments: 16, changeFailureRate: 8.9, mttrMinutes: 46 },
  { week: 'W16', leadTimeHours: 22, deployments: 18, changeFailureRate: 8.2, mttrMinutes: 41 },
  { week: 'W17', leadTimeHours: 20, deployments: 19, changeFailureRate: 7.9, mttrMinutes: 39 },
  { week: 'W18', leadTimeHours: 19, deployments: 22, changeFailureRate: 7.6, mttrMinutes: 36 },
];

export const stageDefectCounts: StageCount[] = [
  { stage: 'Lint', defects: 12 },
  { stage: 'Unit', defects: 9 },
  { stage: 'Integration', defects: 17 },
  { stage: 'UI Smoke', defects: 11 },
  { stage: 'Canary', defects: 4 },
];

export const ownershipLoad: OwnershipSlice[] = [
  { name: 'Platform', value: 34 },
  { name: 'Checkout', value: 22 },
  { name: 'Identity', value: 18 },
  { name: 'Catalog', value: 16 },
  { name: 'Observability', value: 10 },
];

export const gateRows: GateRow[] = [
  { gate: 'Compile', owner: 'Platform', status: 'Pass', delta: '+1m' },
  { gate: 'Unit tests', owner: 'Checkout', status: 'Pass', delta: '-12%' },
  { gate: 'Contract tests', owner: 'Identity', status: 'Watch', delta: '+3 flaky' },
  { gate: 'UI smoke', owner: 'Storefront', status: 'Watch', delta: '+6m' },
  { gate: 'Security scan', owner: 'Platform', status: 'Pass', delta: '0 critical' },
  { gate: 'Canary score', owner: 'SRE', status: 'Pass', delta: '97/100' },
];

export const componentRisks: ComponentRisk[] = [
  { service: 'Checkout', readiness: 68, note: 'Integration retries elevated on coupon paths.' },
  { service: 'Identity', readiness: 74, note: 'Contract drift from token refresh branch.' },
  { service: 'Catalog', readiness: 88, note: 'Healthy after index rebuild.' },
  { service: 'Observability', readiness: 93, note: 'Rollback and alerting posture both green.' },
];

export const contextCards = [
  {
    key: 'article',
    title: 'Scenario article',
    summary: 'Markdown narrative that explains why each node exists in the external-consumer test.',
    path: 'demo/article.md',
    pathDisplay: 'demo/article.md',
    category: 'planning',
    sourceKind: 'workspace',
    state: 'loaded',
    required: true,
  },
  {
    key: 'artifact',
    title: 'Artifact source',
    summary: 'React-based SDLC control room bundled through the published package.',
    path: 'demo/web/App.tsx',
    pathDisplay: 'demo/web/App.tsx',
    category: 'workspace',
    sourceKind: 'workspace',
    state: 'loaded',
    required: true,
  },
  {
    key: 'data',
    title: 'Synthetic telemetry',
    summary: 'Fake but realistic release metrics used by graphs, forms, and the article.',
    path: 'demo/data.ts',
    pathDisplay: 'demo/data.ts',
    category: 'memory',
    sourceKind: 'workspace',
    state: 'loaded',
    required: false,
  },
];

export const ledgerSummary = {
  deploymentsThisWeek: 22,
  firstPassGateRate: '78%',
  leadTimeMedian: '19h',
  mttrMedian: '36m',
  artifactNodes: 6,
  operatorFocus: 'integration-queue',
};

export const traceEvents: TraceEvent[] = [
  {
    title: 'Trace: pack',
    toolName: 'npm pack',
    category: 'other',
    status: 'success',
    duration: '4.2s',
    resultSummary: 'Packed tarball and copied it into a clean temp consumer.',
  },
  {
    title: 'Trace: seed',
    toolName: 'canvas.buildWebArtifact',
    category: 'mcp',
    status: 'success',
    duration: '11.8s',
    resultSummary: 'Built the control-room artifact and opened it on the canvas.',
  },
  {
    title: 'Trace: verify',
    toolName: 'playwright',
    category: 'subagent',
    status: 'running',
    duration: 'live',
    resultSummary: 'Headed browser check against the published-consumer workspace.',
  },
];

export const artifactKpis = [
  { label: 'Median lead time', value: '19h', note: 'Queueing still dominates the tail.' },
  { label: 'Deploy frequency', value: '22/wk', note: 'Release train cadence is steady.' },
  { label: 'Change failure', value: '7.6%', note: 'Most issues are stopped before prod.' },
  { label: 'Recovery time', value: '36m', note: 'Rollback drills remain reliable.' },
];

export const releaseChecklist = [
  'Artifact build succeeds from packaged install',
  'json-render dashboard renders in hosted viewer',
  'Line, bar, and pie graphs render from synthetic data',
  'Markdown, image, file, status, context, ledger, and trace nodes coexist cleanly',
];
