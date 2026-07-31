import { runSmokeTests } from "../helpers/runner.js";
import { driftAndPersistenceSmoke } from "./drift-and-persistence.js";
import { queueSmoke } from "./queue.js";

await runSmokeTests([driftAndPersistenceSmoke, queueSmoke]);
