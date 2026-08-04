import { runRepositoryDoctor } from "../cli/commands/doctor.js";
import { logger } from "../cli/utils/logger.js";
import { readDatabaseArgument } from "./utils/arguments.js";

try {
  const db = readDatabaseArgument(process.argv.slice(2), "doctor");
  const report = await runRepositoryDoctor({ ...(db ? { db } : {}) });
  logger.info(report.output);
  process.exitCode = report.exitCode;
} catch (error) {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
