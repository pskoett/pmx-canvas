import type { Lifecycle } from '../../server/knowledge-lifecycle.js';
export declare const DEFAULT_LIFECYCLE: Lifecycle;
export declare function LifecycleFields({ value, onChange }: {
    value: Lifecycle;
    onChange: (value: Lifecycle) => void;
}): import("preact/jsx-runtime").JSX.Element;
export declare const cleanLifecycle: (value: Lifecycle) => Lifecycle;
