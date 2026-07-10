import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/preact';

function Probe({ label }: { label: string }) {
  return <button type="button">{label}</button>;
}

describe('client test harness', () => {
  test('renders a preact component into happy-dom', () => {
    const { getByRole } = render(<Probe label="works" />);
    expect(getByRole('button').textContent).toBe('works');
  });
});
