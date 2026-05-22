export function countApproxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function isShortMessage(text: string, threshold = 20): boolean {
  return countApproxTokens(text) < threshold;
}
