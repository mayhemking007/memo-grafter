import type { CrawlerPass, CrawlerPassContext, CrawlerPassResult } from "./types.js";
import {
  findMemoryVersionGroups,
  getSkippedMaintenanceCounts,
} from "./memoryMaintenance.js";

export class VersioningPass implements CrawlerPass {
  readonly name = "versioning";

  async run(context: CrawlerPassContext): Promise<CrawlerPassResult> {
    if (!context.store) {
      throw new Error("VersioningPass requires a crawler maintenance store.");
    }

    const memories = await context.store.listMemoryNodesForMaintenance();
    const versionGroups = findMemoryVersionGroups(memories);
    let nodesSuperseded = 0;
    let updateEdgesCreated = 0;

    for (const group of versionGroups) {
      for (const node of group.nodes) {
        if (node.id === group.replacement.id || node.supersededBy != null) continue;

        const superseded = await context.store.markMemoryNodeSuperseded(node.id, group.replacement.id);
        if (superseded) nodesSuperseded += 1;

        // Direction convention: newer memory --updates--> older memory.
        const edgeCreated = await context.store.upsertMemoryEdge({
          sourceId: group.replacement.id,
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
      versionsDetected: versionGroups.length,
      nodesSuperseded,
      updateEdgesCreated,
      ...skipped,
    };
  }
}
