# Importing context

Use this workflow when bringing existing context into PMX Canvas from folders, repositories,
documents, notes, backlogs, structured exports or knowledge bases. It guides organization and
verification, not a universal file converter or live sync. PDF/Office attachments still require
the human-consented extraction and review workflow; this guide does not bypass it.

## Inspect the source before choosing the structure

Inventory the requested scope, file types, existing categories, references and assets. Read
representative content before mapping it: folder names alone do not establish board boundaries,
and files may contain several independent items or one argument that should stay together.
Identify duplicates, historical material, unsupported formats and inaccessible sources. Report
gaps rather than silently skipping them or claiming extraction succeeded. Keep private context
within the authorized destination; a folder import is not permission to include credentials.

## Choose boards and cards by purpose

Categories organize boards; boards hold coherent topics or workflows; cards hold useful content.
Preserve useful categories and folder context without mechanically copying the directory tree.
A project folder may become an overview board, a backlog with item cards, and a research board.
Several small files may belong on one board; a single export may need several boards. Choose
cards by useful units of meaning, not automatically one per file, heading or data row. Retain
section context, nested details and useful source ordering when splitting content. These are
examples, not a fixed taxonomy. Explain consequential grouping choices and make them easy to revise.
Several boards in one category are fine. Keep an argument together when splitting would lose
meaning. Group related cards and use the main skill's README and focus guidance for a readable start.

Lead each card with the task, item, decision or document section the reader came to find.
Retain ancestor headings, folder/repository context and source details below that content,
not as repeated preambles that push every useful item below the card's visible area. Preserve
meaning and source hierarchy without making the reader expand every card to identify it.

## Preserve sources and stable targets

Work in an isolated workspace for a test import. Preserve an existing import before replacing
it, and leave source material unchanged unless editing it was requested. Record source paths,
URLs or record IDs, revisions where available, and the source-item/section → board/card ID
mapping so interruptions and retries can reuse created objects instead of duplicating them.
Distinguish faithful imports from summaries; keep a path back to the original. Capture the active
board before writes, separately from any explicit destination. Create destination boards and
cards before rewriting internal references, use returned IDs rather than guessed titles, and
preserve external links.

Create supported static cards, groups and edges on an inactive board with `destinationBoardId`
without switching the human's view. Static nodes are Markdown, status, context, ledger, trace,
diff, Mermaid and plain HTML; images, runtime-backed nodes, generated primitives and intents
are not supported by this path. Updates/removals still require the active board. In a named
`canvas_batch`, each operation's `args` carries its destination and retry fields; group children
and edge endpoints can use the existing named references. `toBoardId` independently chooses a
remote edge endpoint, not the board that owns its source.

Assign a stable `requestId` to each logical static node/group/edge creation and retain it in
the source-to-canvas mapping. Retry with the same input and destination: the durable receipt
returns the original result after interruption or restart, even if the object was subsequently
edited or deleted. It does not restore deleted objects. Changed-input reuse conflicts; a new
intentional creation gets a new ID even when its content is identical. Batch operations commit
in sequence, not as one all-or-nothing import. Persist the mapping as receipts arrive.

`expectedBoardId` guards the active board even with an explicit destination. A stale guard
means refresh context, not substitute the destination ID or switch the human's view to retry.
For active-only work, explicitly open the intended board and verify its returned ID first.
Scope fences and human edit locks remain enforced. If Home is active, list/open a suitable
board before reading board context; library discovery and background static creation can
stay on Home. For retrieval, `canvas_query` search accepts intersecting `boardId` and `folder`
filters. Folder includes slash-boundary descendants; `folder: ""` selects unfiled boards.
Filters default omitted scope to library, while explicit active scope never widens. Search
never changes the active board.

Use native `references` edges for explicit source links and qualified remote endpoints for
cross-board cards. Add semantic relations only when the source supports them; record the
supporting passage or source reference in `reason`. Similar subjects alone do not establish
dependency, causation or supersession. Follow the main skill's direction rules for dependency kinds.

Preserve historical/draft status and source evidence dates. Importing, reading or rendering
content does not revalidate it. Flag source contradictions separately from conversion errors
and product bugs; do not silently rewrite uncertain facts or invent validation dates.

## Markdown link conversion

For content represented as Markdown, use returned IDs in `[[board-id#card-id|label]]` links
and keep code spans/fences unchanged. In table cells, escape the alias pipe:
`[[board-id#card-id\|label]]`. Otherwise the table parser can split the link before the wiki
link parser sees it. Zero unresolved links is not sufficient: compare expected source link
occurrences with rendered anchors. This is a Markdown rendering concern, not a source-format requirement.

## Keep picture bytes out of long Markdown

Prefer local asset references over large base64 image strings embedded in Markdown. The
embedded bytes enlarge layout/render requests; inline pictures remain supported. Choosing
file-backed assets is a representation choice, not proof that a parser or loading bug is fixed.
Keep private pictures in the authorized workspace; do not upload them to a public image host.

One supported approach is a file-backed image card in the document's board:

```json
{"action":"add","type":"image","content":"assets/diagram.png","title":"System diagram"}
```

Call `canvas_node` with that payload, then use the returned ID in the document:
`![System diagram](/api/canvas/image/<image-node-id>)`. Keep the original alt text and connect
the document to its figure card when useful. This route resolves nodes on the active board:
keep the image card in the same board, and recheck references after copying or moving cards.

Relative image creation paths resolve against the canvas workspace root, not the server's
launch directory. An absolute path inside that workspace also works. Image creation requires
opening its destination board; do not send `destinationBoardId` or `requestId` for image nodes.
The database stores the path, not the file bytes: retain the assets alongside it, update paths
if relocating the workspace, and verify images in exports rather than assuming the live URL
is portable.

## Verify the imported workspace, not just the API receipts

1. Account for each in-scope source item as imported, summarized, intentionally excluded or
   unresolved. Reconcile split items, references and assets with the mapping. Check edge endpoints,
   group containment and collisions with `canvas_query { action: "validate" }`.
2. Open representative boards for the content actually imported: for example a dense backlog,
   long document, linked table or picture-heavy board. Wait for the correct board and populated
   card bodies, not only titles or HTTP success. Images must load with nonzero natural dimensions.
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
