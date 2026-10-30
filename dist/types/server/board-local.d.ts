/** Board-owned runtime state, discarded with its owner rather than on navigation. */
export declare class BoardLocal<T> {
    private readonly create;
    private readonly dispose?;
    private readonly values;
    constructor(create: () => T, dispose?: ((value: T) => void) | undefined);
    get current(): T;
}
