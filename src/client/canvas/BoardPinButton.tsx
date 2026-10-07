import { IconPin } from '../icons';
import { type BoardSummary, setBoardPinned } from '../state/boards-store';

/**
 * Board pins (docs/design/BoardPins.dc.html): the same pin as a card's, in the
 * same place, at board level. Pinned, the board's README and pinned cards reach
 * the agent's brief whichever board is open.
 */
export function BoardPinButton({ board }: { board: BoardSummary }) {
  const pinned = !!board.pin;
  // No board name in the label: rows already name the board, and a name here would
  // make role+name lookups for the board's own open button ambiguous.
  const label = pinned ? "Unpin board from the agent's context" : "Pin board to the agent's context";
  return (
    <button
      type="button"
      class={`ctx-pin-btn board-pin-btn${pinned ? ' ctx-pin-active' : ''}`}
      onClick={(event) => {
        event.stopPropagation();
        void setBoardPinned(board.id, !pinned);
      }}
      aria-label={label}
      aria-pressed={pinned}
      data-testid="board-pin"
    >
      <span class="ctx-pin-mark">
        <IconPin />
        {pinned && board.pin?.pinnedBy.actor === 'agent' && <span class="ctx-pin-agent-dot" aria-hidden="true" />}
      </span>
    </button>
  );
}
