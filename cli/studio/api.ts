import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  StudioMemoryEdge,
  StudioMemorySearchResult,
  StudioSessionSummary,
  StudioTopicEdge,
} from "./repository.js";

export interface StudioApiStore {
  getNodesBySession(sessionId: string, options?: { includeSuppressed?: boolean }): Promise<unknown[]>;
  getSegmentsBySession(sessionId: string): Promise<unknown[]>;
  getMemoriesBySession(sessionId: string): Promise<unknown[]>;
  suppressTopic(nodeId: string): Promise<boolean>;
  restoreTopic(nodeId: string): Promise<boolean>;
  forgetMemory(memoryId: string): Promise<boolean>;
}

export interface StudioApiRepository {
  listSessions(): Promise<StudioSessionSummary[]>;
  sessionExists(sessionId: string): Promise<boolean>;
  nodeBelongsToSession(sessionId: string, nodeId: string): Promise<boolean>;
  memoryBelongsToSession(sessionId: string, memoryId: string): Promise<boolean>;
  getTopicEdgesBySession(sessionId: string): Promise<StudioTopicEdge[]>;
  getMemoryEdgesBySession(sessionId: string): Promise<StudioMemoryEdge[]>;
  searchMemories(sessionId: string, query: string, limit?: number): Promise<StudioMemorySearchResult[]>;
}

export interface StudioApiContext {
  store: StudioApiStore;
  repository: StudioApiRepository;
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

      const sessions = await context.repository.listSessions();
      sendJson(response, 200, { sessions });
      return;
    }

    if (!sessionId) {
      sendJson(response, 404, { error: "Studio API route not found." });
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

    if (collection === "search" && route.segments.length === 3) {
      if (method !== "GET") {
        sendMethodNotAllowed(response, ["GET"]);
        return;
      }

      await sendMemorySearch(response, context, sessionId, route.url);
      return;
    }

    if (collection === "nodes" && itemId && (action === "suppress" || action === "restore") && route.segments.length === 5) {
      if (method !== "POST") {
        sendMethodNotAllowed(response, ["POST"]);
        return;
      }

      await sendNodeLifecycleAction(response, context, sessionId, itemId, action);
      return;
    }

    if (collection === "memories" && itemId && action === "forget" && route.segments.length === 5) {
      if (method !== "POST") {
        sendMethodNotAllowed(response, ["POST"]);
        return;
      }

      await sendForgetMemory(response, context, sessionId, itemId);
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

async function sendNodeLifecycleAction(
  response: ServerResponse,
  context: StudioApiContext,
  sessionId: string,
  nodeId: string,
  action: "suppress" | "restore",
): Promise<void> {
  if (!await context.repository.sessionExists(sessionId)) {
    sendJson(response, 404, { error: `Session '${sessionId}' was not found.` });
    return;
  }

  if (!await context.repository.nodeBelongsToSession(sessionId, nodeId)) {
    sendJson(response, 404, { error: `Topic node '${nodeId}' was not found in session '${sessionId}'.` });
    return;
  }

  const changed = action === "suppress"
    ? await context.store.suppressTopic(nodeId)
    : await context.store.restoreTopic(nodeId);

  sendJson(response, 200, { sessionId, nodeId, action, changed });
}

async function sendForgetMemory(
  response: ServerResponse,
  context: StudioApiContext,
  sessionId: string,
  memoryId: string,
): Promise<void> {
  if (!isUuid(memoryId)) {
    sendJson(response, 400, { error: "Memory id must be a UUID." });
    return;
  }

  if (!await context.repository.sessionExists(sessionId)) {
    sendJson(response, 404, { error: `Session '${sessionId}' was not found.` });
    return;
  }

  if (!await context.repository.memoryBelongsToSession(sessionId, memoryId)) {
    sendJson(response, 404, { error: `Memory '${memoryId}' was not found in session '${sessionId}'.` });
    return;
  }

  const changed = await context.store.forgetMemory(memoryId);
  sendJson(response, 200, { sessionId, memoryId, action: "forget", changed });
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
