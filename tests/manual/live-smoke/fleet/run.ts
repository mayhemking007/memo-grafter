import { runSmokeTests } from "../helpers/runner.js";
import { fleetSharedMemorySmoke } from "./shared-memory.js";

await runSmokeTests([fleetSharedMemorySmoke]);
