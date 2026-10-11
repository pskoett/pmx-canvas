import type { Lifecycle } from '../../server/knowledge-lifecycle.js';

export const DEFAULT_LIFECYCLE: Lifecycle = {
  decayType: 'reality',
  rate: 'medium',
  cadenceDays: 90,
  triggers: [],
  revalidationMethod: '',
};

export function LifecycleFields({ value, onChange }: { value: Lifecycle; onChange: (value: Lifecycle) => void }) {
  return (
    <div class="lifecycle-fields">
      <label>
        Decays when
        <select
          value={value.decayType}
          onChange={(event) => onChange({ ...value, decayType: event.currentTarget.value as Lifecycle['decayType'] })}
        >
          <option value="reality">Reality · facts change</option>
          <option value="decision">Decision · superseded</option>
          <option value="dependency">Dependency · prerequisites change</option>
          <option value="relevance">Relevance · task changes</option>
        </select>
      </label>
      <label>
        Check
        <select
          value={value.rate}
          onChange={(event) => onChange({ ...value, rate: event.currentTarget.value as Lifecycle['rate'] })}
        >
          <option value="fast">Fast · at use</option>
          <option value="medium">Medium · on a cadence</option>
          <option value="slow">Slow · on resume</option>
          <option value="durable">Durable · no passive expiry</option>
        </select>
      </label>
      {value.rate === 'medium' && (
        <label>
          Cadence in days
          <input
            type="number"
            min="1"
            max="36500"
            value={value.cadenceDays ?? ''}
            onInput={(event) =>
              onChange({
                ...value,
                cadenceDays: event.currentTarget.value ? Number(event.currentTarget.value) : undefined,
              })
            }
          />
        </label>
      )}
      <label>
        Also review when · one trigger per line
        <textarea
          value={value.triggers.join('\n')}
          onInput={(event) => onChange({ ...value, triggers: event.currentTarget.value.split('\n') })}
        />
      </label>
      <label>
        Revalidate by
        <input
          required
          value={value.revalidationMethod}
          onInput={(event) => onChange({ ...value, revalidationMethod: event.currentTarget.value })}
        />
      </label>
      <p>
        Source changes, contradictions and superseding decisions are observed through explicit relations. Other triggers
        describe what the reviewer should check.
      </p>
    </div>
  );
}

export const cleanLifecycle = (value: Lifecycle): Lifecycle => ({
  ...value,
  triggers: value.triggers.map((s) => s.trim()).filter(Boolean),
});
