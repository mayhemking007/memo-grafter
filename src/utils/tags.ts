export function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];

  const normalized = new Set<string>();

  for (const tag of tags) {
    const value = tag.trim().toLowerCase();
    if (value.length > 0) {
      normalized.add(value);
    }
  }

  return [...normalized].sort();
}
