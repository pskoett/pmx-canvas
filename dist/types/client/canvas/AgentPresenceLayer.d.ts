/**
 * Agent presence layer (rail-chrome-v2 phase 3): one cursor + phase chip per
 * live writer — attached sessions and external (unattached) writers alike. Lives inside the
 * world layer (like IntentLayer) so it pans and zooms with the board; the
 * glyph itself is counter-scaled so it stays a constant screen size. Moves
 * glide (220ms) — pans and zooms do not, because those move the world layer.
 *
 * Sibling of IntentLayer by design: ghosts show WHAT is about to change and
 * carry the veto; this layer shows WHERE the agent is and WHAT PHASE it is in.
 */
export declare function AgentPresenceLayer(): import("preact/jsx-runtime").JSX.Element | null;
