import type { CanvasNodeState } from '../types';
interface GroupNodeProps {
    node: CanvasNodeState;
}
/**
 * Group frame body (rail-chrome-v2 groups v2): the children live in the world
 * layer and the name/count/actions sit on the frame edge, so the body is just
 * the wash — plus a hint while the group is empty.
 */
export declare function GroupNode({ node }: GroupNodeProps): import("preact/src").JSX.Element | null;
export {};
