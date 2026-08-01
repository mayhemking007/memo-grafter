import { runSmokeTests } from "../helpers/runner.js";
import { ingestTextSmoke } from "./ingest-text.js";

await runSmokeTests([ingestTextSmoke]);
