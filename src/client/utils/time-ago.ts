/** How long ago, compact: "just now", "5m", "3h", "2d". */
export function age(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string): string {
  const value = age(iso);
  return value === 'just now' ? value : `${value} ago`;
}
