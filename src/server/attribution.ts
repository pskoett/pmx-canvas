import { AsyncLocalStorage } from 'node:async_hooks';

export type AttributionActor = 'human' | 'agent' | 'system' | 'unknown';

export interface ActorAttribution {
  actor: AttributionActor;
  source: string;
  agentId?: string;
}

const actors = new AsyncLocalStorage<ActorAttribution | null>();

export function setCurrentActor(actor: ActorAttribution | null): void {
  actors.enterWith(actor);
}

export function withCurrentActor<T>(actor: ActorAttribution, action: () => T): T {
  return actors.run(actor, action);
}

/** Direct state/SDK writes are agents unless an operation installed a narrower context. */
export function currentActor(fallbackSource = 'sdk'): ActorAttribution {
  const current = actors.getStore();
  return current ? { ...current } : { actor: 'agent', source: fallbackSource };
}

export function unknownActor(): ActorAttribution {
  return { actor: 'unknown', source: 'unknown' };
}
