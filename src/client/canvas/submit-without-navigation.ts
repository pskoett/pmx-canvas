import type { JSX } from 'preact';

/** A scripts-only host blocks native submission before onSubmit can run. */
export function submitWithoutNavigation(event: JSX.TargetedMouseEvent<HTMLFormElement>): void {
  if (event.defaultPrevented || !(event.target instanceof Element)) return;
  const button = event.target.closest('button');
  const form = event.currentTarget;
  if (button?.type !== 'submit' || button.form !== form || button.matches(':disabled')) return;
  // Enter in a form input also activates its submit button. Keep native
  // validation, but dispatch only the JS event, never a navigation/submission.
  event.preventDefault();
  if (!form.noValidate && !button.formNoValidate && !form.reportValidity()) return;
  form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button }));
}
