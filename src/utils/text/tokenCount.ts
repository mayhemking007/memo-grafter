export function countApproxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
