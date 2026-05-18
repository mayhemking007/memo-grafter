import type { GraphStore } from "../store/index.js";
import type { FleetAgentInfo, FleetGraph } from "./types.js";

export class FleetStore {
  constructor(private readonly store: GraphStore) {}

  async initializeFleet(fleetId: string, name?: string): Promise<void> {
    await this.store.saveFleet(fleetId, name);
  }

  async upsertAgent(agent: FleetAgentInfo & { fleetId: string }): Promise<void> {
    await this.store.saveFleetAgent({
      id: agent.id,
      fleetId: agent.fleetId,
      sessionId: agent.sessionId,
      agentColor: agent.color,
    });
  }

  async getFleetGraph(fleetId: string, name?: string): Promise<FleetGraph> {
    const agents = await this.store.getFleetAgents(fleetId);
    return {
      id: fleetId,
      ...(name ? { name } : {}),
      agents: agents.map((agent) => ({
        id: agent.id,
        sessionId: agent.sessionId,
        color: agent.agentColor,
      })),
    };
  }
}
