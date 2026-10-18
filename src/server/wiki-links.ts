import { Marked, type Token, type Tokens } from 'marked';
import type { MemoryTarget, WikiLink } from '../shared/memory-graph.js';

interface WikiToken extends Tokens.Generic {
  type: 'wiki';
  ref: string;
  label: string;
}

function wiki(token: Token): token is WikiToken {
  return token.type === 'wiki';
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]!,
  );

// Same language as Marked 15's blockSkip, with ordinary destination characters
// consumed in runs instead of one regex iteration per byte of an inline image.
const blockSkip = /\[[^[\]]*?\]\([^\\()]*(?:\\.[^\\()]*|\([^\\()]*(?:\\.[^\\()]*)*\)[^\\()]*)*\)|`[^`]*?`|<[^<>]*?>/g;

/** Marked's inline tokenizer keeps wiki syntax out of code spans/fences and HTML attributes. */
function parser(render: (token: WikiToken) => string): Marked {
  return new Marked(
    { gfm: true, breaks: true },
    {
      tokenizer: {
        space() {
          // Lexer installs rules after constructing the tokenizer. Copy rather
          // than mutating shared rules, before it queues inline parsing.
          this.rules.inline = { ...this.rules.inline, blockSkip };
          return false;
        },
        lheading(src) {
          // Setext headings cannot cross a blank line. Avoid Marked 15's costly
          // unmatched long-line regex unless a possible underline is present.
          const blank = /\n\s*?\n/.exec(src);
          const paragraph = blank ? src.slice(0, blank.index + 1) : src;
          if (!/\n {0,3}(?:=+|-+) *(?:\n|$)/.test(paragraph)) return undefined;
          return false;
        },
      },
      extensions: [
        {
          name: 'wiki',
          level: 'inline',
          start: (src) => src.indexOf('[['),
          tokenizer(src) {
            const match = /^\[\[([^\]\n]+)\]\]/.exec(src);
            if (!match) return undefined;
            const [ref, ...alias] = match[1].split('|');
            if (!ref.trim()) return undefined;
            return { type: 'wiki', raw: match[0], ref: ref.trim(), label: alias.join('|').trim() || ref.trim() };
          },
          renderer: (token) => (wiki(token) ? render(token) : false),
        },
      ],
    },
  );
}

export function wikiReferences(content: string): string[] {
  const marked = parser(() => '');
  const refs = new Set<string>();
  marked.walkTokens(marked.lexer(content), (token) => {
    if (wiki(token)) refs.add(token.ref);
  });
  return [...refs];
}

export interface WikiBoard {
  id: string;
  name: string;
  cards: Array<{ id: string; title: string }>;
}

/** IDs win over names; title matches must be unique. Never retarget an already bound link. */
export function resolveWikiLinks(content: string, previous: WikiLink[], boards: WikiBoard[]): WikiLink[] {
  const resolve = (ref: string): MemoryTarget | undefined => {
    const separator = ref.indexOf('#');
    const boardName = (separator < 0 ? ref : ref.slice(0, separator)).trim();
    const cardName = separator < 0 ? null : ref.slice(separator + 1).trim();
    const exact = boards.find((board) => board.id === boardName);
    const matches = exact
      ? [exact]
      : boards.filter((board) => board.name.toLocaleLowerCase() === boardName.toLocaleLowerCase());
    if (matches.length !== 1) return undefined;
    const board = matches[0];
    if (cardName === null) return { boardId: board.id };
    const exactCard = board.cards.find((card) => card.id === cardName);
    const cards = exactCard
      ? [exactCard]
      : board.cards.filter((card) => card.title.toLocaleLowerCase() === cardName.toLocaleLowerCase());
    return cards.length === 1 ? { boardId: board.id, cardId: cards[0].id } : undefined;
  };
  return wikiReferences(content).map((ref) => {
    const target = previous.find((link) => link.ref === ref)?.target ?? resolve(ref);
    return { ref, ...(target ? { target } : {}) };
  });
}

/** Only server-owned bindings may navigate; the client still sanitizes rendered HTML. */
export function renderWikiMarkdown(
  content: string,
  links: WikiLink[],
  exists: (target: MemoryTarget) => boolean,
): string {
  return parser((token) => {
    const target = links.find((link) => link.ref === token.ref)?.target;
    const attributes =
      target && exists(target)
        ? `data-wiki-board="${escapeHtml(target.boardId)}"${target.cardId ? ` data-wiki-card="${escapeHtml(target.cardId)}"` : ''}`
        : target
          ? 'data-wiki-missing="true"'
          : '';
    return `<a href="#" class="wiki-link${target && exists(target) ? '' : ' is-unresolved'}" ${attributes} data-wiki-ref="${escapeHtml(token.ref)}" data-wiki-markdown="${escapeHtml(token.raw)}" data-wiki-label="${escapeHtml(token.label)}">${escapeHtml(token.label)}</a>`;
  }).parse(content) as string;
}
