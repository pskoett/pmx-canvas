export interface ExtAppCallIdentity {
  toolCallId?: string;
  serverName?: string;
  toolName?: string;
}

function normalizeKeyPart(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

export function getExtAppCallKey(serverName?: string, toolName?: string): string | null {
  const normalizedServerName = normalizeKeyPart(serverName);
  const normalizedToolName = normalizeKeyPart(toolName);
  if (!normalizedServerName || !normalizedToolName) return null;
  return `${normalizedServerName}::${normalizedToolName}`;
}

export class ExtAppCallRegistry {
  private activeIds = new Set<string>();
  private keyById = new Map<string, string>();
  private idsByKey = new Map<string, string[]>();

  register(identity: ExtAppCallIdentity): string | null {
    const toolCallId = String(identity.toolCallId || '').trim();
    if (!toolCallId) return null;
    this.activeIds.add(toolCallId);
    const key = getExtAppCallKey(identity.serverName, identity.toolName);
    if (key) {
      this.keyById.set(toolCallId, key);
      const existing = this.idsByKey.get(key)?.filter((id) => this.activeIds.has(id)) ?? [];
      if (!existing.includes(toolCallId)) {
        existing.push(toolCallId);
      }
      this.idsByKey.set(key, existing);
    }
    return toolCallId;
  }

  has(toolCallId?: string): boolean {
    const id = String(toolCallId || '').trim();
    return id.length > 0 && this.activeIds.has(id);
  }

  resolve(identity: ExtAppCallIdentity): string | null {
    const directId = String(identity.toolCallId || '').trim();
    if (directId && this.activeIds.has(directId)) {
      return directId;
    }
    const key = getExtAppCallKey(identity.serverName, identity.toolName);
    if (!key) return null;
    const ids = this.idsByKey.get(key)?.filter((id) => this.activeIds.has(id)) ?? [];
    return ids.length === 1 ? ids[0] : null;
  }

  complete(identity: ExtAppCallIdentity): string | null {
    const resolvedId = this.resolve(identity);
    if (!resolvedId) return null;
    this.activeIds.delete(resolvedId);
    const key = this.keyById.get(resolvedId);
    this.keyById.delete(resolvedId);
    if (key) {
      const remaining = this.idsByKey.get(key)?.filter((id) => id !== resolvedId && this.activeIds.has(id)) ?? [];
      if (remaining.length > 0) {
        this.idsByKey.set(key, remaining);
      } else {
        this.idsByKey.delete(key);
      }
    }
    return resolvedId;
  }

  clear(): void {
    this.activeIds.clear();
    this.keyById.clear();
    this.idsByKey.clear();
  }
}
