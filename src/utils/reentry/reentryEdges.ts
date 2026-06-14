import type { Message, TopicEdge, TopicNode } from "../../core/types.js";
import { lexicalOverlap } from "../text/terms.js";
import { segmentUserEmbeddings, maxPairwiseSimilarity } from "./reentrySimilarity.js";
import { segmentHasReentryCue, segmentMeaningfulTerms } from "./reentryText.js";
import type { ReentrySegmentRange } from "./types.js";

export function edgePairKey(srcId: string, dstId: string): string {
  return `${srcId}:${dstId}`;
}

export function buildExistingNodeReentryEdges(
  reentryMap: Map<number, string>,
  existingNodes: TopicNode[],
  nodeByTopicOrder: Map<number, TopicNode>,
): { edges: TopicEdge[]; savedPairs: Set<string> } {
  const edges: TopicEdge[] = [];
  const savedPairs = new Set<string>();
  if (reentryMap.size === 0) return { edges, savedPairs };

  const oldNodeById = new Map(existingNodes.map((node) => [node.id, node]));

  for (const [topicOrder, matchedOldNodeId] of reentryMap.entries()) {
    const sourceNode = nodeByTopicOrder.get(topicOrder);
    const matchedOldNode = oldNodeById.get(matchedOldNodeId);
    const targetNode = matchedOldNode ? nodeByTopicOrder.get(matchedOldNode.topicOrder) : undefined;

    if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) continue;

    edges.push({
      srcId: sourceNode.id,
      dstId: targetNode.id,
      weight: 1,
      type: "reentry",
    });
    savedPairs.add(edgePairKey(sourceNode.id, targetNode.id));
  }

  return { edges, savedPairs };
}

export function findCurrentRunReentryEdges(input: {
  segments: ReentrySegmentRange[];
  messages: Message[];
  embeddings: number[][];
  nodeByTopicOrder: Map<number, TopicNode>;
  reentryThreshold: number;
  existingPairs?: Set<string>;
}): TopicEdge[] {
  const { segments, messages, embeddings, nodeByTopicOrder, reentryThreshold } = input;
  const savedPairs = input.existingPairs ?? new Set<string>();
  if (segments.length < 2) return [];

  const segmentEmbeddings = segments.map((segment) => ({
    segment,
    embeddings: segmentUserEmbeddings(segment, messages, embeddings),
    hasReentryCue: segmentHasReentryCue(segment, messages),
    terms: segmentMeaningfulTerms(segment, messages),
  }));

  const edges: TopicEdge[] = [];

  for (const current of segmentEmbeddings) {
    if (current.embeddings.length === 0) continue;

    let best: { topicOrder: number; similarity: number } | null = null;
    let bestLexical: { topicOrder: number; score: number } | null = null;

    for (const candidate of segmentEmbeddings) {
      if (candidate.segment.topicOrder >= current.segment.topicOrder - 1 || candidate.embeddings.length === 0) continue;

      const similarity = maxPairwiseSimilarity(current.embeddings, candidate.embeddings);
      if (!best || similarity > best.similarity) {
        best = { topicOrder: candidate.segment.topicOrder, similarity };
      }

      const lexicalScore = lexicalOverlap(current.terms, candidate.terms);
      if (!bestLexical || lexicalScore > bestLexical.score) {
        bestLexical = { topicOrder: candidate.segment.topicOrder, score: lexicalScore };
      }
    }

    const threshold = current.hasReentryCue ? Math.min(reentryThreshold, 0.72) : reentryThreshold;
    const lexicalReentry = current.hasReentryCue && bestLexical && bestLexical.score >= 0.08;
    if ((!best || best.similarity < threshold) && !lexicalReentry) continue;

    const sourceNode = nodeByTopicOrder.get(current.segment.topicOrder);
    const targetTopicOrder = best && best.similarity >= threshold ? best.topicOrder : bestLexical?.topicOrder;
    const targetNode = targetTopicOrder ? nodeByTopicOrder.get(targetTopicOrder) : undefined;
    if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) continue;

    const pairKey = edgePairKey(sourceNode.id, targetNode.id);
    if (savedPairs.has(pairKey)) continue;

    edges.push({
      srcId: sourceNode.id,
      dstId: targetNode.id,
      weight: best && best.similarity >= threshold ? best.similarity : bestLexical?.score ?? 1,
      type: "reentry",
    });
    savedPairs.add(pairKey);
  }

  return edges;
}
