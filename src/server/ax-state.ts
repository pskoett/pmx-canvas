import type { CanvasLayout, CanvasNodeState } from './canvas-state.js';
import type { AgentContextNode } from './agent-context.js';

export type PmxAxSource = 'agent' | 'api' | 'browser' | 'cli' | 'codex' | 'copilot' | 'mcp' | 'sdk' | 'system';

export interface PmxAxFocusState {
  nodeIds: string[];
  primaryNodeId: string | null;
  updatedAt: string | null;
  source: PmxAxSource | null;
}

// ── New enums ──────────────────────────────────────────────────────
export type PmxAxEventKind =
  | 'prompt' | 'assistant-message' | 'tool-start' | 'tool-result'
  | 'failure' | 'approval' | 'steering';
export type PmxAxEvidenceKind =
  | 'logs' | 'tool-result' | 'screenshot' | 'file' | 'diff' | 'test-output';
export type PmxAxWorkItemStatus = 'todo' | 'in-progress' | 'blocked' | 'done' | 'cancelled';
export type PmxAxApprovalStatus = 'pending' | 'approved' | 'rejected';
export type PmxAxReviewKind = 'comment' | 'finding';
export type PmxAxReviewSeverity = 'info' | 'warning' | 'error';
export type PmxAxReviewStatus = 'open' | 'resolved' | 'dismissed';
export type PmxAxReviewAnchorType = 'node' | 'file' | 'region';

// ── Canvas-bound records (live inside PmxAxState; snapshotted) ──────
export interface PmxAxWorkItem {
  id: string;
  title: string;
  status: PmxAxWorkItemStatus;
  detail: string | null;
  nodeIds: string[];
  createdAt: string;
  updatedAt: string;
  source: PmxAxSource | null;
}

export interface PmxAxApprovalGate {
  id: string;
  title: string;
  detail: string | null;
  action: string | null;
  status: PmxAxApprovalStatus;
  nodeIds: string[];
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  source: PmxAxSource | null;
}

export interface PmxAxReviewRegion {
  line?: number;
  endLine?: number;
  label?: string;
}

export interface PmxAxReviewAnnotation {
  id: string;
  kind: PmxAxReviewKind;
  body: string;
  severity: PmxAxReviewSeverity;
  status: PmxAxReviewStatus;
  anchorType: PmxAxReviewAnchorType;
  nodeId: string | null;
  file: string | null;
  region: PmxAxReviewRegion | null;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  source: PmxAxSource | null;
}

// ── Timeline records (separate DB tables; NOT in PmxAxState) ────────
export interface PmxAxEvent {
  id: string;
  seq: number;
  kind: PmxAxEventKind;
  summary: string;
  detail: string | null;
  nodeIds: string[];
  data: Record<string, unknown> | null;
  createdAt: string;
  source: PmxAxSource | null;
}

export interface PmxAxEvidence {
  id: string;
  seq: number;
  kind: PmxAxEvidenceKind;
  title: string;
  body: string | null;
  ref: string | null;
  nodeIds: string[];
  data: Record<string, unknown> | null;
  createdAt: string;
  source: PmxAxSource | null;
}

export interface PmxAxSteeringMessage {
  id: string;
  seq: number;
  message: string;
  delivered: boolean;
  createdAt: string;
  source: PmxAxSource | null;
}

// ── Host/session capability (own table; reported by adapters) ──────
export interface PmxAxHostCapability {
  host: string | null;
  canvas: boolean;
  hooks: boolean;
  tools: boolean;
  sessionMessaging: boolean;
  permissions: boolean;
  files: boolean;
  uiPrompts: boolean;
  reportedAt: string | null;
  raw: Record<string, unknown> | null;
}

// ── Bounded timeline summary for context export ────────────────────
export interface PmxAxTimelineSummary {
  recentEvents: PmxAxEvent[];
  recentEvidence: PmxAxEvidence[];
  pendingSteering: PmxAxSteeringMessage[];
  counts: { events: number; evidence: number; steering: number };
}

// ── Constants ──────────────────────────────────────────────────────
export const AX_TIMELINE_RETENTION = 500;
export const AX_TIMELINE_DEFAULT_LIMIT = 50;
export const AX_TIMELINE_MAX_LIMIT = 200;
export const AX_CONTEXT_EVENT_LIMIT = 20;
export const AX_CONTEXT_EVIDENCE_LIMIT = 10;
export const AX_CONTEXT_STEERING_LIMIT = 10;

export interface PmxAxState {
  version: 1;
  focus: PmxAxFocusState;
  workItems: PmxAxWorkItem[];
  approvalGates: PmxAxApprovalGate[];
  reviewAnnotations: PmxAxReviewAnnotation[];
}

export interface PmxAxPinnedContext {
  preamble: string;
  nodeIds: string[];
  count: number;
  nodes: AgentContextNode[];
}

export interface PmxAxFocusContext extends PmxAxFocusState {
  nodes: AgentContextNode[];
}

export interface PmxAxContext {
  version: 1;
  generatedAt: string;
  surface: {
    nodeCount: number;
    edgeCount: number;
  };
  pinned: PmxAxPinnedContext;
  focus: PmxAxFocusContext;
  workItems: PmxAxWorkItem[];
  approvalGates: PmxAxApprovalGate[];
  reviewAnnotations: PmxAxReviewAnnotation[];
  timeline: PmxAxTimelineSummary;
  host: PmxAxHostCapability | null;
}

const AX_SOURCES = new Set<PmxAxSource>(['agent', 'api', 'browser', 'cli', 'codex', 'copilot', 'mcp', 'sdk', 'system']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSource(value: unknown): PmxAxSource | null {
  return typeof value === 'string' && AX_SOURCES.has(value as PmxAxSource)
    ? value as PmxAxSource
    : null;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeNodeIds(value: unknown, validNodeIds?: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    if (validNodeIds && !validNodeIds.has(item)) continue;
    if (!ids.includes(item)) ids.push(item);
  }
  return ids;
}

const AX_EVENT_KINDS = new Set<PmxAxEventKind>(['prompt', 'assistant-message', 'tool-start', 'tool-result', 'failure', 'approval', 'steering']);
const AX_EVIDENCE_KINDS = new Set<PmxAxEvidenceKind>(['logs', 'tool-result', 'screenshot', 'file', 'diff', 'test-output']);
const AX_WORK_STATUSES = new Set<PmxAxWorkItemStatus>(['todo', 'in-progress', 'blocked', 'done', 'cancelled']);
const AX_APPROVAL_STATUSES = new Set<PmxAxApprovalStatus>(['pending', 'approved', 'rejected']);
const AX_REVIEW_KINDS = new Set<PmxAxReviewKind>(['comment', 'finding']);
const AX_REVIEW_SEVERITIES = new Set<PmxAxReviewSeverity>(['info', 'warning', 'error']);
const AX_REVIEW_STATUSES = new Set<PmxAxReviewStatus>(['open', 'resolved', 'dismissed']);
const AX_REVIEW_ANCHORS = new Set<PmxAxReviewAnchorType>(['node', 'file', 'region']);

export function isAxEventKind(value: unknown): value is PmxAxEventKind {
  return typeof value === 'string' && AX_EVENT_KINDS.has(value as PmxAxEventKind);
}

export function isAxEvidenceKind(value: unknown): value is PmxAxEvidenceKind {
  return typeof value === 'string' && AX_EVIDENCE_KINDS.has(value as PmxAxEvidenceKind);
}

function nowIso(): string {
  return new Date().toISOString();
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function boundedRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function axId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyAxFocusState(): PmxAxFocusState {
  return {
    nodeIds: [],
    primaryNodeId: null,
    updatedAt: null,
    source: null,
  };
}

export function createEmptyAxState(): PmxAxState {
  return {
    version: 1,
    focus: createEmptyAxFocusState(),
    workItems: [],
    approvalGates: [],
    reviewAnnotations: [],
  };
}

export function createEmptyAxHostCapability(): PmxAxHostCapability {
  return {
    host: null,
    canvas: false,
    hooks: false,
    tools: false,
    sessionMessaging: false,
    permissions: false,
    files: false,
    uiPrompts: false,
    reportedAt: null,
    raw: null,
  };
}

export function normalizeAxFocusState(input: unknown, validNodeIds?: Set<string>): PmxAxFocusState {
  if (!isRecord(input)) return createEmptyAxFocusState();
  const nodeIds = normalizeNodeIds(input.nodeIds, validNodeIds);
  const primaryNodeId = typeof input.primaryNodeId === 'string' && nodeIds.includes(input.primaryNodeId)
    ? input.primaryNodeId
    : nodeIds[0] ?? null;
  return {
    nodeIds,
    primaryNodeId,
    updatedAt: normalizeTimestamp(input.updatedAt),
    source: normalizeSource(input.source),
  };
}

// ── Canvas-bound normalizers (drop on missing id) ──────────────────
export function normalizeAxWorkItem(input: unknown, validNodeIds?: Set<string>): PmxAxWorkItem | null {
  if (!isRecord(input) || typeof input.id !== 'string') return null;
  const createdAt = normalizeTimestamp(input.createdAt) ?? nowIso();
  return {
    id: input.id,
    title: typeof input.title === 'string' ? input.title : '(untitled)',
    status: AX_WORK_STATUSES.has(input.status as PmxAxWorkItemStatus) ? input.status as PmxAxWorkItemStatus : 'todo',
    detail: optionalString(input.detail),
    nodeIds: normalizeNodeIds(input.nodeIds, validNodeIds),
    createdAt,
    updatedAt: normalizeTimestamp(input.updatedAt) ?? createdAt,
    source: normalizeSource(input.source),
  };
}

export function normalizeAxApprovalGate(input: unknown, validNodeIds?: Set<string>): PmxAxApprovalGate | null {
  if (!isRecord(input) || typeof input.id !== 'string') return null;
  return {
    id: input.id,
    title: typeof input.title === 'string' ? input.title : '(approval)',
    detail: optionalString(input.detail),
    action: optionalString(input.action),
    status: AX_APPROVAL_STATUSES.has(input.status as PmxAxApprovalStatus) ? input.status as PmxAxApprovalStatus : 'pending',
    nodeIds: normalizeNodeIds(input.nodeIds, validNodeIds),
    createdAt: normalizeTimestamp(input.createdAt) ?? nowIso(),
    resolvedAt: normalizeTimestamp(input.resolvedAt),
    resolution: optionalString(input.resolution),
    source: normalizeSource(input.source),
  };
}

export function normalizeAxReviewAnnotation(input: unknown, validNodeIds?: Set<string>): PmxAxReviewAnnotation | null {
  if (!isRecord(input) || typeof input.id !== 'string') return null;
  const createdAt = normalizeTimestamp(input.createdAt) ?? nowIso();
  const anchorType = AX_REVIEW_ANCHORS.has(input.anchorType as PmxAxReviewAnchorType) ? input.anchorType as PmxAxReviewAnchorType : 'node';
  // node anchor pruned to a valid node; if invalid, drop the whole annotation (mirrors focus pruning)
  let nodeId: string | null = null;
  if (anchorType === 'node') {
    if (typeof input.nodeId !== 'string') return null;
    if (validNodeIds && !validNodeIds.has(input.nodeId)) return null;
    nodeId = input.nodeId;
  }
  const region = isRecord(input.region) ? {
    ...(typeof input.region.line === 'number' ? { line: input.region.line } : {}),
    ...(typeof input.region.endLine === 'number' ? { endLine: input.region.endLine } : {}),
    ...(typeof input.region.label === 'string' ? { label: input.region.label } : {}),
  } : null;
  return {
    id: input.id,
    kind: AX_REVIEW_KINDS.has(input.kind as PmxAxReviewKind) ? input.kind as PmxAxReviewKind : 'comment',
    body: typeof input.body === 'string' ? input.body : '',
    severity: AX_REVIEW_SEVERITIES.has(input.severity as PmxAxReviewSeverity) ? input.severity as PmxAxReviewSeverity : 'info',
    status: AX_REVIEW_STATUSES.has(input.status as PmxAxReviewStatus) ? input.status as PmxAxReviewStatus : 'open',
    anchorType,
    nodeId,
    file: anchorType === 'file' ? optionalString(input.file) : null,
    region: anchorType === 'region' ? region : null,
    author: optionalString(input.author),
    createdAt,
    updatedAt: normalizeTimestamp(input.updatedAt) ?? createdAt,
    source: normalizeSource(input.source),
  };
}

export function normalizeAxHostCapability(input: unknown): PmxAxHostCapability | null {
  if (!isRecord(input)) return null;
  const caps = isRecord(input.capabilities) ? input.capabilities : input;
  const flag = (v: unknown): boolean => v === true;
  return {
    host: optionalString(input.host),
    canvas: flag(caps.canvas),
    hooks: flag(caps.hooks),
    tools: flag(caps.tools),
    sessionMessaging: flag(caps.sessionMessaging),
    permissions: flag(caps.permissions),
    files: flag(caps.files),
    uiPrompts: flag(caps.uiPrompts),
    reportedAt: normalizeTimestamp(input.reportedAt),
    raw: boundedRecord(input.raw),
  };
}

// ── Timeline normalizers (DB row parse; node ids kept as recorded) ──
export function normalizeAxEvent(input: unknown): PmxAxEvent | null {
  if (!isRecord(input) || typeof input.id !== 'string') return null;
  const kind = AX_EVENT_KINDS.has(input.kind as PmxAxEventKind) ? input.kind as PmxAxEventKind : null;
  if (!kind) return null;
  return {
    id: input.id,
    seq: typeof input.seq === 'number' ? input.seq : 0,
    kind,
    summary: typeof input.summary === 'string' ? input.summary : '',
    detail: optionalString(input.detail),
    nodeIds: normalizeNodeIds(input.nodeIds),
    data: boundedRecord(input.data),
    createdAt: normalizeTimestamp(input.createdAt) ?? nowIso(),
    source: normalizeSource(input.source),
  };
}

export function normalizeAxEvidence(input: unknown): PmxAxEvidence | null {
  if (!isRecord(input) || typeof input.id !== 'string') return null;
  const kind = AX_EVIDENCE_KINDS.has(input.kind as PmxAxEvidenceKind) ? input.kind as PmxAxEvidenceKind : null;
  if (!kind) return null;
  return {
    id: input.id,
    seq: typeof input.seq === 'number' ? input.seq : 0,
    kind,
    title: typeof input.title === 'string' ? input.title : '',
    body: typeof input.body === 'string' ? input.body : null,
    ref: optionalString(input.ref),
    nodeIds: normalizeNodeIds(input.nodeIds),
    data: boundedRecord(input.data),
    createdAt: normalizeTimestamp(input.createdAt) ?? nowIso(),
    source: normalizeSource(input.source),
  };
}

export function normalizeAxSteeringMessage(input: unknown): PmxAxSteeringMessage | null {
  if (!isRecord(input) || typeof input.id !== 'string' || typeof input.message !== 'string') return null;
  return {
    id: input.id,
    seq: typeof input.seq === 'number' ? input.seq : 0,
    message: input.message,
    delivered: input.delivered === true,
    createdAt: normalizeTimestamp(input.createdAt) ?? nowIso(),
    source: normalizeSource(input.source),
  };
}

// ── Factories ──────────────────────────────────────────────────────
export function createAxWorkItem(
  input: { title: string; status?: PmxAxWorkItemStatus; detail?: string | null; nodeIds?: string[] },
  source: PmxAxSource | null,
  validNodeIds?: Set<string>,
): PmxAxWorkItem {
  const now = nowIso();
  return {
    id: axId('work'),
    title: input.title,
    status: input.status ?? 'todo',
    detail: input.detail ?? null,
    nodeIds: normalizeNodeIds(input.nodeIds, validNodeIds),
    createdAt: now,
    updatedAt: now,
    source,
  };
}

export function createAxApprovalGate(
  input: { title: string; detail?: string | null; action?: string | null; nodeIds?: string[] },
  source: PmxAxSource | null,
  validNodeIds?: Set<string>,
): PmxAxApprovalGate {
  return {
    id: axId('appr'),
    title: input.title,
    detail: input.detail ?? null,
    action: input.action ?? null,
    status: 'pending',
    nodeIds: normalizeNodeIds(input.nodeIds, validNodeIds),
    createdAt: nowIso(),
    resolvedAt: null,
    resolution: null,
    source,
  };
}

export function createAxReviewAnnotation(
  input: {
    body: string;
    kind?: PmxAxReviewKind;
    severity?: PmxAxReviewSeverity;
    anchorType?: PmxAxReviewAnchorType;
    nodeId?: string | null;
    file?: string | null;
    region?: PmxAxReviewRegion | null;
    author?: string | null;
  },
  source: PmxAxSource | null,
): PmxAxReviewAnnotation {
  const now = nowIso();
  const anchorType = input.anchorType ?? 'node';
  return {
    id: axId('rev'),
    kind: input.kind ?? 'comment',
    body: input.body,
    severity: input.severity ?? 'info',
    status: 'open',
    anchorType,
    nodeId: anchorType === 'node' ? (input.nodeId ?? null) : null,
    file: anchorType === 'file' ? (input.file ?? null) : null,
    region: anchorType === 'region' ? (input.region ?? null) : null,
    author: input.author ?? null,
    createdAt: now,
    updatedAt: now,
    source,
  };
}

export function createAxEvent(
  input: { kind: PmxAxEventKind; summary: string; detail?: string | null; nodeIds?: string[]; data?: Record<string, unknown> | null },
  source: PmxAxSource | null,
): Omit<PmxAxEvent, 'seq'> {
  return {
    id: axId('evt'),
    kind: input.kind,
    summary: input.summary,
    detail: input.detail ?? null,
    nodeIds: normalizeNodeIds(input.nodeIds),
    data: input.data ?? null,
    createdAt: nowIso(),
    source,
  };
}

export function createAxEvidence(
  input: { kind: PmxAxEvidenceKind; title: string; body?: string | null; ref?: string | null; nodeIds?: string[]; data?: Record<string, unknown> | null },
  source: PmxAxSource | null,
): Omit<PmxAxEvidence, 'seq'> {
  return {
    id: axId('evd'),
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    ref: input.ref ?? null,
    nodeIds: normalizeNodeIds(input.nodeIds),
    data: input.data ?? null,
    createdAt: nowIso(),
    source,
  };
}

export function createAxSteeringMessage(message: string, source: PmxAxSource | null): Omit<PmxAxSteeringMessage, 'seq'> {
  return {
    id: axId('steer'),
    message,
    delivered: false,
    createdAt: nowIso(),
    source,
  };
}

export function normalizeAxState(input: unknown, validNodeIds?: Set<string>): PmxAxState {
  if (!isRecord(input)) return createEmptyAxState();
  return {
    version: 1,
    focus: normalizeAxFocusState(input.focus, validNodeIds),
    workItems: Array.isArray(input.workItems)
      ? input.workItems.map((w) => normalizeAxWorkItem(w, validNodeIds)).filter((w): w is PmxAxWorkItem => w !== null)
      : [],
    approvalGates: Array.isArray(input.approvalGates)
      ? input.approvalGates.map((g) => normalizeAxApprovalGate(g, validNodeIds)).filter((g): g is PmxAxApprovalGate => g !== null)
      : [],
    reviewAnnotations: Array.isArray(input.reviewAnnotations)
      ? input.reviewAnnotations.map((r) => normalizeAxReviewAnnotation(r, validNodeIds)).filter((r): r is PmxAxReviewAnnotation => r !== null)
      : [],
  };
}

export function buildAxContext(input: {
  layout: CanvasLayout;
  pinned: PmxAxPinnedContext;
  focus: PmxAxFocusState;
  focusNodes: AgentContextNode[];
  workItems: PmxAxWorkItem[];
  approvalGates: PmxAxApprovalGate[];
  reviewAnnotations: PmxAxReviewAnnotation[];
  timeline: PmxAxTimelineSummary;
  host: PmxAxHostCapability | null;
}): PmxAxContext {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    surface: {
      nodeCount: input.layout.nodes.length,
      edgeCount: input.layout.edges.length,
    },
    pinned: input.pinned,
    focus: {
      ...input.focus,
      nodes: input.focusNodes,
    },
    workItems: input.workItems,
    approvalGates: input.approvalGates,
    reviewAnnotations: input.reviewAnnotations,
    timeline: input.timeline,
    host: input.host,
  };
}

export function nodeSetFromLayout(nodes: CanvasNodeState[]): Set<string> {
  return new Set(nodes.map((node) => node.id));
}
