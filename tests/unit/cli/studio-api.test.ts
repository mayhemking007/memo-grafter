import http from "node:http";
import { describe, expect, it, vi } from "vitest";
import { handleStudioApiRequest, type StudioApiContext } from "../../../cli/studio/api.js";
import { listenOnAvailablePort } from "../../../cli/commands/studio.js";

const memoryId = "11111111-1111-4111-8111-111111111111";

describe("MemoGrafter Studio API", () => {
  it("serves session, graph, memory, and search data scoped to one session", async () => {
    const context = makeContext();
    const server = createApiServer(context);
    const port = await listenOnAvailablePort(server, "127.0.0.1", 0);

    try {
      const sessions = await requestJson(port, "/api/sessions");
      const graph = await requestJson(port, "/sessions/session-1/graph");
      const memories = await requestJson(port, "/api/sessions/session-1/memories");
      const search = await requestJson(port, "/sessions/session-1/search?q=alpha");

      expect(sessions.status).toBe(200);
      expect(sessions.body).toMatchObject({
        sessions: [{ id: "session-1", messageCount: 2, topicCount: 1, memoryCount: 1 }],
      });
      expect(graph.status).toBe(200);
      expect(graph.body).toMatchObject({
        sessionId: "session-1",
        nodes: [{ id: "topic-1", sessionId: "session-1" }],
        segments: [{ id: "segment-1", sessionId: "session-1" }],
        edges: [{ srcId: "topic-1", dstId: "topic-2" }],
        memories: [{ id: memoryId, sessionId: "session-1" }],
        memoryEdges: [{ id: "edge-1", sourceId: memoryId }],
      });
      expect(memories.body).toMatchObject({
        sessionId: "session-1",
        memories: [{ id: memoryId, sessionId: "session-1" }],
      });
      expect(search.body).toMatchObject({
        sessionId: "session-1",
        query: "alpha",
        memories: [{ id: memoryId, value: "alpha memory" }],
      });
      expect(context.store.getNodesBySession).toHaveBeenCalledWith("session-1", { includeSuppressed: true });
      expect(context.repository.searchMemories).toHaveBeenCalledWith("session-1", "alpha", undefined);
    } finally {
      await closeServer(server);
    }
  });

  it("performs lifecycle actions after verifying session ownership", async () => {
    const context = makeContext();
    const server = createApiServer(context);
    const port = await listenOnAvailablePort(server, "127.0.0.1", 0);

    try {
      const suppress = await requestJson(port, "/api/sessions/session-1/nodes/topic-1/suppress", { method: "POST" });
      const restore = await requestJson(port, "/sessions/session-1/nodes/topic-1/restore", { method: "POST" });
      const forget = await requestJson(port, `/api/sessions/session-1/memories/${memoryId}/forget`, { method: "POST" });

      expect(suppress.body).toMatchObject({ action: "suppress", changed: true });
      expect(restore.body).toMatchObject({ action: "restore", changed: true });
      expect(forget.body).toMatchObject({ action: "forget", changed: true });
      expect(context.store.suppressTopic).toHaveBeenCalledWith("topic-1");
      expect(context.store.restoreTopic).toHaveBeenCalledWith("topic-1");
      expect(context.store.forgetMemory).toHaveBeenCalledWith(memoryId);
    } finally {
      await closeServer(server);
    }
  });

  it("returns route errors as JSON", async () => {
    const context = makeContext({
      sessionExists: vi.fn(async (sessionId: string) => sessionId === "session-1"),
      nodeBelongsToSession: vi.fn(async () => false),
    });
    const server = createApiServer(context);
    const port = await listenOnAvailablePort(server, "127.0.0.1", 0);

    try {
      const missingQuery = await requestJson(port, "/api/sessions/session-1/search");
      const missingSession = await requestJson(port, "/api/sessions/missing/graph");
      const wrongMethod = await requestJson(port, "/api/sessions", { method: "POST" });
      const missingNode = await requestJson(port, "/api/sessions/session-1/nodes/topic-2/suppress", { method: "POST" });
      const invalidMemory = await requestJson(port, "/api/sessions/session-1/memories/not-a-uuid/forget", { method: "POST" });

      expect(missingQuery.status).toBe(400);
      expect(missingSession.status).toBe(404);
      expect(wrongMethod.status).toBe(405);
      expect(missingNode.status).toBe(404);
      expect(invalidMemory.status).toBe(400);
    } finally {
      await closeServer(server);
    }
  });

  it("returns JSON 500 responses for unexpected failures", async () => {
    const context = makeContext({
      listSessions: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    });
    const server = createApiServer(context);
    const port = await listenOnAvailablePort(server, "127.0.0.1", 0);

    try {
      const response = await requestJson(port, "/api/sessions");

      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        error: "Studio API request failed.",
        message: "database unavailable",
      });
    } finally {
      await closeServer(server);
    }
  });
});

function makeContext(repositoryOverrides: Partial<StudioApiContext["repository"]> = {}): StudioApiContext {
  const memory = {
    id: memoryId,
    sessionId: "session-1",
    value: "alpha memory",
  };

  return {
    store: {
      getNodesBySession: vi.fn(async () => [{ id: "topic-1", sessionId: "session-1" }]),
      getSegmentsBySession: vi.fn(async () => [{ id: "segment-1", sessionId: "session-1" }]),
      getMemoriesBySession: vi.fn(async () => [memory]),
      suppressTopic: vi.fn(async () => true),
      restoreTopic: vi.fn(async () => true),
      forgetMemory: vi.fn(async () => true),
    },
    repository: {
      listSessions: vi.fn(async () => [{
        id: "session-1",
        messageCount: 2,
        topicCount: 1,
        memoryCount: 1,
        lastUpdatedAt: new Date("2026-06-19T00:00:00.000Z"),
      }]),
      sessionExists: vi.fn(async (sessionId: string) => sessionId === "session-1"),
      nodeBelongsToSession: vi.fn(async (_sessionId: string, nodeId: string) => nodeId === "topic-1"),
      memoryBelongsToSession: vi.fn(async (_sessionId: string, observedMemoryId: string) => observedMemoryId === memoryId),
      getTopicEdgesBySession: vi.fn(async () => [{ srcId: "topic-1", dstId: "topic-2", weight: 1, type: "semantic" }]),
      getMemoryEdgesBySession: vi.fn(async () => [{
        id: "edge-1",
        sourceId: memoryId,
        targetId: "22222222-2222-4222-8222-222222222222",
        edgeType: "related",
        weight: 1,
        createdAt: new Date("2026-06-19T00:00:00.000Z"),
      }]),
      searchMemories: vi.fn(async () => [memory]),
      ...repositoryOverrides,
    },
  };
}

function createApiServer(context: StudioApiContext): http.Server {
  return http.createServer((request, response) => {
    void handleStudioApiRequest(request, response, context);
  });
}

async function requestJson(
  port: number,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
  return {
    status: response.status,
    body: await response.json(),
  };
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
