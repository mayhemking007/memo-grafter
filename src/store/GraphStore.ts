import type {
  MemoryNode,
  MemoryNodeInsert,
  Message,
  TopicEdge,
  TopicNode,
  TopicSegment,
} from "../types.js";

export interface FleetAgentRecord {
  id: string;
  fleetId: string;
  sessionId: string;
  agentColor: string;
  createdAt: Date;
}

export interface GraphStore {
  initialize(): Promise<void>;
  saveMessages(sessionId: string, messages: Message[]): Promise<void>;
  saveMessagesAt(sessionId: string, startIndex: number, messages: Message[]): Promise<void>;
  saveSegment(segment: TopicSegment): Promise<TopicSegment>;
  saveNode(node: TopicNode): Promise<void>;
  saveEdge(edge: TopicEdge): Promise<void>;
  clearSession(sessionId: string): Promise<void>;
  clearSessionGraph(sessionId: string): Promise<void>;
  getNodeBySegment(segmentId: string): Promise<TopicNode | null>;
  getNodesBySession(sessionId: string): Promise<TopicNode[]>;
  getSegmentsBySession(sessionId: string): Promise<TopicSegment[]>;
  insertMemories(nodes: MemoryNodeInsert[]): Promise<void>;
  getMemoriesBySegment(segmentId: string): Promise<MemoryNode[]>;
  getMemoriesByTopic(topicNodeId: string): Promise<MemoryNode[]>;
  searchMemories(
    embedding: number[],
    sessionId: string,
    limit: number,
    minSimilarity: number,
  ): Promise<(MemoryNode & { similarity: number })[]>;
  buildMemoryEdges(topicNodeId: string, sessionId: string, threshold: number): Promise<void>;
  getTopKSimilar(nodeId: string, embedding: number[], sessionId: string, k: number): Promise<TopicNode[]>;
  getSimilarNodes(
    embedding: number[],
    sessionId: string,
    options?: { k?: number; excludeNodeId?: string; minSimilarity?: number },
  ): Promise<TopicNode[]>;
  getSimilarNodesAcrossFleet(
    fleetId: string,
    embedding: number[],
    options?: { k?: number; excludeNodeId?: string; minSimilarity?: number; agentColor?: string },
  ): Promise<TopicNode[]>;
  getNodesByColor(fleetId: string, agentColor: string): Promise<TopicNode[]>;
  saveFleet(fleetId: string, name?: string): Promise<void>;
  saveFleetAgent(agent: {
    id: string;
    fleetId: string;
    sessionId: string;
    agentColor: string;
  }): Promise<void>;
  getFleetAgents(fleetId: string): Promise<FleetAgentRecord[]>;
  tagSessionNodes(sessionId: string, metadata: {
    fleetId: string | null;
    agentId: string | null;
    agentColor: string | null;
  }): Promise<void>;
  getPreviousNode(sessionId: string, topicOrder: number): Promise<TopicNode | null>;
  nodeSimilarity(nodeAId: string, nodeBId: string): Promise<number>;
  getNeighbours(nodeIds: string[], hopDepth: number, sessionId?: string): Promise<TopicNode[]>;
  getBufferMessages(sessionId: string, start: number, end: number, maxChars?: number): Promise<Message[]>;
  absorbNodes(
    nodes: TopicNode[],
    targetSessionId: string,
    options?: { agentColor?: string | null; fleetId?: string | null; agentId?: string | null },
  ): Promise<TopicNode[]>;
  rebuildEdgesForSession(sessionId: string, semanticTopK?: number, semanticThreshold?: number): Promise<void>;
  close(): Promise<void>;
}
