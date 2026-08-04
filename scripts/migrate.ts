import { runRepositoryMigration } from "../cli/commands/migrate.js";
import { isHandledDatabaseSetupError } from "../cli/utils/database-errors.js";
import { logger } from "../cli/utils/logger.js";
import { readDatabaseArgument } from "./utils/arguments.js";

try {
  const db = readDatabaseArgument(process.argv.slice(2), "migrate");
  await runRepositoryMigration({ ...(db ? { db } : {}) });
} catch (error) {
  if (!isHandledDatabaseSetupError(error)) {
    logger.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}
