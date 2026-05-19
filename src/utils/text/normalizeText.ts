export const normalizeText = (text: string): string | null => {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
};
