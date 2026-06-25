import { resolveConnectionString } from "../utils/config.js";
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

export async function runMigrate(options: MigrateOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  assertProjectInitialized(cwd);
  const connectionString = await resolveConnectionString({
    cwd,
    ...(options.db ? { db: options.db } : {}),
  });
  const { PostgresGraphStore } = await loadMemoGrafterModule();
  const store = new PostgresGraphStore(connectionString);

  try {
    logger.info("MemoGrafter migration started");
    const report = await store.migrate();

    printGroup("Extensions", report.extensions);
    printGroup("Tables", report.tables);
    printGroup("Indexes", report.indexes);

    logger.info("Migration complete");
  } finally {
    await store.close();
  }
}

async function loadMemoGrafterModule(): Promise<MemoGrafterModule> {
  const packageName = "memo-grafter";
  return await import(packageName) as MemoGrafterModule;
}

function printGroup(title: string, items: Array<{ name: string; status: string }>): void {
  logger.info("");
  logger.info(title);
  for (const item of items) {
    logger.success(`${item.name} ${item.status}`);
  }
}
