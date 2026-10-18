import { describe, expect, test } from 'bun:test';
import { Marked } from 'marked';
import { renderWikiMarkdown, wikiReferences } from '../../src/server/wiki-links.ts';

describe('wiki Markdown images', () => {
  const image = `data:image/png;base64,${Buffer.alloc(825_000, 123).toString('base64')}`;
  const document = (src: string) =>
    [
      '# Picture',
      `![picture](${src} "Picture title")`,
      '[[Board|alias]]',
      'two lines\nwith **bold** and [a link](https://example.com)',
      'title\n---',
      '`[[code]]`',
      '```md\n[[fence]]\n```',
      '<span title="[[attribute]]">HTML</span>',
    ].join('\n\n');

  test('retains image bytes, titles, Markdown and wiki exclusions', () => {
    const markdown = document(image);
    expect(wikiReferences(markdown)).toEqual(['Board']);
    const rendered = renderWikiMarkdown(markdown, [], () => false);
    expect(rendered).toContain(`src="${image}" alt="picture" title="Picture title"`);
    const plain = new Marked({ gfm: true, breaks: true });
    expect(rendered.replace(/<a href="#" class="wiki-link[^>]*>alias<\/a>/, '[[Board|alias]]')).toBe(
      plain.parse(markdown, { async: false }),
    );
  });

  test('matches ordinary Markdown for headings and image destination punctuation', () => {
    const plain = new Marked({ gfm: true, breaks: true });
    for (const destination of ['cat.png', 'cat(one).png', 'cat\\(one\\).png', '<cat two.png>', 'a(b(c)).png']) {
      for (const title of ['', ' "a title"', " 'a title'", ' (a title)']) {
        const markdown = `**before ![alt](${destination}${title}) after**\n\nA\nB\n===\n\nC\n---`;
        expect(renderWikiMarkdown(markdown, [], () => false)).toBe(plain.parse(markdown, { async: false }));
      }
    }
    const markdown = '[[Board|alias]] [[Board]] [[Other]]';
    expect(wikiReferences(markdown)).toEqual(['Board', 'Other']);
    expect(renderWikiMarkdown(markdown, [{ ref: 'Board', target: { boardId: 'board-1' } }], () => true)).toContain(
      'data-wiki-board="board-1"',
    );
  });

  test('parses large inline images without disproportionate unmatched-heading work', () => {
    const elapsed = (src: string) => {
      const start = performance.now();
      expect(wikiReferences(document(src))).toEqual(['Board']);
      expect(renderWikiMarkdown(document(src), [], () => false)).toContain(`src="${src}"`);
      return performance.now() - start;
    };
    elapsed('/picture.png');
    const fileMs = elapsed('/picture.png');
    const dataMs = elapsed(image);
    // Generous allowance for linear parsing/copying of 1.1 MB; the old parser takes >1 s.
    expect(dataMs).toBeLessThan(Math.max(300, fileMs * 30));
  });
});
