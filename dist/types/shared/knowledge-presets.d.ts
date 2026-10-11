import type { KnowledgeCategory } from '../server/knowledge-lifecycle.js';
/** Editable starter data. No runtime behavior depends on these names or ids. */
export declare const KNOWLEDGE_PRESETS: Record<string, {
    categories: KnowledgeCategory[];
    folders: Record<string, string>;
}>;
