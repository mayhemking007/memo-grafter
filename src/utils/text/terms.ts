const DEFAULT_STOPWORDS = new Set([
  "the",
  "and",
  "or",
  "a",
  "an",
  "to",
  "of",
  "for",
  "in",
  "on",
  "as",
  "is",
  "are",
  "was",
  "were",
  "we",
  "us",
  "our",
  "i",
  "it",
  "this",
  "that",
  "should",
  "need",
  "needs",
  "use",
  "using",
  "going",
  "back",
  "actually",
  "question",
]);

export function contentTerms(content: string, stopwords = DEFAULT_STOPWORDS): string[] {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2 && !stopwords.has(term));
}

export function lexicalOverlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const term of left) {
    if (right.has(term)) intersection += 1;
  }

  return intersection / Math.min(left.size, right.size);
}
