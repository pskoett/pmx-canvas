export type AttributionActor = 'human' | 'agent' | 'system' | 'unknown';
export interface ActorAttribution {
    actor: AttributionActor;
    source: string;
    agentId?: string;
}
export declare function setCurrentActor(actor: ActorAttribution | null): void;
export declare function withCurrentActor<T>(actor: ActorAttribution, action: () => T): T;
/** Direct state/SDK writes are agents unless an operation installed a narrower context. */
export declare function currentActor(fallbackSource?: string): ActorAttribution;
export declare function unknownActor(): ActorAttribution;
