# Wiki imports

Use this workflow for an authorized import of existing Markdown and assets into PMX Canvas.
It does not replace the human-consented PDF/Office attachment workflow or provide live sync.

## Choose boards by purpose

- Preserve useful source categories and folders, but choose boards by coherent topic or
  workflow. Neither one board per file nor one board per category is a general rule.
- A platform category might contain an overview board, a backlog board, and workshop boards.
  A social category might contain separate LinkedIn and research boards. Keep several boards
  in a category when they serve distinct purposes; merge thin boards when their cards belong together.
- Make independently actionable backlog items separate cards, retaining their nested details
  and section context. Keep an article or analysis together when splitting would lose its argument.
- Group related cards within a board. Preserve meaningful reading order, such as source
  priority horizons, rather than alphabetically sorting every section. Use the skill's README,
  arrangement and focus guidance to give each board a readable starting point.

## Preserve sources and stable targets

Work in an isolated workspace for a test import. Preserve an existing import before replacing
it, and leave source files unchanged unless editing them was requested. Record source paths,
source revision and the source-page/section → board/card ID mapping so interruptions and retries
can reuse created objects instead of duplicating them. Verify the active board before writes.

Create destination boards and cards before rewriting links. Use returned IDs for
`[[board-id#card-id|label]]`, preserve external URLs, and keep code spans/fences unchanged.
In Markdown table cells, escape the alias pipe: `[[board-id#card-id\|label]]`.
Otherwise the table parser can split the link before the wiki parser sees it. Zero unresolved
links is not sufficient: compare expected source link occurrences with rendered anchors.

Use native `references` edges for explicit source links and qualified remote endpoints for
cross-board cards. Add semantic relations only when the source supports them; record the
supporting passage or source reference in `reason`. Similar subjects alone do not establish
dependency, causation or supersession. Follow the main skill's direction rules for dependency kinds.

Preserve historical/draft status and source evidence dates. Importing, reading or rendering
content does not revalidate it. Flag source contradictions separately from conversion errors
and product bugs; do not silently rewrite uncertain facts or invent validation dates.

## Keep picture bytes out of long Markdown

Prefer local asset references over large base64 image strings embedded in Markdown. The
embedded bytes enlarge layout/render requests and can make Markdown parsing expensive.
Keep private pictures in the authorized workspace; do not upload them to a public image host.

One supported approach is a file-backed image card in the document's board:

```json
{"action":"add","type":"image","content":"/absolute/workspace/wiki/assets/diagram.png","title":"System diagram"}
```

Call `canvas_node` with that payload, then use the returned ID in the document:
`![System diagram](/api/canvas/image/<image-node-id>)`. Keep the original alt text and connect
the document to its figure card when useful. This route resolves nodes on the active board:
keep the image card in the same board, and recheck references after copying or moving cards.

In PMX 0.8.2, relative image creation paths resolve against the server's launch directory,
not necessarily its workspace root. An absolute path inside the workspace avoids that mismatch.
Recheck this workaround when image-path handling changes. The database stores the path, not
the file bytes: retain the assets alongside it, update paths if relocating the workspace, and
verify images in exports rather than assuming the live URL is portable.

## Verify the imported workspace, not just the API receipts

1. Reconcile every source page, split item, link and picture with the import mapping. Check
   edge endpoints, group containment and collisions with `canvas_query { action: "validate" }`.
2. Open representative boards, including a dense backlog, a long document, a table containing
   wiki links, and a picture-heavy board. Wait for the correct board and populated card bodies,
   not only titles or HTTP success. Images must load with nonzero natural dimensions.
3. Wait for the intended card/group bounding rectangle after a camera update. Two animation
   frames do not prove an asynchronous layout update arrived. Inspect screenshots at the
   intended viewing zoom for readable cards, relations, labels and unobscured controls.
4. Click local and cross-board links; verify the intended card becomes visible. On a disposable
   test service, restart and verify persistence, including pictures. Compare asset bytes when
   changing image representation to confirm originals were preserved.
5. If loading is slow, measure board-open to rendered-content readiness on repeated equivalent
   workloads. Include a text-only control; record payload sizes, cache conditions and whether
   measurements used a local connection or the user's host. Separate observations from causes.

Report coverage, unresolved issues and storage requirements. Distinguish an import workaround
from a product fix, and a source snapshot from live synchronization. Keep private source paths,
names and content out of reusable skills and public issue reports.
