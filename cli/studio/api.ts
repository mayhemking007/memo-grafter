import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  StudioMemoryEdge,
  StudioMemorySearchResult,
  StudioSessionSummary,
  StudioTableBrowserTable,
  StudioTopicEdge,
} from "./repository.js";

export interface StudioApiStore {
  getNodesBySession(sessionId: string, options?: { includeSuppressed?: boolean }): Promise<unknown[]>;
  getSegmentsBySession(sessionId: string): Promise<unknown[]>;
  getMemoriesBySession(sessionId: string): Promise<unknown[]>;
  getMessagesBySession(sessionId: string, startIndex?: number, endIndex?: number): Promise<unknown[]>;
  suppressTopic(nodeId: string): Promise<boolean>;
}

export interface StudioApiPreviewService {
  getStatus(): { available: boolean; reason?: string };
  run(request: StudioPreviewRequest): Promise<unknown>;
}

export interface StudioPreviewRequest {
  mode: "graft" | "recall";
  sessionId: string;
  query: string;
  graft?: unknown;
  recall?: unknown;
}

export interface StudioApiRepository {
  listSessions(query?: string): Promise<StudioSessionSummary[]>;
  sessionExists(sessionId: string): Promise<boolean>;
  nodeBelongsToSession(sessionId: string, nodeId: string): Promise<boolean>;
  getTopicEdgesBySession(sessionId: string): Promise<StudioTopicEdge[]>;
  getMemoryEdgesBySession(sessionId: string): Promise<StudioMemoryEdge[]>;
  getTablesBySession(sessionId: string): Promise<StudioTableBrowserTable[]>;
  searchMemories(sessionId: string, query: string, limit?: number): Promise<StudioMemorySearchResult[]>;
  upsertSessionLabel(sessionId: string, label: string | null): Promise<void>;
}

export interface StudioApiContext {
  store: StudioApiStore;
  repository: StudioApiRepository;
  preview?: StudioApiPreviewService;
}

interface RouteMatch {
  segments: string[];
  url: URL;
}

export function isStudioApiRequest(requestUrl: string | undefined): boolean {
  const path = parseUrl(requestUrl).pathname;

  return path === "/api/sessions"
    || path.startsWith("/api/sessions/")
    || path === "/sessions"
    || path.startsWith("/sessions/");
}

export async function handleStudioApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: StudioApiContext,
): Promise<void> {
  try {
    const route = matchRoute(request.url);
    if (!route) {
      sendJson(response, 404, { error: "Studio API route not found." });
      return;
    }

    const method = request.method ?? "GET";
    const [resource, sessionId, collection, itemId, action] = route.segments;

    if (resource !== "sessions") {
      sendJson(response, 404, { error: "Studio API route not found." });
      return;
    }

    if (route.segments.length === 1) {
      if (method !== "GET") {
        sendMethodNotAllowed(response, ["GET"]);
        return;
      }

      const sessions = await context.repository.listSessions(route.url.searchParams.get("q") ?? undefined);
      sendJson(response, 200, { sessions });
      return;
    }

    if (!sessionId) {
      sendJson(response, 404, { error: "Studio API route not found." });
      return;
    }

    if (route.segments.length === 2) {
      if (method !== "PATCH") {
        sendMethodNotAllowed(response, ["PATCH"]);
        return;
      }

      await updateSession(response, request, context, sessionId);
      return;
    }

    if (collection === "graph" && route.segments.length === 3) {
      if (method !== "GET") {
        sendMethodNotAllowed(response, ["GET"]);
        return;
      }

      await sendSessionGraph(response, context, sessionId);
      return;
    }

    if (collection === "memories" && route.segments.length === 3) {
      if (method !== "GET") {
        sendMethodNotAllowed(response, ["GET"]);
        return;
      }

      await sendSessionMemories(response, context, sessionId);
      return;
    }

    if (collection === "tables" && route.segments.length === 3) {
      if (method !== "GET") {
        sendMethodNotAllowed(response, ["GET"]);
        return;
      }

      await sendSessionTables(response, context, sessionId);
      return;
    }

    if (collection === "preview" && route.segments.length === 3) {
      if (method !== "POST") {
        sendMethodNotAllowed(response, ["POST"]);
        return;
      }

      await sendPromptPreview(request, response, context, sessionId);
      return;
    }

    if (collection === "search" && route.segments.length === 3) {
      if (method !== "GET") {
        sendMethodNotAllowed(response, ["GET"]);
        return;
      }

      await sendMemorySearch(response, context, sessionId, route.url);
      return;
    }

    if (collection === "nodes" && itemId && action === "suppress" && route.segments.length === 5) {
      if (method !== "POST") {
        sendMethodNotAllowed(response, ["POST"]);
        return;
      }

      await sendSuppressTopic(response, context, sessionId, itemId);
      return;
    }

    sendJson(response, 404, { error: "Studio API route not found." });
  } catch (error) {
    sendJson(response, 500, {
      error: "Studio API request failed.",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function updateSession(
  response: ServerResponse,
  request: IncomingMessage,
  context: StudioApiContext,
  sessionId: string,
): Promise<void> {
  if (!await context.repository.sessionExists(sessionId)) {
    sendJson(response, 404, { error: `Session '${sessionId}' was not found.` });
    return;
  }

  const body = await readJsonBody(request);
  if (!isObject(body)) {
    sendJson(response, 400, { error: "Session update requires a JSON object body." });
    return;
  }

  if (!("label" in body)) {
    sendJson(response, 400, { error: "Session update requires a 'label' field." });
    return;
  }

  if (body.label !== null && typeof body.label !== "string") {
    sendJson(response, 400, { error: "Session label must be a string or null." });
    return;
  }

  const label = typeof body.label === "string" ? body.label.trim() : null;
  if (label && label.length > 120) {
    sendJson(response, 400, { error: "Session label must be 120 characters or fewer." });
    return;
  }

  await context.repository.upsertSessionLabel(sessionId, label || null);
  const [summary] = await context.repository.listSessions(sessionId);

  sendJson(response, 200, {
    sessionId,
    label: label || null,
    displayLabel: summary?.displayLabel ?? label ?? sessionId,
  });
}

async function sendSessionGraph(
  response: ServerResponse,
  context: StudioApiContext,
  sessionId: string,
): Promise<void> {
  if (!await context.repository.sessionExists(sessionId)) {
    sendJson(response, 404, { error: `Session '${sessionId}' was not found.` });
    return;
  }

  const [nodes, segments, edges, memories, memoryEdges] = await Promise.all([
    context.store.getNodesBySession(sessionId, { includeSuppressed: true }),
    context.store.getSegmentsBySession(sessionId),
    context.repository.getTopicEdgesBySession(sessionId),
    context.store.getMemoriesBySession(sessionId),
    context.repository.getMemoryEdgesBySession(sessionId),
  ]);

  sendJson(response, 200, {
    sessionId,
    nodes,
    segments,
    edges,
    memories,
    memoryEdges,
    capturedAt: new Date().toISOString(),
  });
}

async function sendSessionMemories(
  response: ServerResponse,
  context: StudioApiContext,
  sessionId: string,
): Promise<void> {
  if (!await context.repository.sessionExists(sessionId)) {
    sendJson(response, 404, { error: `Session '${sessionId}' was not found.` });
    return;
  }

  const memories = await context.store.getMemoriesBySession(sessionId);
  sendJson(response, 200, { sessionId, memories });
}

async function sendSessionTables(
  response: ServerResponse,
  context: StudioApiContext,
  sessionId: string,
): Promise<void> {
  if (!await context.repository.sessionExists(sessionId)) {
    sendJson(response, 404, { error: `Session '${sessionId}' was not found.` });
    return;
  }

  const [topics, segments, memories, messages, tables] = await Promise.all([
    context.store.getNodesBySession(sessionId, { includeSuppressed: true }),
    context.store.getSegmentsBySession(sessionId),
    context.store.getMemoriesBySession(sessionId),
    context.store.getMessagesBySession(sessionId),
    context.repository.getTablesBySession(sessionId),
  ]);

  sendJson(response, 200, {
    sessionId,
    topics,
    segments,
    memories,
    messages,
    tables,
    capturedAt: new Date().toISOString(),
  });
}

async function sendPromptPreview(
  request: IncomingMessage,
  response: ServerResponse,
  context: StudioApiContext,
  sessionId: string,
): Promise<void> {
  if (!await context.repository.sessionExists(sessionId)) {
    sendJson(response, 404, { error: `Session '${sessionId}' was not found.` });
    return;
  }

  const status = context.preview?.getStatus() ?? {
    available: false,
    reason: "Prompt Preview is not configured.",
  };
  if (!context.preview || !status.available) {
    sendJson(response, 503, {
      error: "Prompt Preview is unavailable.",
      previewStatus: status,
    });
    return;
  }

  const body = await readJsonBody(request);
  if (!isObject(body)) {
    sendJson(response, 400, { error: "Prompt Preview requires a JSON object body." });
    return;
  }

  const mode = body.mode;
  if (mode !== "graft" && mode !== "recall") {
    sendJson(response, 400, { error: "Prompt Preview mode must be 'graft' or 'recall'." });
    return;
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    sendJson(response, 400, { error: "Prompt Preview requires a non-empty query." });
    return;
  }

  const result = await context.preview.run({
    mode,
    sessionId,
    query,
    ...(isObject(body.graft) ? { graft: body.graft } : {}),
    ...(isObject(body.recall) ? { recall: body.recall } : {}),
  });
  sendJson(response, 200, result);
}

async function sendMemorySearch(
  response: ServerResponse,
  context: StudioApiContext,
  sessionId: string,
  url: URL,
): Promise<void> {
  const query = url.searchParams.get("q")?.trim();
  if (!query) {
    sendJson(response, 400, { error: "Missing required search query parameter 'q'." });
    return;
  }

  if (!await context.repository.sessionExists(sessionId)) {
    sendJson(response, 404, { error: `Session '${sessionId}' was not found.` });
    return;
  }

  const limit = parseLimit(url.searchParams.get("limit"));
  const memories = await context.repository.searchMemories(sessionId, query, limit);
  sendJson(response, 200, { sessionId, query, memories });
}

async function sendSuppressTopic(
  response: ServerResponse,
  context: StudioApiContext,
  sessionId: string,
  nodeId: string,
): Promise<void> {
  if (!await context.repository.sessionExists(sessionId)) {
    sendJson(response, 404, { error: `Session '${sessionId}' was not found.` });
    return;
  }

  if (!await context.repository.nodeBelongsToSession(sessionId, nodeId)) {
    sendJson(response, 404, { error: `Topic node '${nodeId}' was not found in session '${sessionId}'.` });
    return;
  }

  const changed = await context.store.suppressTopic(nodeId);

  sendJson(response, 200, { sessionId, nodeId, action: "suppress", changed });
}

function matchRoute(requestUrl: string | undefined): RouteMatch | null {
  const url = parseUrl(requestUrl);
  const rawSegments = url.pathname.split("/").filter(Boolean);
  const segments = rawSegments[0] === "api" ? rawSegments.slice(1) : rawSegments;

  if (segments.length === 0) return null;

  try {
    return {
      segments: segments.map((segment) => decodeURIComponent(segment)),
      url,
    };
  } catch {
    return null;
  }
}

function parseUrl(requestUrl: string | undefined): URL {
  return new URL(requestUrl ?? "/", "http://localhost");
}

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return undefined;

  return Math.max(1, Math.min(parsed, 100));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 64 * 1024) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendMethodNotAllowed(response: ServerResponse, methods: string[]): void {
  response.setHeader("allow", methods.join(", "));
  sendJson(response, 405, { error: `Method not allowed. Use ${methods.join(" or ")}.` });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}
