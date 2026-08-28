/**
 * Windows has no `sh`, so the exec ran nowhere there. cmd.exe can host the
 * stdin pattern, but NOT the `{message}` / `{id}` placeholders: those expand to
 * an env-var reference so hostile steer content is never spliced into the
 * command string, and cmd.exe expands `%VAR%` before re-parsing — a message
 * containing `& del …` would run. Refuse the placeholders there instead of
 * silently reintroducing the injection the substitution exists to prevent.
 */
export declare function renderExecTemplate(template: string, windows?: boolean): string;
