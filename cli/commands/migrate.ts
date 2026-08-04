import { resolveConnectionString } from "../utils/config.js";
import {
  classifyPostgresError,
  formatDatabaseSetupError,
  HandledDatabaseSetupError,
} from "../utils/database-errors.js";
import { logger } from "../utils/logger.js";
import { assertProjectInitialized } from "../utils/project.js";

interface MigrationReport {
  extensions: Array<{ name: string; status: string }>;
  tables: Array<{ name: string; status: string }>;
  indexes: Array<{ name: string; status: string }>;
}

interface MigratingStore {
  migrate(): Promise<MigrationReport>;
  close(): Promise<void>;
}

interface MemoGrafterModule {
  PostgresGraphStore: new (connectionString: string) => MigratingStore;
}

export interface MigrateOptions {
  cwd?: string;
  db?: string;
}

export interface MigrateDependencies {
  createStore(connectionString: string): Promise<MigratingStore>;
}

const defaultDependencies: MigrateDependencies = {
  async createStore(connectionString: string): Promise<MigratingStore> {
    const { PostgresGraphStore } = await loadMemoGrafterModule();
    return new PostgresGraphStore(connectionString);
  },
};

export async function runMigrate(
  options: MigrateOptions = {},
  dependencies: MigrateDependencies = defaultDependencies,
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  assertProjectInitialized(cwd);

  await runRepositoryMigration(options, dependencies);
}

/** Runs migrations for this repository without scaffolding consumer project files. */
export async function runRepositoryMigration(
  options: MigrateOptions = {},
  dependencies: MigrateDependencies = defaultDependencies,
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  try {
    const connectionString = await resolveConnectionString({
      cwd,
      ...(options.db ? { db: options.db } : {}),
    });
    const store = await dependencies.createStore(connectionString);

    logger.info("MemoGrafter migration started");
    let report: MigrationReport;
    try {
      report = await store.migrate();
    } catch (error) {
      await store.close().catch(() => undefined);
      throw error;
    }
    await store.close();

    printGroup("Extensions", report.extensions);
    printGroup("Tables", report.tables);
    printGroup("Indexes", report.indexes);

    logger.success("MemoGrafter migrations completed");
    logger.info([
      "",
      "Verify your environment:",
      "",
      "  npx memo-grafter doctor",
    ].join("\n"));
  } catch (error) {
    const classification = classifyPostgresError(error);
    logger.info(formatDatabaseSetupError(classification));
    throw new HandledDatabaseSetupError(classification);
  }
}

async function loadMemoGrafterModule(): Promise<MemoGrafterModule> {
  const storeEntryPoint = "memo-grafter/store";
  return await import(storeEntryPoint) as MemoGrafterModule;
}

function printGroup(title: string, items: Array<{ name: string; status: string }>): void {
  logger.info("");
  logger.info(title);
  for (const item of items) {
    logger.success(`${item.name} ${item.status}`);
  }
}
