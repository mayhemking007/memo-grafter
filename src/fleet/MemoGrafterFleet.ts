import { randomUUID } from "node:crypto";
import { MemoGrafter } from "../MemoGrafter.js";
import { RetrieverPipeline } from "../pipeline/RetrieverPipeline.js";
import type { FleetMemoryMode, MemoGrafterConfig } from "../types.js";
import { ConductorAgent } from "./ConductorAgent.js";
import { FleetStore } from "./FleetStore.js";
import type {
  FleetGraph,
  FleetMemoryOptions,
  FleetRetrievalOptions,
  MemoGrafterFleetOptions,
  SharedMemorySnapshot,
  WorkerAgentConfig,
} from "./types.js";
import { WorkerAgent } from "./WorkerAgent.js";

export const FLEET_SHARED_AGENT_COLOR = "fleet";

export class MemoGrafterFleet {
  private readonly core: MemoGrafter;
  private readonly fleetStore: FleetStore;
  private readonly workersByColor = new Map<string, WorkerAgent>();
  private readonly sharedSessionId: string;
  readonly id: string;
  readonly name: string | undefined;
  readonly defaultWorkerMemory: FleetMemoryMode;

  constructor(configOrCore: MemoGrafterConfig | MemoGrafter, options: MemoGrafterFleetOptions = {}) {
    this.core = configOrCore instanceof MemoGrafter ? configOrCore : new MemoGrafter(configOrCore);
    this.fleetStore = new FleetStore(this.core.store);
    this.id = options.id ?? randomUUID();
    this.name = options.name;
    this.defaultWorkerMemory = options.defaultWorkerMemory ?? "local";
    this.sharedSessionId = `fleet:${this.id}:shared`;
  }

  async initialize(): Promise<void> {
    await this.core.initialize();
    await this.fleetStore.initializeFleet(this.id, this.name);
  }

  createConductor(): ConductorAgent {
    return new ConductorAgent(this.core, this.id, (color) => this.workersByColor.get(color));
  }

  async createWorker(config: WorkerAgentConfig): Promise<WorkerAgent> {
    if (config.color === "conductor") {
      throw new Error("Worker color 'conductor' is reserved.");
    }

    const worker = new WorkerAgent(this.core, this.id, this.sharedSessionId, {
      ...config,
      memory: config.memory ?? this.defaultWorkerMemory,
    });
    await this.fleetStore.upsertAgent({
      id: worker.getAgentId(),
      fleetId: this.id,
      sessionId: worker.getSessionId(),
      color: worker.getColor(),
    });
    this.workersByColor.set(worker.getColor(), worker);
    return worker;
  }

  getWorker(color: string): WorkerAgent | undefined {
    return this.workersByColor.get(color);
  }

  async getGraph(): Promise<FleetGraph> {
    return this.fleetStore.getFleetGraph(this.id, this.name);
  }

  getSharedSessionId(): string {
    return this.sharedSessionId;
  }

  async ingestToFleet(text: string, options: FleetMemoryOptions = {}) {
    const nodes = await this.core.ingestText(text, this.sharedSessionId, options);
    await this.core.store.tagSessionNodes(this.sharedSessionId, {
      fleetId: this.id,
      agentId: null,
      agentColor: FLEET_SHARED_AGENT_COLOR,
    });
    return nodes;
  }

  async recallFromFleet(query: string, options: FleetRetrievalOptions = {}) {
    const pipeline = new RetrieverPipeline(
      this.core.store,
      this.core.embedder,
      {
        ...options,
        sessionIds: [this.sharedSessionId],
      },
      this.core.recallCache,
    );
    return pipeline.run(query, this.sharedSessionId);
  }

  async getSharedMemory(): Promise<SharedMemorySnapshot> {
    const { nodes, segments } = await this.core.getTopics(this.sharedSessionId, { includeSuppressed: true });
    const memories = await this.core.store.getMemoriesBySession(this.sharedSessionId);
    return {
      sessionId: this.sharedSessionId,
      nodes,
      segments,
      memories,
    };
  }

  close(): Promise<void> {
    return this.core.close();
  }
}
