/**
 * The top bar's board identity (plan 012): the open board's name, or "Home".
 * Clicking it lists recent boards, New board, and Home. The menu is fixed-
 * positioned so the bar's overflow clip cannot cut it off.
 */
export declare function BoardSwitcher({ fallbackName }: {
    fallbackName: string;
}): import("preact/src").JSX.Element;
