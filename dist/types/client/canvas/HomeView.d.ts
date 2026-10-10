export declare function promptNewBoard(category?: string | null): Promise<void>;
/**
 * Home (docs/design/Home.dc.html, plan 016): the library when no board is
 * open. A folder tree with pinned boards on the left, the selected folder's
 * subfolders and board cards in the middle, the selected board's details on
 * the right. At ≤ 760 px (Pane600.dc.html) the tree becomes a folder picker,
 * the boards a list and the details a bottom sheet. Folders are board
 * categories; categories carry no colour (decided 2026-10-07). Browser
 * confirm dialogs are no-ops in agent panes, so Delete asks in place.
 */
export declare function HomeView(): import("preact/src").JSX.Element;
