import { normalizeText } from "./normalizeText.js";

const MAX_CHUNK_CHARACTERS = 800;

export function splitTextForIngestion(text: string): string[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter((line): line is string => line !== null);

  return lines.flatMap((line) => splitLine(line));
}

function splitLine(line: string): string[] {
  const sentences = line
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeText(sentence))
    .filter((sentence): sentence is string => sentence !== null);

  return sentences.flatMap((sentence) => splitLongSentence(sentence));
}

function splitLongSentence(sentence: string): string[] {
  if (sentence.length <= MAX_CHUNK_CHARACTERS) return [sentence];

  const words = sentence.split(/\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > MAX_CHUNK_CHARACTERS) {
      chunks.push(current);
      current = word;
      continue;
    }

    current = next;
  }

  if (current) chunks.push(current);
  return chunks;
}
