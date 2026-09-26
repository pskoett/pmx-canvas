import { signal } from '@preact/signals';

export const presenting = signal(false);
export const recordingCamera = signal(false);
export function ownsCamera(): boolean {
  return presenting.value || recordingCamera.value;
}
