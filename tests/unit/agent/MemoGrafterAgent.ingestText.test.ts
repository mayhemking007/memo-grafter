import { describe, expect, it } from "vitest";
import { MemoGrafterAgent } from "../../../src/agents/MemoGrafterAgent.js";
import type {
  EmbedAdapter,
  IngestTextOptions,
  LLMAdapter,
  MemoGrafterConfig,
  Message,
} from "../../../src/core/types.js";

type AgentCore = {
  llm: LLMAdapter;
  enqueueIngest(messages: Message[], sessionId: string): Promise<void>;
  enqueueTextIngest(
    text: string,
    sessionId: string,
    options?: IngestTextOptions & { tags?: string[] },
  ): Promise<void>;
  store: {
    getSessionNodeCount(sessionId: string): Promise<number>;
    setSessionTags(sessionId: string, tags: string[]): Promise<void>;
  };
};

class CapturingLLMAdapter implements LLMAdapter {
  calls: Message[][] = [];

  async complete(messages: Message[]): Promise<string> {
    this.calls.push([...messages]);
    return "Assistant response";
  }
}

class FakeEmbedAdapter implements EmbedAdapter {
  async embed(): Promise<number[]> {
    return [0.1, 0.2, 0.3];
  }
}

function createAgent(llm = new CapturingLLMAdapter()): MemoGrafterAgent {
  return new MemoGrafterAgent({
    db: { connectionString: "postgres://user:pass@localhost:5432/memografter_test" },
    llm,
    embedder: new FakeEmbedAdapter(),
  } satisfies MemoGrafterConfig);
}

function internals(agent: MemoGrafterAgent): {
  core: AgentCore;
  ingestionHistory: Message[];
} {
  return agent as unknown as {
    core: AgentCore;
    ingestionHistory: Message[];
  };
}

describe("MemoGrafterAgent.ingestText", () => {
  it("ingests raw text without generating a response or changing public history", async () => {
    const llm = new CapturingLLMAdapter();
    const agent = createAgent(llm);
    const privateAgent = internals(agent);
    const calls: Array<{ text: string; sessionId: string; options?: IngestTextOptions & { tags?: string[] } }> = [];

    privateAgent.core.enqueueTextIngest = async (text, sessionId, options) => {
      calls.push({ text, sessionId, options });
    };
    privateAgent.core.store.setSessionTags = async () => undefined;

    await agent.setSessionTags(["Journal"]);
    await agent.ingestText("Morning notes about the product roadmap.", {
      label: "Morning entry",
      source: "classic-editor",
    });

    expect(llm.calls).toEqual([]);
    expect(agent.getHistory()).toEqual([]);
    expect(privateAgent.ingestionHistory).toEqual([
      { role: "user", content: "Morning notes about the product roadmap." },
    ]);
    expect(calls).toEqual([{
      text: "Morning notes about the product roadmap.",
      sessionId: agent.getSessionId(),
      options: {
        label: "Morning entry",
        source: "classic-editor",
        tags: ["journal"],
      },
    }]);
  });

  it("replaces graph ingestion history while preserving chat history and invoke behavior", async () => {
    const llm = new CapturingLLMAdapter();
    const agent = createAgent(llm);
    const privateAgent = internals(agent);
    const messageSnapshots: Message[][] = [];
    const textCalls: Array<{ text: string; replace?: boolean }> = [];

    privateAgent.core.store.getSessionNodeCount = async () => 0;
    privateAgent.core.enqueueIngest = async (messages) => {
      messageSnapshots.push([...messages]);
    };
    privateAgent.core.enqueueTextIngest = async (text, _sessionId, options) => {
      textCalls.push({ text, replace: options?.replace });
    };

    await agent.invoke("Chat before replacement.");
    await agent.ingestText("Replacement document.", { replace: true });
    await agent.invoke("Chat after replacement.");

    expect(agent.getHistory()).toEqual([
      { role: "user", content: "Chat before replacement." },
      { role: "assistant", content: "Assistant response" },
      { role: "user", content: "Chat after replacement." },
      { role: "assistant", content: "Assistant response" },
    ]);
    expect(llm.calls).toEqual([
      [{ role: "user", content: "Chat before replacement." }],
      [
        { role: "user", content: "Chat before replacement." },
        { role: "assistant", content: "Assistant response" },
        { role: "user", content: "Chat after replacement." },
      ],
    ]);
    expect(textCalls).toEqual([{ text: "Replacement document.", replace: true }]);
    expect(messageSnapshots).toEqual([
      [
        { role: "user", content: "Chat before replacement." },
        { role: "assistant", content: "Assistant response" },
      ],
      [
        { role: "user", content: "Replacement document." },
        { role: "user", content: "Chat after replacement." },
        { role: "assistant", content: "Assistant response" },
      ],
    ]);
  });

  it("treats whitespace-only text as a no-op", async () => {
    const agent = createAgent();
    const privateAgent = internals(agent);
    let callCount = 0;
    privateAgent.core.enqueueTextIngest = async () => {
      callCount += 1;
    };

    await agent.ingestText("   \n ");

    expect(callCount).toBe(0);
    expect(agent.getHistory()).toEqual([]);
    expect(privateAgent.ingestionHistory).toEqual([]);
  });

  it("stores chunked text in graph ingestion history without exposing it as chat history", async () => {
    const agent = createAgent();
    const privateAgent = internals(agent);
    privateAgent.core.enqueueTextIngest = async () => undefined;

    await agent.ingestText("Roadmap planning starts today. Hiring planning starts tomorrow.");

    expect(privateAgent.ingestionHistory).toEqual([
      { role: "user", content: "Roadmap planning starts today." },
      { role: "user", content: "Hiring planning starts tomorrow." },
    ]);
    expect(agent.getHistory()).toEqual([]);
  });
});

describe("MemoGrafterAgent.remember", () => {
  it("stores explicit memory text through the ingestText path with remember defaults", async () => {
    const llm = new CapturingLLMAdapter();
    const agent = createAgent(llm);
    const privateAgent = internals(agent);
    const calls: Array<{ text: string; sessionId: string; options?: IngestTextOptions & { tags?: string[] } }> = [];

    privateAgent.core.enqueueTextIngest = async (text, sessionId, options) => {
      calls.push({ text, sessionId, options });
    };
    privateAgent.core.store.setSessionTags = async () => undefined;

    await agent.setSessionTags(["Preference", " preference "]);
    await agent.remember("The user prefers concise TypeScript examples.", {
      label: "User preference",
    });

    expect(llm.calls).toEqual([]);
    expect(agent.getHistory()).toEqual([]);
    expect(privateAgent.ingestionHistory).toEqual([
      { role: "user", content: "The user prefers concise TypeScript examples." },
    ]);
    expect(calls).toEqual([{
      text: "The user prefers concise TypeScript examples.",
      sessionId: agent.getSessionId(),
      options: {
        label: "User preference",
        source: "remember",
        tags: ["preference"],
      },
    }]);
  });

  it("lets callers override remember metadata while preserving ingest options", async () => {
    const agent = createAgent();
    const privateAgent = internals(agent);
    const calls: Array<{ text: string; options?: IngestTextOptions & { tags?: string[] } }> = [];

    privateAgent.core.enqueueTextIngest = async (text, _sessionId, options) => {
      calls.push({ text, options });
    };

    await agent.remember("The imported CRM profile says the user works in finance.", {
      replace: true,
      label: "CRM profile",
      source: "crm-import",
    });

    expect(calls).toEqual([{
      text: "The imported CRM profile says the user works in finance.",
      options: {
        replace: true,
        label: "CRM profile",
        source: "crm-import",
        tags: [],
      },
    }]);
    expect(privateAgent.ingestionHistory).toEqual([
      { role: "user", content: "The imported CRM profile says the user works in finance." },
    ]);
  });

  it("treats whitespace-only remembered text as a no-op", async () => {
    const agent = createAgent();
    const privateAgent = internals(agent);
    let callCount = 0;
    privateAgent.core.enqueueTextIngest = async () => {
      callCount += 1;
    };

    await agent.remember("   \n ");

    expect(callCount).toBe(0);
    expect(agent.getHistory()).toEqual([]);
    expect(privateAgent.ingestionHistory).toEqual([]);
  });
});
