import type { Lifecycle } from '../../server/knowledge-lifecycle.js';
import { ChoiceMenu } from './ChoiceMenu';

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
      <div class="knowledge-field">
        <span>Decays when</span>
        <ChoiceMenu
          label="Decays when"
          value={value.decayType}
          onChange={(decayType) => onChange({ ...value, decayType: decayType as Lifecycle['decayType'] })}
          options={[
            { value: 'reality', label: 'Reality · facts change' },
            { value: 'decision', label: 'Decision · superseded' },
            { value: 'dependency', label: 'Dependency · prerequisites change' },
            { value: 'relevance', label: 'Relevance · task changes' },
          ]}
        />
      </div>
      <div class="knowledge-field">
        <span>Check</span>
        <ChoiceMenu
          label="Check"
          value={value.rate}
          onChange={(rate) => onChange({ ...value, rate: rate as Lifecycle['rate'] })}
          options={[
            { value: 'fast', label: 'Fast · at use' },
            { value: 'medium', label: 'Medium · on a cadence' },
            { value: 'slow', label: 'Slow · on resume' },
            { value: 'durable', label: 'Durable · no passive expiry' },
          ]}
        />
      </div>
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
