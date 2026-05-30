import type { CrawlerPass, CrawlerPassContext, CrawlerPassResult } from "./types.js";
import {
  findMemoryConflictGroups,
  getNewestMemoryNode,
  getSkippedMaintenanceCounts,
} from "./memoryMaintenance.js";

export class VersioningPass implements CrawlerPass {
  readonly name = "versioning";

  async run(context: CrawlerPassContext): Promise<CrawlerPassResult> {
    if (!context.store) {
      throw new Error("VersioningPass requires a crawler maintenance store.");
    }

    const memories = await context.store.listMemoryNodesForMaintenance();
    const conflictGroups = findMemoryConflictGroups(memories);
    let nodesSuperseded = 0;
    let updateEdgesCreated = 0;

    for (const group of conflictGroups) {
      const newest = getNewestMemoryNode(group.nodes);
      if (!newest) continue;

      for (const node of group.nodes) {
        if (node.id === newest.id || node.supersededBy != null) continue;

        const superseded = await context.store.markMemoryNodeSuperseded(node.id, newest.id);
        if (superseded) nodesSuperseded += 1;

        // Direction convention: newer memory --updates--> older memory.
        const edgeCreated = await context.store.upsertMemoryEdge({
          sourceId: newest.id,
          targetId: node.id,
          edgeType: "updates",
          weight: 1,
        });
        if (edgeCreated) updateEdgesCreated += 1;
      }
    }

    const skipped = getSkippedMaintenanceCounts(memories);

    return {
      inspected: memories.length,
      conflictsDetected: conflictGroups.length,
      nodesSuperseded,
      updateEdgesCreated,
      ...skipped,
    };
  }
}
