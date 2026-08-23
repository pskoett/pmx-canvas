/**
 * Scope fence (rail-chrome-v2 phase 4, design item 4): the region the human
 * granted the attached agent. Drawn in the world layer from the same geometry
 * the server enforces (fenced nodes' bounding box + padding), so what the
 * human sees is exactly what the agent is held to. Mounts only while a
 * session is attached and a fence is set.
 */
export declare function ScopeFenceLayer(): import("preact/jsx-runtime").JSX.Element | null;
