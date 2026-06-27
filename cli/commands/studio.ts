import { spawn } from "node:child_process";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import postgres, { type Sql } from "postgres";
import { resolveConnectionString, resolveStudioRuntimeConfig, type StudioRuntimeConfig } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import { assertProjectInitialized } from "../utils/project.js";
import { handleStudioApiRequest, isStudioApiRequest, type StudioApiPreviewService, type StudioApiStore } from "../studio/api.js";
import { renderStudioHtml, type StudioFrontendState } from "../studio/frontend.js";
import { StudioRepository } from "../studio/repository.js";

interface StudioStore extends StudioApiStore {
  verifySchema(): Promise<void>;
  close(): Promise<void>;
}

interface MemoGrafterModule {
  PostgresGraphStore: new (connectionString: string) => StudioStore;
  createStudioPreviewService: (store: StudioStore, config: StudioRuntimeConfig | null | undefined) => StudioApiPreviewService;
}

export interface StudioOptions {
  cwd?: string;
  db?: string;
  host?: string;
  port?: number;
  openBrowser?: boolean;
}

export interface StudioServer {
  url: string;
  port: number;
  sessionCount: number;
  close(): Promise<void>;
}

interface StudioStartOptions extends Required<Pick<StudioOptions, "host" | "port" | "openBrowser">> {
  connectionString: string;
  runtimeConfig?: StudioRuntimeConfig | null;
}

export async function runStudio(options: StudioOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  assertProjectInitialized(cwd);
  const connectionString = await resolveConnectionString({
    cwd,
    ...(options.db ? { db: options.db } : {}),
  });
  const runtimeConfig = await resolveStudioRuntimeConfig({ cwd });

  const server = await startStudioServer({
    connectionString,
    runtimeConfig,
    host: options.host ?? "localhost",
    port: options.port ?? 2891,
    openBrowser: options.openBrowser ?? true,
  });

  logger.info("");
  logger.info("Press Ctrl+C to stop Studio.");

  await waitForShutdown(server);
}

export async function startStudioServer(options: StudioStartOptions): Promise<StudioServer> {
  logger.info("MemoGrafter Studio starting");

  const { PostgresGraphStore, createStudioPreviewService } = await loadMemoGrafterModule();
  const store = new PostgresGraphStore(options.connectionString);
  let sql: Sql | null = null;

  try {
    await store.verifySchema();
    sql = postgres(options.connectionString, {
      max: 1,
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: () => undefined,
    });
    const sessionCount = await readSessionCount(sql);
    const repository = new StudioRepository(sql);
    const preview = createStudioPreviewService(store, options.runtimeConfig);
    const state: StudioFrontendState = {
      databaseStatus: "connected",
      sessionCount,
      studioUrl: "",
      previewStatus: preview.getStatus(),
    };
    const server = http.createServer((request, response) => {
      void handleStudioRequest(request, response, state, {
        store,
        repository,
        preview,
      });
    });
    const port = await listenOnAvailablePort(server, options.host, options.port);
    const url = `http://${options.host}:${port}`;
    state.studioUrl = url;

    logger.success("Database connected");
    logger.info(`Sessions: ${sessionCount}`);
    logger.info(`Studio: ${url}`);

    if (options.openBrowser) {
      openStudioBrowser(url);
    }

    return {
      url,
      port,
      sessionCount,
      async close() {
        await closeServer(server);
        await store.close();
        if (sql) await sql.end();
      },
    };
  } catch (error) {
    await store.close().catch(() => undefined);
    if (sql) await sql.end().catch(() => undefined);
    throw formatStudioStartupError(error);
  }
}

export async function readSessionCount(sql: Sql): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    WITH sessions AS (
      SELECT session_id FROM mg_message_buffer
      UNION
      SELECT session_id FROM mg_segments
      UNION
      SELECT session_id FROM mg_topic_nodes
      UNION
      SELECT session_id FROM mg_memory_nodes
      UNION
      SELECT session_id FROM mg_session_ingest_state
    )
    SELECT COUNT(*)::int AS count FROM sessions
  `;

  return rows[0]?.count ?? 0;
}

export function handleStudioRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: StudioFrontendState,
  apiContext?: { store: StudioApiStore; repository: StudioRepository; preview?: StudioApiPreviewService },
): void | Promise<void> {
  const url = request.url ?? "/";

  if (url === "/api/status") {
    sendJson(response, state);
    return;
  }

  if (isStudioApiRequest(url)) {
    if (!apiContext) {
      response.writeHead(500, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({ error: "Studio API is not configured." }));
      return;
    }

    return handleStudioApiRequest(request, response, apiContext);
  }

  if (url === "/" || url === "/index.html") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(renderStudioHtml(state));
    return;
  }

  response.writeHead(404, {
    "content-type": "text/plain; charset=utf-8",
  });
  response.end("Not found");
}

export async function listenOnAvailablePort(
  server: http.Server,
  host: string,
  startPort: number,
): Promise<number> {
  let port = startPort;

  while (true) {
    try {
      return await listen(server, host, port);
    } catch (error) {
      if (isAddressInUseError(error)) {
        port += 1;
        continue;
      }

      throw error;
    }
  }
}

async function listen(server: http.Server, host: string, port: number): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address() as AddressInfo;
      resolve(address.port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function sendJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function openStudioBrowser(url: string): void {
  const platform = process.platform;
  const command = platform === "win32"
    ? "cmd"
    : platform === "darwin"
      ? "open"
      : "xdg-open";
  const args = platform === "win32"
    ? ["/c", "start", "", url]
    : [url];

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {
      logger.warn(`Could not open browser automatically. Open ${url} manually.`);
    });
    child.unref();
  } catch {
    logger.warn(`Could not open browser automatically. Open ${url} manually.`);
  }
}

async function waitForShutdown(server: StudioServer): Promise<void> {
  await new Promise<void>((resolve) => {
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      resolve();
    };

    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });

  logger.info("");
  logger.info("Stopping MemoGrafter Studio");
  await server.close();
  logger.info("Studio stopped");
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function loadMemoGrafterModule(): Promise<MemoGrafterModule> {
  const packageName = "memo-grafter";
  return await import(packageName) as MemoGrafterModule;
}

function isAddressInUseError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}

function formatStudioStartupError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  return new Error([
    "MemoGrafter Studio could not start.",
    message,
    "",
    "Troubleshooting:",
    "- Run npx memo-grafter init before launching Studio.",
    "- Pass --db <connection-string>, set DATABASE_URL, or configure db.connectionString in mg.config.ts.",
    "- Run npx memo-grafter migrate before launching Studio.",
    "- Confirm PostgreSQL is running and reachable from this shell.",
  ].join("\n"), { cause: error });
}
