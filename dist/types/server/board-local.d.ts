/** Board-owned runtime state, discarded with its owner rather than on navigation. */
export declare function createBoardLocal<T>(create: () => T, dispose?: (value: T) => void): {
    readonly current: T;
};
