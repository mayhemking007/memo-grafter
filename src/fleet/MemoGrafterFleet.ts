import { randomUUID } from "node:crypto";
import { MemoGrafter } from "../MemoGrafter.js";
import type { MemoGrafterConfig } from "../types.js";
import { ConductorAgent } from "./ConductorAgent.js";
import { FleetStore } from "./FleetStore.js";
import type { FleetGraph, MemoGrafterFleetOptions, WorkerAgentConfig } from "./types.js";
import { WorkerAgent } from "./WorkerAgent.js";

export class MemoGrafterFleet {
  private readonly core: MemoGrafter;
  private readonly fleetStore: FleetStore;
  private readonly workersByColor = new Map<string, WorkerAgent>();
  readonly id: string;
  readonly name: string | undefined;

  constructor(configOrCore: MemoGrafterConfig | MemoGrafter, options: MemoGrafterFleetOptions = {}) {
    this.core = configOrCore instanceof MemoGrafter ? configOrCore : new MemoGrafter(configOrCore);
    this.fleetStore = new FleetStore(this.core.store);
    this.id = options.id ?? randomUUID();
    this.name = options.name;
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

    const worker = new WorkerAgent(this.core, this.id, config);
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

  close(): Promise<void> {
    return this.core.close();
  }
}
