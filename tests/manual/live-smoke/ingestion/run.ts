import { runSmokeTests } from "../helpers/runner.js";
import { driftAndPersistenceSmoke } from "./drift-and-persistence.js";
import { ingestTextSmoke } from "./ingest-text.js";
import { queueSmoke } from "./queue.js";

await runSmokeTests([ingestTextSmoke, driftAndPersistenceSmoke, queueSmoke]);
