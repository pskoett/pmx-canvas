import { IconPin } from '../icons';
import { type BoardSummary, setBoardPinned } from '../state/boards-store';

/**
 * Board pins (docs/design/BoardPins.dc.html): the same pin as a card's, in the
 * same place, at board level. Pinned, the board's README and pinned cards reach
 * the agent's brief whichever board is open.
 */
export function BoardPinButton({ board, inNodeHeader = false }: { board: BoardSummary; inNodeHeader?: boolean }) {
  const pinned = !!board.pin;
  // No board name in the label: rows already name the board, and a name here would
  // make role+name lookups for the board's own open button ambiguous.
  const label = pinned ? "Unpin board from the agent's context" : "Pin board to the agent's context";
  return (
    <button
      type="button"
      // In a node header it takes the header's own control sizing, like the card pin it replaces.
      class={`ctx-pin-btn${inNodeHeader ? '' : ' board-pin-btn'}${pinned ? ' ctx-pin-active' : ''}`}
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
