import { z } from 'zod';

export const relationKindSchema = z.string().trim().min(1).max(80);
export const relationReasonSchema = z.string().trim().max(4000);
export const relationDefinitionSchema = z.strictObject({
  kind: relationKindSchema,
  ink: z.enum(['supports', 'contradicts', 'cites', 'derived', 'informs', 'related']),
  directed: z.boolean(),
});
export const relationVocabularySchema = z
  .array(relationDefinitionSchema)
  .max(64)
  .refine(
    (values) => new Set(values.map((value) => value.kind)).size === values.length,
    'Relation kinds must be unique.',
  );
export type RelationDefinition = z.infer<typeof relationDefinitionSchema>;
export const relationPresetSchema = z.strictObject({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(80),
  vocabulary: relationVocabularySchema,
});
export type RelationPreset = z.infer<typeof relationPresetSchema>;

export const RELATION_KINDS: RelationDefinition[] = [
  { kind: 'supports', ink: 'supports', directed: true },
  { kind: 'contradicts', ink: 'contradicts', directed: true },
  { kind: 'cites', ink: 'cites', directed: true },
  { kind: 'derived-from', ink: 'derived', directed: true },
  { kind: 'answers', ink: 'informs', directed: true },
  { kind: 'depends-on', ink: 'informs', directed: true },
  { kind: 'supersedes', ink: 'informs', directed: true },
  { kind: 'flow', ink: 'derived', directed: true },
  { kind: 'related', ink: 'related', directed: false },
];

export const RELATION_PRESETS: Record<string, RelationDefinition[]> = {
  Research: RELATION_KINDS.filter((item) =>
    ['supports', 'contradicts', 'cites', 'derived-from', 'related'].includes(item.kind),
  ),
  Dependencies: RELATION_KINDS.filter((item) => ['depends-on', 'related'].includes(item.kind)),
  Decision: [
    { kind: 'option', ink: 'derived', directed: true },
    { kind: 'if', ink: 'cites', directed: true },
    { kind: 'rejected', ink: 'related', directed: true },
    { kind: 'supersedes', ink: 'informs', directed: true },
  ],
  Flow: [
    { kind: 'next', ink: 'derived', directed: true },
    { kind: 'if-fails', ink: 'contradicts', directed: true },
    { kind: 'loop', ink: 'related', directed: true },
  ],
};

export function relationPreset(vocabulary: RelationDefinition[] = []): string | null {
  return (
    Object.entries(RELATION_PRESETS).find(
      ([, preset]) =>
        preset.length === vocabulary.length &&
        preset.every((item) =>
          vocabulary.some(
            (entry) => entry.kind === item.kind && entry.ink === item.ink && entry.directed === item.directed,
          ),
        ),
    )?.[0] ?? null
  );
}

export function relationKind(edge: { kind?: string; type?: string }): string {
  return (
    edge.kind ??
    (edge.type === 'relation' ? 'related' : edge.type === 'references' ? 'cites' : (edge.type ?? 'related'))
  );
}

/** Direction is semantic, not inferred from ink or arrow decoration. */
export function relationSourceEnd(edge: { kind?: string; type?: string }): 'from' | 'to' | null {
  const kind = relationKind(edge);
  if (kind === 'depends-on') return 'to';
  if (['derived-from', 'contradicts', 'supersedes'].includes(kind)) return 'from';
  return null;
}

export function relationDefinition(
  edge: { kind?: string; type?: string },
  vocabulary: RelationDefinition[] = [],
): RelationDefinition {
  const kind = relationKind(edge);
  return (
    vocabulary.find((item) => item.kind === kind) ??
    RELATION_KINDS.find((item) => item.kind === kind) ?? { kind, ink: 'related', directed: true }
  );
}

/** Keep the authored label and the explanation, rather than treating a label as a kind. */
export function relationText(edge: { kind?: string; type?: string; label?: string | null; reason?: string }): string {
  return `${edge.kind ?? edge.type ?? 'related'}${edge.label ? ` "${edge.label}"` : ''}${edge.reason ? ` (why: ${edge.reason})` : ''}`;
}
