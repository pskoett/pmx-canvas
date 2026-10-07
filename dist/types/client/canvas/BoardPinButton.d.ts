import { type BoardSummary } from '../state/boards-store';
/**
 * Board pins (docs/design/BoardPins.dc.html): the same pin as a card's, in the
 * same place, at board level. Pinned, the board's README and pinned cards reach
 * the agent's brief whichever board is open.
 */
export declare function BoardPinButton({ board }: {
    board: BoardSummary;
}): import("preact/src").JSX.Element;
