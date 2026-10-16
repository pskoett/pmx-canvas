import { z } from 'zod';
/** The same policy contract validates workspace writes and browser drafts. */
export declare const lifecycleSchema: z.ZodObject<{
    decayType: z.ZodEnum<{
        reality: "reality";
        decision: "decision";
        dependency: "dependency";
        relevance: "relevance";
    }>;
    rate: z.ZodEnum<{
        fast: "fast";
        medium: "medium";
        slow: "slow";
        durable: "durable";
    }>;
    triggers: z.ZodArray<z.ZodString>;
    revalidationMethod: z.ZodString;
    cadenceDays: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const categorySchema: z.ZodObject<{
    decayType: z.ZodEnum<{
        reality: "reality";
        decision: "decision";
        dependency: "dependency";
        relevance: "relevance";
    }>;
    rate: z.ZodEnum<{
        fast: "fast";
        medium: "medium";
        slow: "slow";
        durable: "durable";
    }>;
    triggers: z.ZodArray<z.ZodString>;
    revalidationMethod: z.ZodString;
    cadenceDays: z.ZodOptional<z.ZodNumber>;
    id: z.ZodString;
    name: z.ZodString;
    glyph: z.ZodString;
}, z.core.$strict>;
export type Lifecycle = z.infer<typeof lifecycleSchema>;
export type KnowledgeCategory = z.infer<typeof categorySchema>;
