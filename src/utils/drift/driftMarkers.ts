export const SHIFT_MARKERS = [
  "by the way",
  "changing topic",
  "different question",
  "actually",
  "separately",
  "on another note",
  "forget that",
  "never mind",
  "different topic",
  "unrelated question",
];

export const CONTINUATION_MARKERS = [
  "also",
  "additionally",
  "following up",
  "as i mentioned",
  "going back to",
  "continuing",
  "furthermore",
  "moreover",
];

export function structuralMultiplier(content: string): number {
  const normalized = content.toLowerCase();
  if (SHIFT_MARKERS.some((marker) => normalized.includes(marker))) return 1.3;
  if (CONTINUATION_MARKERS.some((marker) => normalized.includes(marker))) return 0.7;
  return 1;
}
