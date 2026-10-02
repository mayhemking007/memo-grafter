import type { TopicEdge } from "../core/types.js";
import type { GraphStore } from "../store/GraphStore.js";

export function batches<T>(items: T[], size = 100): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) result.push(items.slice(start, start + size));
  return result;
}
/** Preserve order and failure propagation for stores without batch support. */
export async function saveGraphEdges(store: GraphStore, edges: TopicEdge[]): Promise<void> {
  if (store.saveEdges) { for (const batch of batches(edges)) await store.saveEdges(batch); }
  else for (const edge of edges) await store.saveEdge(edge);
}
