import { describe, expect, it, vi } from "vitest";
import { MemoGrafterAgent } from "../../../src/MemoGrafterAgent.js";

function createAgent() {
  const order: string[] = [];
  const core = {
    forget: vi.fn(async () => {
      order.push("forget");
      return true;
    }),
    forgetMany: vi.fn(async () => {
      order.push("forgetMany");
      return 2;
    }),
    suppressTopic: vi.fn(async () => {
      order.push("suppressTopic");
      return true;
    }),
    restoreTopic: vi.fn(async () => {
      order.push("restoreTopic");
      return true;
    }),
  };
  const agent = Object.create(MemoGrafterAgent.prototype) as MemoGrafterAgent;
  const internals = agent as unknown as {
    core: typeof core;
    pendingIngest: Promise<void>;
  };
  internals.core = core;
  internals.pendingIngest = Promise.resolve().then(() => {
    order.push("pending");
  });

  return { agent, core, order };
}

describe("MemoGrafterAgent lifecycle APIs", () => {
  it("waits for pending ingest before forgetting a memory", async () => {
    const { agent, core, order } = createAgent();

    await expect(agent.forget("memory-1")).resolves.toBe(true);

    expect(core.forget).toHaveBeenCalledWith("memory-1");
    expect(order).toEqual(["pending", "forget"]);
  });

  it("forwards bulk forget and topic lifecycle calls", async () => {
    const { agent, core } = createAgent();

    await expect(agent.forgetMany(["memory-a", "memory-b"])).resolves.toBe(2);
    await expect(agent.suppressTopic("topic-1")).resolves.toBe(true);
    await expect(agent.restoreTopic("topic-1")).resolves.toBe(true);

    expect(core.forgetMany).toHaveBeenCalledWith(["memory-a", "memory-b"]);
    expect(core.suppressTopic).toHaveBeenCalledWith("topic-1");
    expect(core.restoreTopic).toHaveBeenCalledWith("topic-1");
  });
});
