export declare function promptNewBoard(): Promise<void>;
/**
 * Home (plan 012): the view when no board is open — every board, most
 * recently opened first. Deleting asks in place, naming the board and what it
 * holds; browser confirm dialogs are no-ops in agent panes.
 */
export declare function HomeView(): import("preact/src").JSX.Element;
