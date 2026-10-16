import { z } from 'zod';

/** The same policy contract validates workspace writes and browser drafts. */
export const lifecycleSchema = z
  .strictObject({
    decayType: z.enum(['reality', 'decision', 'dependency', 'relevance']),
    rate: z.enum(['fast', 'medium', 'slow', 'durable']),
    triggers: z.array(z.string().trim().min(1)),
    revalidationMethod: z.string().trim().min(1),
    cadenceDays: z.number().int().min(1).max(36500).optional(),
  })
  .refine((value) => value.rate !== 'medium' || value.cadenceDays !== undefined, {
    path: ['cadenceDays'],
    message: 'Medium lifecycle requires a cadence in days.',
  });
export const categorySchema = lifecycleSchema.safeExtend({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  glyph: z.string().trim().min(1),
});
export type Lifecycle = z.infer<typeof lifecycleSchema>;
export type KnowledgeCategory = z.infer<typeof categorySchema>;
