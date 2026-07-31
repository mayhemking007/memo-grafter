import { recallCacheSmoke } from "./cache/recall-cache.js";
import { crawlerMaintenanceSmoke } from "./crawler/maintenance.js";
import { fleetSharedMemorySmoke } from "./fleet/shared-memory.js";
import { basicChatSmoke } from "./grafter/basic-chat.js";
import { graphBuildingSmoke } from "./graph/graph-building.js";
import { driftAndPersistenceSmoke } from "./ingestion/drift-and-persistence.js";
import { queueSmoke } from "./ingestion/queue.js";
import { memoryLifecycleSmoke } from "./maintenance/memory-lifecycle.js";
import { runSmokeTests } from "./helpers/runner.js";

await runSmokeTests([
  basicChatSmoke,
  graphBuildingSmoke,
  driftAndPersistenceSmoke,
  queueSmoke,
  recallCacheSmoke,
  fleetSharedMemorySmoke,
  crawlerMaintenanceSmoke,
  memoryLifecycleSmoke,
]);
