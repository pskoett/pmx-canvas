import type { KnowledgeCategory } from '../server/knowledge-lifecycle.js';

const category = (
  id: string,
  name: string,
  glyph: string,
  decayType: KnowledgeCategory['decayType'],
  rate: KnowledgeCategory['rate'],
  revalidationMethod: string,
): KnowledgeCategory => ({
  id,
  name,
  glyph,
  decayType,
  rate,
  revalidationMethod,
  triggers: [],
  ...(rate === 'medium' ? { cadenceDays: 90 } : {}),
});
const research = category(
  'research',
  'Research',
  '⌕',
  'reality',
  'medium',
  'Check the sources and conflicting evidence.',
);
const metric = category('metric', 'Metric', '▥', 'reality', 'fast', 'Re-read the source dashboard and compare.');
const decision = category(
  'decision',
  'Decision',
  '⚑',
  'decision',
  'durable',
  'Check for a superseding decision and changed dependencies.',
);
const notes = category('notes', 'Notes', '✎', 'relevance', 'slow', 'Check relevance to the resumed task.');

/** Editable starter data. No runtime behavior depends on these names or ids. */
export const KNOWLEDGE_PRESETS: Record<string, { categories: KnowledgeCategory[]; folders: Record<string, string> }> = {
  'Org · team · personal': {
    categories: [
      category('strategy', 'Strategy', '◎', 'relevance', 'slow', 'Check the current goals and decisions.'),
      category('policy', 'Policy', '◇', 'decision', 'slow', 'Check with the policy owner.'),
      decision,
      research,
      metric,
      notes,
    ],
    folders: {
      Org: 'strategy',
      'Org/Policies': 'policy',
      Team: 'research',
      'Team/Decisions': 'decision',
      'Team/Metrics': 'metric',
      Personal: 'notes',
    },
  },
  'Solo research': {
    categories: [
      category('question', 'Question', '?', 'relevance', 'slow', 'Check whether this question still matters.'),
      category('source', 'Source', '▤', 'reality', 'medium', 'Re-read the original source.'),
      category(
        'finding',
        'Finding',
        '◉',
        'dependency',
        'durable',
        'Compare the supporting and contradicting evidence.',
      ),
      category('note', 'Note', '✎', 'relevance', 'slow', 'Check relevance to the resumed task.'),
    ],
    folders: { Projects: 'question', 'Projects/Findings': 'finding', Sources: 'source', Notes: 'note' },
  },
  'Product team': {
    categories: [research, metric, decision, notes],
    folders: { Discovery: 'research', 'Discovery/Metrics': 'metric', Delivery: 'notes', Decisions: 'decision' },
  },
  Empty: { categories: [], folders: {} },
};
