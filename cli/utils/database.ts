import postgres, { type Sql } from "postgres";

export interface PostgresConnectionResult {
  version: string;
}

export interface MigrationStatus {
  migrationTableExists: boolean;
  currentVersion?: number;
  expectedVersion: number;
  missingTables: string[];
}

export type DatabaseClient = Sql<Record<string, never>>;

export function createDatabaseClient(connectionString: string): DatabaseClient {
  return postgres(connectionString, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
    onnotice: () => undefined,
  });
}

export async function checkPostgresConnection(sql: DatabaseClient): Promise<PostgresConnectionResult> {
  const rows = await sql<{ server_version: string }[]>`
    SELECT current_setting('server_version') AS server_version
  `;
  return { version: rows[0]?.server_version ?? "unknown" };
}

export async function checkPgvectorAvailability(sql: DatabaseClient): Promise<boolean> {
  const rows = await sql<{ available: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
    ) AS available
  `;
  return rows[0]?.available ?? false;
}

export async function checkPgvectorEnabled(sql: DatabaseClient): Promise<boolean> {
  const rows = await sql<{ enabled: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'vector'
    ) AS enabled
  `;
  return rows[0]?.enabled ?? false;
}

export async function getMigrationStatus(
  sql: DatabaseClient,
  options: {
    migrationTableName: string;
    expectedVersion: number;
    requiredTables: readonly string[];
  },
): Promise<MigrationStatus> {
  const tableRows = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `;
  const existingTables = new Set(tableRows.map((row) => row.table_name));
  const migrationTableExists = existingTables.has(options.migrationTableName);
  let currentVersion: number | undefined;

  if (migrationTableExists) {
    const versionRows = await sql<{ version: number | string | null }[]>`
      SELECT MAX(version) AS version FROM ${sql(options.migrationTableName)}
    `;
    const value = versionRows[0]?.version;
    if (value !== null && value !== undefined) currentVersion = Number(value);
  }

  return {
    migrationTableExists,
    ...(currentVersion !== undefined ? { currentVersion } : {}),
    expectedVersion: options.expectedVersion,
    missingTables: options.requiredTables.filter((name) => !existingTables.has(name)),
  };
}
