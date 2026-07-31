import { runSmokeTests } from "../helpers/runner.js";
import { memoryLifecycleSmoke } from "./memory-lifecycle.js";

await runSmokeTests([memoryLifecycleSmoke]);
