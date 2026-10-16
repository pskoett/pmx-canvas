import { computed, signal } from '@preact/signals';
import { workspaceSettingsSchema, type WorkspaceSettings } from '../../shared/workspace-settings.js';

export const workspaceSettings = signal<WorkspaceSettings | null>(null);
export const agentSessionsEnabled = computed(() => workspaceSettings.value?.agentSessions ?? false);
export const knowledgeLifecycleEnabled = computed(() => workspaceSettings.value?.knowledgeLifecycle ?? false);

export function applyWorkspaceSettings(value: unknown): void {
  const parsed = workspaceSettingsSchema.safeParse(value);
  if (parsed.success) workspaceSettings.value = parsed.data;
}
