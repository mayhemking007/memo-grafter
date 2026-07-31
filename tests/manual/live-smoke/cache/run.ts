import { runSmokeTests } from "../helpers/runner.js";
import { recallCacheSmoke } from "./recall-cache.js";

await runSmokeTests([recallCacheSmoke]);
