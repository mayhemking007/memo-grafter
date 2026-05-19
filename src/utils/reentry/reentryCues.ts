export const REENTRY_CUES = [
  "going back to",
  "back to",
  "returning to",
  "circling back",
  "as i mentioned",
  "as discussed",
  "earlier",
];

export function hasReentryCue(content: string): boolean {
  const normalized = content.toLowerCase();
  return REENTRY_CUES.some((marker) => normalized.includes(marker));
}
