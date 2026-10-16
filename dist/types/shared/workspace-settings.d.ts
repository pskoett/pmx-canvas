import { z } from 'zod';
export declare const workspaceSettingsSchema: z.ZodObject<{
    agentSessions: z.ZodBoolean;
    knowledgeLifecycle: z.ZodBoolean;
}, z.core.$strict>;
export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;
export declare const workspaceSettingsPatchSchema: z.ZodObject<{
    agentSessions: z.ZodOptional<z.ZodBoolean>;
    knowledgeLifecycle: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export declare const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings;
