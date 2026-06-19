import http from "node:http";
import { describe, expect, it } from "vitest";
import { handleStudioRequest, listenOnAvailablePort } from "../../../cli/commands/studio.js";

describe("memo-grafter studio", () => {
  it("serves the bundled frontend and status endpoint", async () => {
    const state = {
      databaseStatus: "connected" as const,
      sessionCount: 3,
      studioUrl: "http://localhost:2891",
    };
    const server = http.createServer((request, response) => {
      handleStudioRequest(request, response, state);
    });
    const port = await listenOnAvailablePort(server, "127.0.0.1", 0);

    try {
      const html = await fetchText(`http://127.0.0.1:${port}/`);
      const status = await fetchJson(`http://127.0.0.1:${port}/api/status`);
      const missing = await fetchText(`http://127.0.0.1:${port}/missing`);

      expect(html.status).toBe(200);
      expect(html.body).toContain("MemoGrafter Studio");
      expect(html.body).toContain("session-list");
      expect(html.body).toContain("graph-stage");
      expect(html.body).toContain("node-type-filter");
      expect(html.body).toContain("tag-filter");
      expect(html.body).toContain("lifecycle-filter");
      expect(html.body).toContain("refresh-sessions");
      expect(html.body).toContain("refresh-graph");
      expect(html.body).toContain('fetchJson("/api/sessions")');
      expect(html.body).toContain('"/api/sessions/" + encodeURIComponent(sessionId) + "/graph"');
      expect(status.status).toBe(200);
      expect(status.body).toEqual(state);
      expect(missing.status).toBe(404);
    } finally {
      await closeServer(server);
    }
  });

  it("uses the next available port when the preferred port is busy", async () => {
    const occupied = http.createServer((_request, response) => {
      response.end("occupied");
    });
    const occupiedPort = await listenOnAvailablePort(occupied, "127.0.0.1", 0);
    const server = http.createServer((_request, response) => {
      response.end("studio");
    });

    try {
      const port = await listenOnAvailablePort(server, "127.0.0.1", occupiedPort);

      expect(port).toBe(occupiedPort + 1);
    } finally {
      await closeServer(server);
      await closeServer(occupied);
    }
  });
});

async function fetchText(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.text(),
  };
}

async function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url);
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
