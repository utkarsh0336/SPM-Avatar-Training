/**
 * Formats an ISO timestamp as the short relative-time strings this dashboard's session lists
 * already display ("Just now", "5m ago", "2h ago", "Yesterday", "4 days ago", "1 week ago") —
 * kept in sync with (dashboard)/page.tsx's recencyRank parser, which ranks these exact formats
 * when merging the video/voice session lists into one recency-sorted activity feed.
 */
export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}
