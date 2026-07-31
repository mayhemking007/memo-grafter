import { runSmokeTests } from "../helpers/runner.js";
import { crawlerMaintenanceSmoke } from "./maintenance.js";

await runSmokeTests([crawlerMaintenanceSmoke]);
