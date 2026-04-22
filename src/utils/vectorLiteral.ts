export const toVectorLiteral = (embedding: number[]): string => {
  if (!embedding.every((value) => Number.isFinite(value))) {
    throw new Error("Embedding must contain only finite numbers.");
  }

  return `[${embedding.join(",")}]`;
};

export const parseVector = (value: string | number[] | null): number[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .filter(Boolean)
    .map(Number);
};
