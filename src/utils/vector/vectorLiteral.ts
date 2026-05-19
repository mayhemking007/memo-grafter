export const toVectorLiteral = (embedding: number[]): string => {
  if (embedding.length === 0) {
    throw new Error("Cannot serialize an empty embedding.");
  }

  return `[${embedding.join(",")}]`;
};

export const parseVector = (value: string | number[] | null): number[] => {
  if (Array.isArray(value)) return value;
  if (!value) return [];

  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((number) => Number.isFinite(number));
};
