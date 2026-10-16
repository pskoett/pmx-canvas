import { z } from 'zod';

export const workspaceSettingsSchema = z.strictObject({
  agentSessions: z.boolean(),
  knowledgeLifecycle: z.boolean(),
});

export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;
export const workspaceSettingsPatchSchema = workspaceSettingsSchema.partial();
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  agentSessions: false,
  knowledgeLifecycle: false,
};
