import { runSmokeTests } from "../helpers/runner.js";
import { graphBuildingSmoke } from "./graph-building.js";

await runSmokeTests([graphBuildingSmoke]);
