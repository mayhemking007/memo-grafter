export const cosineSimilarity = (vectorA: number[], vectorB: number[]): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vectorA.length; i += 1) {
    dot += vectorA[i]! * vectorB[i]!;
    normA += vectorA[i]! * vectorA[i]!;
    normB += vectorB[i]! * vectorB[i]!;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};
