export declare function promptNewBoard(): Promise<void>;
/**
 * Home (plan 012): the view when no board is open — every board, filed under
 * its category (most recently opened first within each). Categories keep the
 * library findable as it grows into the working memory of many sessions.
 * Deleting asks in place, naming the board and what it holds; browser confirm
 * dialogs are no-ops in agent panes.
 */
export declare function HomeView(): import("preact/src").JSX.Element;
