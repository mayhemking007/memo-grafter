export const normalizeText = (text: string): string | null => {
  if (!text) return "";
  let content = text.trim();

  content = content.replace(/\n+/g, " ");
  content = content.replace(/\s+/g, " ");

  if (content.length < 3) return null;

  const junk = ["ok", "yes", "no", ".", "..."];
  if (junk.includes(content.toLowerCase())) return null;

  return content;
};
