import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import { normalizeBoardFolder } from '../shared/boards.js';
import { memoryKey, type MemoryTarget } from '../shared/memory-graph.js';
import { currentActor, type ActorAttribution } from './attribution.js';
import { OperationError } from './operations/types.js';
import { CARD_HISTORY_CTE } from './card-relocation.js';
import type { LifecycleQualification } from '../shared/lifecycle-status.js';
import type { CanvasNodeState } from './canvas-state.js';
import { RELATION_PRESETS, relationPresetSchema, type RelationPreset } from '../shared/relations.js';
import {
  categorySchema,
  lifecycleSchema,
  type KnowledgeCategory,
  type Lifecycle,
} from '../shared/knowledge-lifecycle.js';

export {
  categorySchema,
  lifecycleSchema,
  type KnowledgeCategory,
  type Lifecycle,
} from '../shared/knowledge-lifecycle.js';

export interface ReviewCardSummary {
  boardId: string;
  cardId: string;
  boardTitle: string;
  folder: string | null;
  title: string;
}
export const folderPropertiesSchema = z.object({
  path: z.string(),
  categoryId: z.string().nullable(),
  lifecycleOverride: lifecycleSchema.nullable(),
});
export type FolderProperties = z.infer<typeof folderPropertiesSchema>;
export interface ReviewRecord {
  id: string;
  boardId: string;
  nodeId: string;
  outcome: 'retain' | 'revise' | 'externalize' | 'retire' | 'unresolved' | 'restore';
  evidence: string;
  applied: boolean;
  who: ActorAttribution;
  when: string;
  /** Exact semantic version reviewed; old unversioned records remain unknown. */
  contentRevision: number | null;
  sourceRevisions?: Record<string, number | null>;
}

// SQLite trim defaults to ASCII space; match JavaScript evidence.trim(), including Unicode whitespace.
const evidenceWhitespace =
  '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
const validationPredicate = `json_extract(value, '$.applied') = 1
  AND json_extract(value, '$.outcome') IN ('retain', 'revise', 'externalize')
  AND trim(json_extract(value, '$.evidence'), '${evidenceWhitespace}') <> ''`;
const retirementPredicate = `(json_extract(value, '$.outcome') = 'restore'
  OR (json_extract(value, '$.applied') = 1 AND json_extract(value, '$.outcome') = 'retire'))`;
const indexedDatabases = new WeakSet<Database>();

export type KnowledgeInput =
  | { action: 'list' }
  | { action: 'category-set'; category: KnowledgeCategory }
  | { action: 'category-remove'; id: string }
  | { action: 'relation-preset-set'; preset: RelationPreset }
  | { action: 'relation-preset-remove'; id: string }
  | ({ action: 'folder-set' } & FolderProperties);
export interface KnowledgeResults {
  list: {
    ok: true;
    categories: KnowledgeCategory[];
    folders: FolderProperties[];
    relationPresets: RelationPreset[];
    cards: Record<string, LifecycleQualification>;
    reviewCards: ReviewCardSummary[];
    resolvedFolders: Record<string, ReturnType<KnowledgeLifecycle['resolve']>>;
  };
  'category-set': { ok: true; category: KnowledgeCategory };
  'category-remove': { ok: true; id: string };
  'relation-preset-set': { ok: true; preset: RelationPreset };
  'relation-preset-remove': { ok: true; id: string };
  'folder-set': { ok: true; folder: FolderProperties };
}
export type LifecycleInput =
  | { action: 'get'; id: string; board?: string }
  | { action: 'set'; id: string; expectedBoardId?: string | null; lifecycleOverride: Lifecycle | null }
  | {
      action: 'review';
      id: string;
      expectedBoardId?: string | null;
      outcome: Exclude<ReviewRecord['outcome'], 'restore'>;
      evidence: string;
      applied: boolean;
      expectedContentRevision?: number;
      expectedSources?: Record<string, number | null>;
    }
  | { action: 'restore'; id: string; expectedBoardId?: string | null; evidence: string };
export interface LifecycleResults {
  get: {
    ok: true;
    boardId: string;
    nodeId: string;
    contentRevision: number;
    qualification: LifecycleQualification;
  } & ReturnType<KnowledgeLifecycle['resolve']> &
    ReturnType<KnowledgeLifecycle['reviews']>;
  set: { ok: true };
  review: { ok: true; record: ReviewRecord };
  restore: { ok: true; record: ReviewRecord };
}

/** Workspace-owned data, deliberately outside board snapshots and read clocks. */
export class KnowledgeLifecycle {
  constructor(
    private readonly getDb: () => Database | null,
    private readonly changed: () => void,
    private readonly getContentRevision: (boardId: string, nodeId: string) => number,
    private readonly flush: () => void,
  ) {}

  private db(): Database {
    const db = this.getDb();
    if (!db) throw new Error('Knowledge lifecycle requires a workspace database.');
    return db;
  }

  list(): { categories: KnowledgeCategory[]; folders: FolderProperties[]; relationPresets: RelationPreset[] } {
    const db = this.db();
    const read = <T>(table: string): T[] =>
      (db.query(`SELECT value FROM ${table} ORDER BY 1`).all() as { value: string }[]).map((r) => JSON.parse(r.value));
    const stored = db.query("SELECT value FROM meta WHERE key = 'relation-presets'").get() as { value: string } | null;
    const relationPresets: RelationPreset[] = stored
      ? JSON.parse(stored.value)
      : Object.entries(RELATION_PRESETS).map(([name, vocabulary]) => ({
          id: name,
          name,
          vocabulary: structuredClone(vocabulary),
        }));
    return { categories: read('knowledge_categories'), folders: read('folder_properties'), relationPresets };
  }

  setRelationPreset(value: RelationPreset): RelationPreset {
    const preset = relationPresetSchema.parse(value);
    const presets = this.list().relationPresets;
    if (presets.some((item) => item.id !== preset.id && item.name === preset.name))
      throw new OperationError('Relation preset names must be unique.', 409);
    const index = presets.findIndex((item) => item.id === preset.id);
    if (index < 0) presets.push(preset);
    else presets[index] = preset;
    this.db()
      .query('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
      .run('relation-presets', JSON.stringify(presets));
    this.changed();
    return preset;
  }

  removeRelationPreset(id: string): string {
    const presets = this.list().relationPresets;
    if (!presets.some((preset) => preset.id === id)) throw new OperationError('Unknown relation preset.', 404);
    this.db()
      .query('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
      .run('relation-presets', JSON.stringify(presets.filter((preset) => preset.id !== id)));
    this.changed();
    return id;
  }

  setCategory(value: KnowledgeCategory): KnowledgeCategory {
    const category = categorySchema.parse(value);
    this.db()
      .query('INSERT OR REPLACE INTO knowledge_categories VALUES (?, ?)')
      .run(category.id, JSON.stringify(category));
    this.changed();
    return category;
  }

  removeCategory(id: string): string {
    const catalog = this.list();
    if (!catalog.categories.some((category) => category.id === id))
      throw new OperationError(`Unknown knowledge category: ${id}.`, 404);
    const folders = catalog.folders.filter((folder) => folder.categoryId === id);
    if (folders.length)
      throw new OperationError(
        `Category is assigned to folders: ${folders.map((folder) => folder.path).join(', ')}. Reassign or clear these folder categories before deleting it. Empty folders also count.`,
        409,
      );
    this.db().query('DELETE FROM knowledge_categories WHERE id = ?').run(id);
    this.changed();
    return id;
  }

  setFolder(value: FolderProperties): FolderProperties {
    const path = normalizeBoardFolder(value.path);
    if (!path) throw new Error('A folder path is required.');
    if (value.categoryId !== null && !this.list().categories.some((c) => c.id === value.categoryId)) {
      throw new Error('Unknown knowledge category.');
    }
    const folder = {
      path,
      categoryId: value.categoryId,
      lifecycleOverride: value.lifecycleOverride === null ? null : lifecycleSchema.parse(value.lifecycleOverride),
    };
    this.db().query('INSERT OR REPLACE INTO folder_properties VALUES (?, ?)').run(path, JSON.stringify(folder));
    this.changed();
    return folder;
  }

  resolve(folderPath: string | null, override?: Lifecycle | null, catalog = this.list()) {
    const { categories, folders } = catalog;
    let category: KnowledgeCategory | null = null;
    let categorySourceFolder: string | null = null;
    let lifecycle: Lifecycle | null = null;
    let lifecycleSourceFolder: string | null = null;
    const parts = normalizeBoardFolder(folderPath)?.split('/') ?? [];
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join('/');
      const properties = folders.find((f) => f.path === path);
      if (!properties) continue;
      if (properties.categoryId !== null) {
        category = categories.find((c) => c.id === properties.categoryId) ?? null;
        categorySourceFolder = category ? path : null;
        lifecycle = category
          ? {
              decayType: category.decayType,
              rate: category.rate,
              triggers: category.triggers,
              revalidationMethod: category.revalidationMethod,
              ...(category.cadenceDays ? { cadenceDays: category.cadenceDays } : {}),
            }
          : null;
        lifecycleSourceFolder = category ? path : null;
      }
      if (properties.lifecycleOverride) {
        lifecycle = properties.lifecycleOverride;
        lifecycleSourceFolder = path;
      }
    }
    return {
      category,
      categorySourceFolder,
      lifecycle: override ?? lifecycle,
      lifecycleSourceFolder: override ? null : lifecycleSourceFolder,
      lifecycleSource: override ? ('card' as const) : lifecycle ? ('folder' as const) : ('unknown' as const),
    };
  }

  resolveCard(folderPath: string | null, node: Pick<CanvasNodeState, 'type' | 'data'>, catalog = this.list()) {
    const resolved = this.resolve(folderPath, node.data.lifecycleOverride as Lifecycle | null, catalog);
    if ((node.type === 'group' || node.type === 'board') && !node.data.lifecycleOverride) {
      return { ...resolved, lifecycle: null, lifecycleSource: 'unknown' as const, lifecycleSourceFolder: null };
    }
    return resolved;
  }

  private indexedDb(): Database {
    const db = this.db();
    if (!indexedDatabases.has(db)) {
      db.exec(`CREATE INDEX IF NOT EXISTS review_latest_validation ON review_records
        (board_id, node_id, sequence DESC) WHERE ${validationPredicate};
        CREATE INDEX IF NOT EXISTS review_latest_retirement ON review_records
        (board_id, node_id, sequence DESC) WHERE ${retirementPredicate};
        CREATE INDEX IF NOT EXISTS lifecycle_incoming_sources ON edges (to_board_id, to_node)
        WHERE COALESCE(kind, type) IN ('derived-from', 'contradicts', 'supersedes');`);
      indexedDatabases.add(db);
    }
    return db;
  }

  /** Stored owners of semantic sources; the caller overlays the active board's unsaved edges. */
  incomingSourceBoards(target: MemoryTarget, activeBoardId: string | null): string[] {
    return this.indexedDb()
      .query<{ board_id: string }, [string, string | null, string | null]>(
        `SELECT DISTINCT board_id FROM edges WHERE to_board_id = ? AND to_node = ?
       AND board_id IS NOT ? AND COALESCE(kind, type) IN ('derived-from', 'contradicts', 'supersedes')`,
      )
      .all(target.boardId, target.cardId ?? null, activeBoardId)
      .map((row) => row.board_id);
  }

  /** One indexed latest validation and retirement per card, never its full audit history. */
  reviewSummaries(targets: MemoryTarget[]): Map<string, { lastValidation: ReviewRecord | null; retired: boolean }> {
    if (!targets.length) return new Map();
    const rows = this.indexedDb()
      .query<{ boardId: string; nodeId: string; validation: string | null; retirement: string | null }, [string]>(
        `${CARD_HISTORY_CTE}
       SELECT t.current_board AS boardId, t.node_id AS nodeId,
         (SELECT value FROM review_records r JOIN history h
          ON r.board_id = h.board_id AND r.node_id = h.node_id
          AND r.sequence > h.review_after AND r.sequence <= h.review_through
          WHERE h.current_board = t.current_board AND h.node_id = t.node_id
          AND ${validationPredicate} ORDER BY sequence DESC LIMIT 1) AS validation,
         (SELECT json_extract(value, '$.outcome') FROM review_records r JOIN history h
          ON r.board_id = h.board_id AND r.node_id = h.node_id
          AND r.sequence > h.review_after AND r.sequence <= h.review_through
          WHERE h.current_board = t.current_board AND h.node_id = t.node_id
          AND ${retirementPredicate} ORDER BY sequence DESC LIMIT 1) AS retirement
       FROM targets t`,
      )
      .all(JSON.stringify(targets));
    return new Map(
      rows.map((row) => {
        const record: ReviewRecord | null = row.validation ? JSON.parse(row.validation) : null;
        return [
          memoryKey({ boardId: row.boardId, cardId: row.nodeId }),
          {
            lastValidation: record ? { ...record, contentRevision: record.contentRevision ?? null } : null,
            retired: row.retirement === 'retire',
          },
        ];
      }),
    );
  }

  /** Resolve a current card's location when evidence was recorded, without rewriting that evidence. */
  locationAtReview(review: ReviewRecord, target: MemoryTarget): MemoryTarget {
    const sequence = this.db()
      .query<{ sequence: number }, [string, string, string]>(
        "SELECT sequence FROM review_records WHERE board_id = ? AND node_id = ? AND json_extract(value, '$.id') = ?",
      )
      .get(review.boardId, review.nodeId, review.id)?.sequence;
    if (sequence === undefined) return target;
    const location = this.db()
      .query<{ board_id: string }, [string, number, number]>(
        `${CARD_HISTORY_CTE} SELECT board_id FROM history WHERE review_after < ? AND review_through >= ? LIMIT 1`,
      )
      .get(JSON.stringify([target]), sequence, sequence);
    return location ? { ...target, boardId: location.board_id } : target;
  }

  reviews(boardId: string, nodeId: string) {
    const records = (
      this.db()
        .query(`${CARD_HISTORY_CTE} SELECT value FROM review_records r JOIN history h
          ON r.board_id = h.board_id AND r.node_id = h.node_id
          AND r.sequence > h.review_after AND r.sequence <= h.review_through ORDER BY sequence`)
        .all(JSON.stringify([{ boardId, cardId: nodeId }])) as { value: string }[]
    ).map((r): ReviewRecord => {
      const record = JSON.parse(r.value) as ReviewRecord;
      return { ...record, contentRevision: record.contentRevision ?? null };
    });
    let retired = false;
    let lastValidation: ReviewRecord | null = null;
    for (const record of records) {
      if (record.applied && record.outcome === 'retire') retired = true;
      if (record.outcome === 'restore') retired = false;
      if (record.applied && record.evidence.trim() && ['retain', 'revise', 'externalize'].includes(record.outcome))
        lastValidation = record;
    }
    return { records, retired, lastValidation };
  }

  record(
    boardId: string,
    nodeId: string,
    input: Pick<ReviewRecord, 'outcome' | 'evidence' | 'applied'> & { expectedContentRevision?: number },
    sourceRevisions?: Record<string, number | null>,
  ): ReviewRecord {
    const validated = z
      .object({
        outcome: z.enum(['retain', 'revise', 'externalize', 'retire', 'unresolved', 'restore']),
        evidence: z.string(),
        applied: z.boolean(),
        expectedContentRevision: z.number().int().nonnegative().optional(),
      })
      .parse(input);
    if (validated.outcome === 'restore' && !validated.applied) throw new Error('Restore must be explicitly applied.');
    const { expectedContentRevision, ...outcome } = validated;
    const contentRevision = this.getContentRevision(boardId, nodeId);
    const validates =
      outcome.applied && outcome.evidence.trim() && ['retain', 'revise', 'externalize'].includes(outcome.outcome);
    if (validates && expectedContentRevision === undefined)
      throw new OperationError('Validating reviews require expectedContentRevision from the content you checked.');
    if (expectedContentRevision !== undefined && expectedContentRevision !== contentRevision)
      throw new OperationError('This card changed. Check its current content before recording your review.', 409);
    // Do not persist evidence before the content it supports has successfully reached disk.
    this.flush();
    const record = {
      ...outcome,
      id: crypto.randomUUID(),
      boardId,
      nodeId,
      who: currentActor(),
      when: new Date().toISOString(),
      contentRevision,
      ...(sourceRevisions ? { sourceRevisions } : {}),
    };
    this.db()
      .query('INSERT INTO review_records (board_id, node_id, value) VALUES (?, ?, ?)')
      .run(boardId, nodeId, JSON.stringify(record));
    this.changed();
    return record;
  }
}
