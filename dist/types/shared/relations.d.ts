import { z } from 'zod';
export declare const relationKindSchema: z.ZodString;
export declare const relationReasonSchema: z.ZodString;
export declare const relationDefinitionSchema: z.ZodObject<{
    kind: z.ZodString;
    ink: z.ZodEnum<{
        supports: "supports";
        contradicts: "contradicts";
        cites: "cites";
        derived: "derived";
        informs: "informs";
        related: "related";
    }>;
    directed: z.ZodBoolean;
}, z.core.$strict>;
export declare const relationVocabularySchema: z.ZodArray<z.ZodObject<{
    kind: z.ZodString;
    ink: z.ZodEnum<{
        supports: "supports";
        contradicts: "contradicts";
        cites: "cites";
        derived: "derived";
        informs: "informs";
        related: "related";
    }>;
    directed: z.ZodBoolean;
}, z.core.$strict>>;
export type RelationDefinition = z.infer<typeof relationDefinitionSchema>;
export declare const RELATION_KINDS: RelationDefinition[];
export declare const RELATION_PRESETS: Record<string, RelationDefinition[]>;
export declare function relationPreset(vocabulary?: RelationDefinition[]): string | null;
export declare function relationKind(edge: {
    kind?: string;
    type?: string;
}): string;
/** Direction is semantic, not inferred from ink or arrow decoration. */
export declare function relationSourceEnd(edge: {
    kind?: string;
    type?: string;
}): 'from' | 'to' | null;
export declare function relationDefinition(edge: {
    kind?: string;
    type?: string;
}, vocabulary?: RelationDefinition[]): RelationDefinition;
/** Keep the authored label and the explanation, rather than treating a label as a kind. */
export declare function relationText(edge: {
    kind?: string;
    type?: string;
    label?: string | null;
    reason?: string;
}): string;
