import type { Database } from 'bun:sqlite';

/** JSON target list parameter; event ranges prevent a reused old ID inheriting the moved card's history. */
export const CARD_HISTORY_CTE = `WITH RECURSIVE
  targets AS (SELECT json_extract(value, '$.boardId') AS current_board,
                     json_extract(value, '$.cardId') AS node_id FROM json_each(?)),
  history(current_board, node_id, board_id, review_after, review_through, read_after, read_through, move_before) AS (
    SELECT current_board, node_id, current_board,
      COALESCE((SELECT MAX(review_through) FROM card_relocations r WHERE (r.from_board = t.current_board OR r.to_board = t.current_board) AND r.node_id = t.node_id), 0),
      9223372036854775807,
      COALESCE((SELECT MAX(read_through) FROM card_relocations r WHERE (r.from_board = t.current_board OR r.to_board = t.current_board) AND r.node_id = t.node_id), 0),
      9223372036854775807, 9223372036854775807 FROM targets t
    UNION ALL
    SELECT h.current_board, h.node_id, r.from_board, r.review_after, r.review_through,
      r.read_after, r.read_through, r.sequence
    FROM history h JOIN card_relocations r ON r.to_board = h.board_id AND r.node_id = h.node_id
    AND r.sequence = (SELECT MAX(sequence) FROM card_relocations prior
      WHERE (prior.to_board = h.board_id OR prior.from_board = h.board_id)
      AND prior.node_id = h.node_id AND prior.sequence < h.move_before)
  )`;

/** Record locations, not new reads or validations. Called inside the move transaction. */
export function recordCardRelocation(
  db: Database,
  requestId: string,
  from: string,
  to: string,
  nodeIds: string[],
): void {
  const reviewThrough = db
    .query<{ value: number }, []>('SELECT COALESCE(MAX(sequence), 0) AS value FROM review_records')
    .get()!.value;
  const readThrough = db
    .query<{ value: number }, []>('SELECT COALESCE(MAX(seq), 0) AS value FROM context_reads')
    .get()!.value;
  for (const id of nodeIds)
    db.run(
      `
    INSERT INTO card_relocations(request_id, node_id, from_board, to_board, review_after, review_through, read_after, read_through)
    VALUES (?, ?, ?, ?,
      COALESCE((SELECT MAX(review_through) FROM card_relocations WHERE (from_board = ? OR to_board = ?) AND node_id = ?), 0), ?,
      COALESCE((SELECT MAX(read_through) FROM card_relocations WHERE (from_board = ? OR to_board = ?) AND node_id = ?), 0), ?)`,
      [requestId, id, from, to, from, from, id, reviewThrough, from, from, id, readThrough],
    );
}

export function boardMoveBoundary(db: Database, boardId: string): string | null {
  return (
    db
      .query<{ request_id: string }, [string]>('SELECT request_id FROM board_move_boundaries WHERE board_id = ?')
      .get(boardId)?.request_id ?? null
  );
}
