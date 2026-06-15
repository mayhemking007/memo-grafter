import { PostgresGraphStore } from "memo-grafter";
import { resolveConnectionString } from "../utils/config.js";
import { logger } from "../utils/logger.js";

export interface MigrateOptions {
  cwd?: string;
  db?: string;
}

export async function runMigrate(options: MigrateOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const connectionString = await resolveConnectionString({
    cwd,
    ...(options.db ? { db: options.db } : {}),
  });
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

function printGroup(title: string, items: Array<{ name: string; status: string }>): void {
  logger.info("");
  logger.info(title);
  for (const item of items) {
    logger.success(`${item.name} ${item.status}`);
  }
}
