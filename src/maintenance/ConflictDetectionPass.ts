import type { CrawlerPass, CrawlerPassContext, CrawlerPassResult } from "./types.js";
import { findMemoryConflictGroups, getSkippedMaintenanceCounts } from "./memoryMaintenance.js";

export class ConflictDetectionPass implements CrawlerPass {
  readonly name = "conflict-detection";

  async run(context: CrawlerPassContext): Promise<CrawlerPassResult> {
    if (!context.store) {
      throw new Error("ConflictDetectionPass requires a crawler maintenance store.");
    }

    const memories = await context.store.listMemoryNodesForMaintenance();
    const conflictGroups = findMemoryConflictGroups(memories);
    const conflictingNodeIds = new Set<string>();
    let conflictEdgesCreated = 0;

    for (const group of conflictGroups) {
      for (const node of group.nodes) {
        conflictingNodeIds.add(node.id);
      }

      for (let sourceIndex = 0; sourceIndex < group.nodes.length; sourceIndex += 1) {
        const source = group.nodes[sourceIndex];
        if (!source) continue;

        for (let targetIndex = sourceIndex + 1; targetIndex < group.nodes.length; targetIndex += 1) {
          const target = group.nodes[targetIndex];
          if (!target) continue;

          const created = await context.store.upsertMemoryEdge({
            sourceId: source.id,
            targetId: target.id,
            edgeType: "conflicts",
            weight: 1,
          });
          if (created) conflictEdgesCreated += 1;
        }
      }
    }

    const nodesMarkedConflicting = await context.store.markMemoryNodesConflicting([...conflictingNodeIds]);
    const skipped = getSkippedMaintenanceCounts(memories);

    return {
      inspected: memories.length,
      conflictsDetected: conflictGroups.length,
      nodesMarkedConflicting,
      conflictEdgesCreated,
      ...skipped,
    };
  }
}
