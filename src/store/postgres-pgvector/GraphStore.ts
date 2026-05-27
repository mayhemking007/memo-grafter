import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import type { FleetAgentRecord, GraphStore } from "../GraphStore.js";
import type { MemoryNode, MemoryNodeInsert, Message, TopicEdge, TopicNode, TopicSegment } from "../../types.js";
import { cosineSimilarity } from "../../utils/drift/cosineSimilarity.js";
import { parseVector, toVectorLiteral } from "../../utils/vector/vectorLiteral.js";

interface TopicNodeRow {
  id: string;
  session_id: string;
  segment_id: string;
  label: string | null;
  summary: string | null;
  embedding: string | number[] | null;
  message_range: number[] | null;
  topic_order: number | null;
  drift_score: number | null;
  agent_color: string | null;
  fleet_id: string | null;
  agent_id: string | null;
  created_at: Date;
}

interface TopicSegmentRow {
  id: string;
  session_id: string;
  start_index: number;
  end_index: number;
  topic_order: number;
  drift_score: number;
  created_at: Date;
}

interface MemoryNodeRow {
  id: string;
  segment_id: string;
  topic_node_id: string;
  agent_id: string | null;
  session_id: string;
  memory_type: MemoryNode["memoryType"];
  source_type: MemoryNode["sourceType"];
  subject: string;
  predicate: string;
  value: string;
  confidence: number;
  embedding: string | number[] | null;
  source_url: string | null;
  source_title: string | null;
  superseded_by: string | null;
  decayed: boolean;
  agent_color: string | null;
  fleet_id: string | null;
  created_at: Date;
}

interface MessageRow {
  session_id: string;
  message_index: number;
  role: "user" | "assistant";
  content: string;
}

interface EdgeRow {
  src_id: string;
  dst_id: string;
  weight: number;
  type: string;
}

interface AbsorbOptions {
  agentColor?: string | null;
  fleetId?: string | null;
  agentId?: string | null;
}

export class PostgresGraphStore implements GraphStore {
  private readonly sql: Sql;

  constructor(connectionString: string) {
    this.sql = postgres(connectionString, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
    });
  }

  async initialize(): Promise<void> {
    await this.sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await this.sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

    await this.sql`
      CREATE TABLE IF NOT EXISTS mg_message_buffer (
        session_id    TEXT NOT NULL,
        message_index INT NOT NULL,
        role          TEXT NOT NULL,
        content       TEXT NOT NULL,
        PRIMARY KEY (session_id, message_index)
      )
    `;

    await this.sql`
      CREATE TABLE IF NOT EXISTS mg_segments (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        start_index INT NOT NULL,
        end_index   INT NOT NULL,
        topic_order INT NOT NULL,
        drift_score FLOAT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (session_id, start_index, end_index)
      )
    `;

    await this.sql`
      CREATE TABLE IF NOT EXISTS mg_topic_nodes (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL,
        segment_id    TEXT NOT NULL REFERENCES mg_segments(id) ON DELETE CASCADE,
        label         TEXT,
        summary       TEXT,
        embedding     vector(1536),
        message_range INT[],
        topic_order   INT NOT NULL DEFAULT 0,
        drift_score   FLOAT NOT NULL DEFAULT 0,
        agent_color   TEXT,
        fleet_id      TEXT,
        agent_id      TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (segment_id)
      )
    `;

    await this.sql`
      CREATE TABLE IF NOT EXISTS mg_topic_edges (
        src_id  TEXT NOT NULL,
        dst_id  TEXT NOT NULL,
        weight  FLOAT NOT NULL,
        type    TEXT NOT NULL,
        PRIMARY KEY (src_id, dst_id)
      )
    `;

    await this.sql`
      CREATE TABLE IF NOT EXISTS mg_memory_nodes (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        segment_id    TEXT NOT NULL REFERENCES mg_segments(id) ON DELETE CASCADE,
        topic_node_id TEXT NOT NULL REFERENCES mg_topic_nodes(id) ON DELETE CASCADE,
        agent_id      TEXT,
        session_id    TEXT NOT NULL,
        memory_type   TEXT NOT NULL CHECK (memory_type IN ('fact','insight','question','task','reference')),
        source_type   TEXT NOT NULL DEFAULT 'conversation' CHECK (source_type IN ('conversation','note','document','code')),
        subject       TEXT NOT NULL,
        predicate     TEXT NOT NULL,
        value         TEXT NOT NULL,
        confidence    FLOAT NOT NULL DEFAULT 1.0,
        embedding     vector(1536),
        source_url    TEXT,
        source_title  TEXT,
        superseded_by UUID REFERENCES mg_memory_nodes(id),
        decayed       BOOLEAN NOT NULL DEFAULT FALSE,
        agent_color   TEXT,
        fleet_id      TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await this.sql`
      CREATE TABLE IF NOT EXISTS mg_memory_edges (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_id  UUID NOT NULL REFERENCES mg_memory_nodes(id) ON DELETE CASCADE,
        target_id  UUID NOT NULL REFERENCES mg_memory_nodes(id) ON DELETE CASCADE,
        edge_type  TEXT NOT NULL CHECK (edge_type IN ('semantic','conflicts','updates','related')),
        weight     FLOAT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await this.sql`
      CREATE TABLE IF NOT EXISTS mg_fleets (
        id         TEXT PRIMARY KEY,
        name       TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await this.sql`
      CREATE TABLE IF NOT EXISTS mg_fleet_agents (
        id          TEXT PRIMARY KEY,
        fleet_id    TEXT NOT NULL REFERENCES mg_fleets(id) ON DELETE CASCADE,
        session_id  TEXT NOT NULL,
        agent_color TEXT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (fleet_id, agent_color)
      )
    `;

    await this.migrateExistingNodeTable();
    await this.createIndexes();
  }

  async saveMessages(sessionId: string, messages: Message[]): Promise<void> {
    await this.saveMessagesAt(sessionId, 0, messages);
  }

  async saveMessagesAt(sessionId: string, startIndex: number, messages: Message[]): Promise<void> {
    for (const [index, message] of messages.entries()) {
      await this.sql`
        INSERT INTO mg_message_buffer (session_id, message_index, role, content)
        VALUES (${sessionId}, ${startIndex + index}, ${message.role}, ${message.content})
        ON CONFLICT (session_id, message_index)
        DO UPDATE SET role = EXCLUDED.role, content = EXCLUDED.content
      `;
    }
  }

  async saveSegment(segment: TopicSegment): Promise<TopicSegment> {
    const rows = await this.sql<TopicSegmentRow[]>`
      INSERT INTO mg_segments (id, session_id, start_index, end_index, topic_order, drift_score, created_at)
      VALUES (
        ${segment.id},
        ${segment.sessionId},
        ${segment.startIndex},
        ${segment.endIndex},
        ${segment.topicOrder},
        ${segment.driftScore},
        ${segment.createdAt}
      )
      ON CONFLICT (session_id, start_index, end_index)
      DO UPDATE SET
        topic_order = EXCLUDED.topic_order,
        drift_score = EXCLUDED.drift_score
      RETURNING *
    `;

    return this.rowToSegment(rows[0]);
  }

  async saveNode(node: TopicNode): Promise<void> {
    await this.sql`
      INSERT INTO mg_topic_nodes (
        id,
        session_id,
        segment_id,
        label,
        summary,
        embedding,
        message_range,
        topic_order,
        drift_score,
        agent_color,
        fleet_id,
        agent_id,
        created_at
      )
      VALUES (
        ${node.id},
        ${node.sessionId},
        ${node.segmentId},
        ${node.label},
        ${node.summary},
        ${toVectorLiteral(node.embedding)}::vector,
        ${node.messageRange},
        ${node.topicOrder},
        ${node.driftScore},
        ${node.agentColor},
        ${node.fleetId},
        ${node.agentId},
        ${node.createdAt}
      )
      ON CONFLICT (segment_id)
      DO UPDATE SET
        id = EXCLUDED.id,
        session_id = EXCLUDED.session_id,
        label = EXCLUDED.label,
        summary = EXCLUDED.summary,
        embedding = EXCLUDED.embedding,
        message_range = EXCLUDED.message_range,
        topic_order = EXCLUDED.topic_order,
        drift_score = EXCLUDED.drift_score,
        agent_color = EXCLUDED.agent_color,
        fleet_id = EXCLUDED.fleet_id,
        agent_id = EXCLUDED.agent_id,
        created_at = EXCLUDED.created_at
    `;
  }

  async saveEdge(edge: TopicEdge): Promise<void> {
    await this.sql`
      INSERT INTO mg_topic_edges (src_id, dst_id, weight, type)
      VALUES (${edge.srcId}, ${edge.dstId}, ${edge.weight}, ${edge.type})
      ON CONFLICT (src_id, dst_id)
      DO UPDATE SET weight = EXCLUDED.weight, type = EXCLUDED.type
    `;
  }

  async getEdgesByType(sessionId: string, type: string): Promise<TopicEdge[]> {
    const rows = await this.sql<EdgeRow[]>`
      SELECT e.*
      FROM mg_topic_edges e
      JOIN mg_topic_nodes n ON n.id = e.src_id
      WHERE n.session_id = ${sessionId}
        AND e.type = ${type}
    `;

    return rows.map((row) => ({
      srcId: row.src_id,
      dstId: row.dst_id,
      weight: row.weight,
      type: row.type,
    }));
  }

  async getEdgesBySession(sessionId: string): Promise<TopicEdge[]> {
    const nodes = await this.getNodesBySession(sessionId);
    if (nodes.length === 0) return [];

    const nodeIds = nodes.map((node) => node.id);
    const rows = await this.sql<EdgeRow[]>`
      SELECT src_id, dst_id, weight, type
      FROM mg_topic_edges
      WHERE src_id = ANY(${this.sql.array(nodeIds)})
         OR dst_id = ANY(${this.sql.array(nodeIds)})
    `;

    return rows.map((row) => ({
      srcId: row.src_id,
      dstId: row.dst_id,
      weight: row.weight,
      type: row.type,
    }));
  }

  async clearSession(sessionId: string): Promise<void> {
    const nodeRows = await this.sql<{ id: string }[]>`
      SELECT id FROM mg_topic_nodes
      WHERE session_id = ${sessionId}
    `;
    const nodeIds = nodeRows.map((row) => row.id);

    if (nodeIds.length > 0) {
      await this.sql`
        DELETE FROM mg_topic_edges
        WHERE src_id = ANY(${this.sql.array(nodeIds)})
           OR dst_id = ANY(${this.sql.array(nodeIds)})
      `;
    }

    await this.sql`
      DELETE FROM mg_topic_nodes
      WHERE session_id = ${sessionId}
    `;

    await this.sql`
      DELETE FROM mg_segments
      WHERE session_id = ${sessionId}
    `;
  }

  async clearSessionGraph(sessionId: string): Promise<void> {
    await this.clearSession(sessionId);
  }

  async getTopicNode(topicNodeId: string, sessionId?: string): Promise<TopicNode | null> {
    const rows = await this.sql<TopicNodeRow[]>`
      SELECT * FROM mg_topic_nodes
      WHERE id = ${topicNodeId}
        ${sessionId ? this.sql`AND session_id = ${sessionId}` : this.sql``}
      LIMIT 1
    `;

    return rows[0] ? this.rowToNode(rows[0]) : null;
  }

  async getNodeBySegment(segmentId: string): Promise<TopicNode | null> {
    const rows = await this.sql<TopicNodeRow[]>`
      SELECT * FROM mg_topic_nodes
      WHERE segment_id = ${segmentId}
      LIMIT 1
    `;

    return rows[0] ? this.rowToNode(rows[0]) : null;
  }

  async getSessionNodeCount(sessionId: string): Promise<number> {
    const rows = await this.sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM mg_topic_nodes
      WHERE session_id = ${sessionId}
    `;

    return rows[0]?.count ?? 0;
  }

  async getNodesBySession(sessionId: string): Promise<TopicNode[]> {
    const rows = await this.sql<TopicNodeRow[]>`
      SELECT * FROM mg_topic_nodes
      WHERE session_id = ${sessionId}
      ORDER BY topic_order ASC, created_at ASC
    `;

    return rows.map((row) => this.rowToNode(row));
  }

  async getSegmentsBySession(sessionId: string): Promise<TopicSegment[]> {
    const rows = await this.sql<TopicSegmentRow[]>`
      SELECT * FROM mg_segments
      WHERE session_id = ${sessionId}
      ORDER BY topic_order ASC, created_at ASC
    `;

    return rows.map((row) => this.rowToSegment(row));
  }

  async insertMemories(nodes: MemoryNodeInsert[]): Promise<void> {
    if (nodes.length === 0) return;

    const rows = nodes.map((node) => ({
      id: node.id,
      segment_id: node.segmentId,
      topic_node_id: node.topicNodeId,
      agent_id: node.agentId,
      session_id: node.sessionId,
      memory_type: node.memoryType,
      source_type: node.sourceType,
      subject: node.subject,
      predicate: node.predicate,
      value: node.value,
      confidence: node.confidence,
      embedding: toVectorLiteral(node.embedding),
      source_url: node.sourceUrl,
      source_title: node.sourceTitle,
      superseded_by: node.supersededBy,
      decayed: node.decayed,
      agent_color: node.agentColor,
      fleet_id: node.fleetId,
    }));

    await this.sql`
      INSERT INTO mg_memory_nodes ${this.sql(
        rows,
        "id",
        "segment_id",
        "topic_node_id",
        "agent_id",
        "session_id",
        "memory_type",
        "source_type",
        "subject",
        "predicate",
        "value",
        "confidence",
        "embedding",
        "source_url",
        "source_title",
        "superseded_by",
        "decayed",
        "agent_color",
        "fleet_id",
      )}
    `;
  }

  async getMemoriesBySegment(segmentId: string): Promise<MemoryNode[]> {
    const rows = await this.sql<MemoryNodeRow[]>`
      SELECT * FROM mg_memory_nodes
      WHERE segment_id = ${segmentId}
      ORDER BY created_at ASC
    `;

    return rows.map((row) => this.rowToMemoryNode(row));
  }

  async getMemoriesByTopic(topicNodeId: string): Promise<MemoryNode[]> {
    const rows = await this.sql<MemoryNodeRow[]>`
      SELECT * FROM mg_memory_nodes
      WHERE topic_node_id = ${topicNodeId}
        AND decayed = false
        AND superseded_by IS NULL
      ORDER BY created_at ASC
    `;

    return rows.map((row) => this.rowToMemoryNode(row));
  }

  async getMemoriesBySession(sessionId: string): Promise<MemoryNode[]> {
    const rows = await this.sql<MemoryNodeRow[]>`
      SELECT * FROM mg_memory_nodes
      WHERE session_id = ${sessionId}
      ORDER BY created_at ASC
    `;

    return rows.map((row) => this.rowToMemoryNode(row));
  }

  async searchMemories(
    embedding: number[],
    sessionId: string,
    limit: number,
    minSimilarity: number,
  ): Promise<(MemoryNode & { similarity: number })[]> {
    const rows = await this.sql<Array<MemoryNodeRow & { similarity: number }>>`
      SELECT *, 1 - (embedding <=> ${toVectorLiteral(embedding)}::vector) AS similarity
      FROM mg_memory_nodes
      WHERE session_id = ${sessionId}
        AND decayed = false
        AND superseded_by IS NULL
        AND 1 - (embedding <=> ${toVectorLiteral(embedding)}::vector) >= ${minSimilarity}
      ORDER BY similarity DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      ...this.rowToMemoryNode(row),
      similarity: row.similarity,
    }));
  }

  async buildMemoryEdges(topicNodeId: string, sessionId: string, threshold: number): Promise<void> {
    try {
      const memories = (await this.getMemoriesByTopic(topicNodeId))
        .filter((memory) => memory.sessionId === sessionId);
      if (memories.length < 2) return;

      for (let sourceIndex = 0; sourceIndex < memories.length; sourceIndex += 1) {
        const source = memories[sourceIndex];
        if (!source) continue;

        for (let targetIndex = sourceIndex + 1; targetIndex < memories.length; targetIndex += 1) {
          const target = memories[targetIndex];
          if (!target || source.id === target.id) continue;

          const similarity = cosineSimilarity(source.embedding, target.embedding);
          if (!Number.isFinite(similarity) || similarity < threshold) continue;

          const existing = await this.sql<{ id: string }[]>`
            SELECT id FROM mg_memory_edges
            WHERE (source_id = ${source.id}::uuid AND target_id = ${target.id}::uuid)
               OR (source_id = ${target.id}::uuid AND target_id = ${source.id}::uuid)
            LIMIT 1
          `;
          if (existing.length > 0) continue;

          await this.sql`
            INSERT INTO mg_memory_edges (source_id, target_id, edge_type, weight)
            VALUES (${source.id}::uuid, ${target.id}::uuid, 'semantic', ${similarity})
          `;
        }
      }
    } catch (error) {
      console.warn("GraphStore memory edge build warning:", error);
    }
  }

  async getTopKSimilar(nodeId: string, embedding: number[], sessionId: string, k: number): Promise<TopicNode[]> {
    return this.getSimilarNodes(embedding, sessionId, { k, excludeNodeId: nodeId });
  }

  async getSimilarNodes(
    embedding: number[],
    sessionId: string,
    options: { k?: number; excludeNodeId?: string; minSimilarity?: number } = {},
  ): Promise<TopicNode[]> {
    const rows = await this.sql<TopicNodeRow[]>`
      SELECT *, 1 - (embedding <=> ${toVectorLiteral(embedding)}::vector) AS similarity
      FROM mg_topic_nodes
      WHERE session_id = ${sessionId}
        ${options.excludeNodeId ? this.sql`AND id != ${options.excludeNodeId}` : this.sql``}
        ${options.minSimilarity === undefined ? this.sql`` : this.sql`AND 1 - (embedding <=> ${toVectorLiteral(embedding)}::vector) >= ${options.minSimilarity}`}
      ORDER BY embedding <=> ${toVectorLiteral(embedding)}::vector ASC
      LIMIT ${options.k ?? 5}
    `;

    return rows.map((row) => this.rowToNode(row));
  }

  async getSimilarNodesAcrossFleet(
    fleetId: string,
    embedding: number[],
    options: { k?: number; excludeNodeId?: string; minSimilarity?: number; agentColor?: string } = {},
  ): Promise<TopicNode[]> {
    const rows = await this.sql<TopicNodeRow[]>`
      SELECT *, 1 - (embedding <=> ${toVectorLiteral(embedding)}::vector) AS similarity
      FROM mg_topic_nodes
      WHERE fleet_id = ${fleetId}
        ${options.agentColor ? this.sql`AND agent_color = ${options.agentColor}` : this.sql``}
        ${options.excludeNodeId ? this.sql`AND id != ${options.excludeNodeId}` : this.sql``}
        ${options.minSimilarity === undefined ? this.sql`` : this.sql`AND 1 - (embedding <=> ${toVectorLiteral(embedding)}::vector) >= ${options.minSimilarity}`}
      ORDER BY embedding <=> ${toVectorLiteral(embedding)}::vector ASC
      LIMIT ${options.k ?? 5}
    `;

    return rows.map((row) => this.rowToNode(row));
  }

  async getNodesByColor(fleetId: string, agentColor: string): Promise<TopicNode[]> {
    const rows = await this.sql<TopicNodeRow[]>`
      SELECT * FROM mg_topic_nodes
      WHERE fleet_id = ${fleetId}
        AND agent_color = ${agentColor}
      ORDER BY topic_order ASC, created_at ASC
    `;

    return rows.map((row) => this.rowToNode(row));
  }

  async saveFleet(fleetId: string, name?: string): Promise<void> {
    await this.sql`
      INSERT INTO mg_fleets (id, name)
      VALUES (${fleetId}, ${name ?? null})
      ON CONFLICT (id)
      DO UPDATE SET name = COALESCE(EXCLUDED.name, mg_fleets.name)
    `;
  }

  async saveFleetAgent(agent: {
    id: string;
    fleetId: string;
    sessionId: string;
    agentColor: string;
  }): Promise<void> {
    await this.sql`
      INSERT INTO mg_fleet_agents (id, fleet_id, session_id, agent_color)
      VALUES (${agent.id}, ${agent.fleetId}, ${agent.sessionId}, ${agent.agentColor})
      ON CONFLICT (fleet_id, agent_color)
      DO UPDATE SET
        id = EXCLUDED.id,
        session_id = EXCLUDED.session_id
    `;
  }

  async getFleetAgents(fleetId: string): Promise<FleetAgentRecord[]> {
    const rows = await this.sql<Array<{
      id: string;
      fleet_id: string;
      session_id: string;
      agent_color: string;
      created_at: Date;
    }>>`
      SELECT * FROM mg_fleet_agents
      WHERE fleet_id = ${fleetId}
      ORDER BY created_at ASC
    `;

    return rows.map((row) => ({
      id: row.id,
      fleetId: row.fleet_id,
      sessionId: row.session_id,
      agentColor: row.agent_color,
      createdAt: row.created_at,
    }));
  }

  async tagSessionNodes(sessionId: string, metadata: {
    fleetId: string | null;
    agentId: string | null;
    agentColor: string | null;
  }): Promise<void> {
    await this.sql`
      UPDATE mg_topic_nodes
      SET
        fleet_id = ${metadata.fleetId},
        agent_id = ${metadata.agentId},
        agent_color = ${metadata.agentColor}
      WHERE session_id = ${sessionId}
    `;
  }

  async getPreviousNode(sessionId: string, topicOrder: number): Promise<TopicNode | null> {
    const rows = await this.sql<TopicNodeRow[]>`
      SELECT *
      FROM mg_topic_nodes
      WHERE session_id = ${sessionId}
        AND topic_order = ${topicOrder - 1}
      LIMIT 1
    `;

    return rows[0] ? this.rowToNode(rows[0]) : null;
  }

  async nodeSimilarity(nodeAId: string, nodeBId: string): Promise<number> {
    const rows = await this.sql<{ similarity: number }[]>`
      SELECT 1 - (n1.embedding <=> n2.embedding) AS similarity
      FROM mg_topic_nodes n1, mg_topic_nodes n2
      WHERE n1.id = ${nodeAId}
        AND n2.id = ${nodeBId}
    `;

    return rows[0]?.similarity ?? 0;
  }

  async getNeighbours(nodeIds: string[], hopDepth: number, sessionId?: string): Promise<TopicNode[]> {
    const visited = new Set(nodeIds);
    let frontier = [...nodeIds];

    for (let hop = 0; hop < hopDepth; hop += 1) {
      if (frontier.length === 0) break;

      const edges = await this.sql<EdgeRow[]>`
        SELECT * FROM mg_topic_edges
        WHERE src_id = ANY(${this.sql.array(frontier)})
           OR dst_id = ANY(${this.sql.array(frontier)})
      `;

      const nextFrontier: string[] = [];
      for (const edge of edges) {
        const candidates = [edge.src_id, edge.dst_id];
        for (const candidate of candidates) {
          if (!visited.has(candidate)) {
            visited.add(candidate);
            nextFrontier.push(candidate);
          }
        }
      }

      frontier = nextFrontier;
    }

    const ids = Array.from(visited);
    if (ids.length === 0) return [];

    const rows = await this.sql<TopicNodeRow[]>`
      SELECT * FROM mg_topic_nodes
      WHERE id = ANY(${this.sql.array(ids)})
        ${sessionId ? this.sql`AND session_id = ${sessionId}` : this.sql``}
      ORDER BY topic_order ASC, created_at ASC
    `;

    return rows.map((row) => this.rowToNode(row));
  }

  async getBufferMessages(sessionId: string, start: number, end: number, maxChars = 600): Promise<Message[]> {
    const rows = await this.sql<MessageRow[]>`
      SELECT * FROM mg_message_buffer
      WHERE session_id = ${sessionId}
        AND message_index >= ${start}
        AND message_index <= ${end}
      ORDER BY message_index ASC
    `;

    return rows.map((row) => ({
      role: row.role,
      content: row.role === "assistant" ? this.cleanAssistantMessage(row.content, maxChars) : row.content,
    }));
  }

  async absorbNodes(nodes: TopicNode[], targetSessionId: string, options: AbsorbOptions = {}): Promise<TopicNode[]> {
    const copiedNodes: TopicNode[] = [];
    const nextMessageIndex = await this.getNextMessageIndex(targetSessionId);
    const nextTopicOrder = await this.getNextTopicOrder(targetSessionId);

    for (const [index, node] of nodes.entries()) {
      const messageIndex = nextMessageIndex + index;
      await this.saveMessagesAt(targetSessionId, messageIndex, [{
        role: "assistant",
        content: this.formatGraftedMemoryMessage(node),
      }]);

      const segment = await this.saveSegment({
        id: randomUUID(),
        sessionId: targetSessionId,
        startIndex: messageIndex,
        endIndex: messageIndex,
        topicOrder: nextTopicOrder + index,
        driftScore: node.driftScore,
        createdAt: new Date(),
      });

      const copy: TopicNode = {
        ...node,
        id: randomUUID(),
        sessionId: targetSessionId,
        segmentId: segment.id,
        messageRange: [segment.startIndex, segment.endIndex],
        topicOrder: segment.topicOrder,
        driftScore: segment.driftScore,
        agentColor: options.agentColor ?? node.agentColor,
        fleetId: options.fleetId ?? node.fleetId,
        agentId: options.agentId ?? node.agentId,
        createdAt: new Date(),
      };

      await this.saveNode(copy);
      await this.copyActiveMemoriesForAbsorbedNode(node, copy, targetSessionId);
      await this.saveEdge({
        srcId: copy.id,
        dstId: node.id,
        weight: 1,
        type: "grafted",
      });
      copiedNodes.push(copy);
    }

    return copiedNodes;
  }

  private async copyActiveMemoriesForAbsorbedNode(
    sourceNode: TopicNode,
    copiedNode: TopicNode,
    targetSessionId: string,
  ): Promise<void> {
    await this.sql`
      INSERT INTO mg_memory_nodes (
        segment_id,
        topic_node_id,
        agent_id,
        session_id,
        memory_type,
        source_type,
        subject,
        predicate,
        value,
        confidence,
        embedding,
        source_url,
        source_title,
        superseded_by,
        decayed,
        agent_color,
        fleet_id
      )
      SELECT
        ${copiedNode.segmentId},
        ${copiedNode.id},
        ${copiedNode.agentId},
        ${targetSessionId},
        memory_type,
        source_type,
        subject,
        predicate,
        value,
        confidence,
        embedding,
        source_url,
        source_title,
        NULL,
        FALSE,
        ${copiedNode.agentColor},
        ${copiedNode.fleetId}
      FROM mg_memory_nodes
      WHERE topic_node_id = ${sourceNode.id}
        AND session_id = ${sourceNode.sessionId}
        AND decayed = FALSE
        AND superseded_by IS NULL
    `;
  }

  async rebuildEdgesForSession(sessionId: string, semanticTopK = 5, semanticThreshold = 0.6): Promise<void> {
    const nodes = await this.getNodesBySession(sessionId);
    const nodeIds = nodes.map((node) => node.id);

    if (nodeIds.length > 0) {
      await this.sql`
        DELETE FROM mg_topic_edges
        WHERE type != 'grafted'
          AND (
            src_id = ANY(${this.sql.array(nodeIds)})
            OR dst_id = ANY(${this.sql.array(nodeIds)})
          )
      `;
    }

    for (let index = 1; index < nodes.length; index += 1) {
      const current = nodes[index];
      const previous = nodes[index - 1];
      if (!current || !previous) continue;

      await this.saveEdge({
        srcId: current.id,
        dstId: previous.id,
        weight: await this.nodeSimilarity(current.id, previous.id),
        type: "temporal",
      });
    }

    for (const node of nodes) {
      const similarNodes = await this.getSimilarNodes(node.embedding, sessionId, {
        k: semanticTopK,
        excludeNodeId: node.id,
        minSimilarity: semanticThreshold,
      });

      for (const similarNode of similarNodes) {
        await this.saveEdge({
          srcId: node.id,
          dstId: similarNode.id,
          weight: await this.nodeSimilarity(node.id, similarNode.id),
          type: "semantic",
        });
      }
    }
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  private async migrateExistingNodeTable(): Promise<void> {
    await this.sql`ALTER TABLE mg_segments DROP COLUMN IF EXISTS node_id`;
    await this.sql`ALTER TABLE mg_topic_nodes ADD COLUMN IF NOT EXISTS segment_id TEXT`;
    await this.sql`ALTER TABLE mg_topic_nodes ADD COLUMN IF NOT EXISTS topic_order INT NOT NULL DEFAULT 0`;
    await this.sql`ALTER TABLE mg_topic_nodes ADD COLUMN IF NOT EXISTS drift_score FLOAT NOT NULL DEFAULT 0`;
    await this.sql`ALTER TABLE mg_topic_nodes ADD COLUMN IF NOT EXISTS agent_color TEXT`;
    await this.sql`ALTER TABLE mg_topic_nodes ADD COLUMN IF NOT EXISTS fleet_id TEXT`;
    await this.sql`ALTER TABLE mg_topic_nodes ADD COLUMN IF NOT EXISTS agent_id TEXT`;

    await this.sql`
      UPDATE mg_topic_nodes n
      SET
        topic_order = s.topic_order,
        drift_score = s.drift_score
      FROM mg_segments s
      WHERE s.id = n.segment_id
    `;

    await this.sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'mg_topic_nodes_segment_id_key'
        ) THEN
          ALTER TABLE mg_topic_nodes
          ADD CONSTRAINT mg_topic_nodes_segment_id_key UNIQUE (segment_id);
        END IF;
      END $$;
    `;
  }

  private async createIndexes(): Promise<void> {
    await this.sql`
      CREATE INDEX IF NOT EXISTS mg_message_buffer_session_idx
      ON mg_message_buffer(session_id, message_index)
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS mg_segments_session_idx
      ON mg_segments(session_id, topic_order)
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS mg_nodes_session_idx
      ON mg_topic_nodes(session_id, topic_order)
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS mg_nodes_fleet_idx
      ON mg_topic_nodes(fleet_id, agent_color)
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS mg_fleet_agents_fleet_idx
      ON mg_fleet_agents(fleet_id, agent_color)
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS mg_nodes_embedding_idx
      ON mg_topic_nodes
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_memory_nodes_topic
      ON mg_memory_nodes(topic_node_id)
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_memory_nodes_segment
      ON mg_memory_nodes(segment_id)
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_memory_nodes_session
      ON mg_memory_nodes(session_id)
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_memory_nodes_embedding
      ON mg_memory_nodes
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_memory_edges_source
      ON mg_memory_edges(source_id)
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_memory_edges_target
      ON mg_memory_edges(target_id)
    `;
  }

  private cleanAssistantMessage(content: string, maxChars: number): string {
    const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, "[code omitted]");
    if (withoutCodeBlocks.length <= maxChars) return withoutCodeBlocks;

    const truncated = withoutCodeBlocks.slice(0, maxChars);
    const sentenceEnd = Math.max(
      truncated.lastIndexOf("."),
      truncated.lastIndexOf("!"),
      truncated.lastIndexOf("?"),
    );

    if (sentenceEnd >= Math.floor(maxChars * 0.5)) {
      return `${truncated.slice(0, sentenceEnd + 1)} [truncated]`;
    }

    return `${truncated.trimEnd()} [truncated]`;
  }

  private async getNextMessageIndex(sessionId: string): Promise<number> {
    const rows = await this.sql<{ next_index: number | null }[]>`
      SELECT COALESCE(MAX(message_index) + 1, 0) AS next_index
      FROM mg_message_buffer
      WHERE session_id = ${sessionId}
    `;

    return rows[0]?.next_index ?? 0;
  }

  private async getNextTopicOrder(sessionId: string): Promise<number> {
    const rows = await this.sql<{ next_order: number | null }[]>`
      SELECT COALESCE(MAX(topic_order) + 1, 1) AS next_order
      FROM mg_topic_nodes
      WHERE session_id = ${sessionId}
    `;

    return rows[0]?.next_order ?? 1;
  }

  private formatGraftedMemoryMessage(node: TopicNode): string {
    return [
      `Grafted memory: ${node.label}`,
      node.summary,
    ].filter(Boolean).join("\n");
  }

  private rowToNode(row: TopicNodeRow): TopicNode {
    const [start = 0, end = start] = row.message_range ?? [];

    return {
      id: row.id,
      sessionId: row.session_id,
      segmentId: row.segment_id,
      label: row.label ?? "Untitled topic",
      summary: row.summary ?? "",
      embedding: parseVector(row.embedding),
      messageRange: [start, end],
      topicOrder: row.topic_order ?? 0,
      driftScore: row.drift_score ?? 0,
      agentColor: row.agent_color,
      fleetId: row.fleet_id,
      agentId: row.agent_id,
      createdAt: row.created_at,
    };
  }

  private rowToMemoryNode(row: MemoryNodeRow): MemoryNode {
    return {
      id: row.id,
      segmentId: row.segment_id,
      topicNodeId: row.topic_node_id,
      agentId: row.agent_id,
      sessionId: row.session_id,
      memoryType: row.memory_type,
      sourceType: row.source_type,
      subject: row.subject,
      predicate: row.predicate,
      value: row.value,
      confidence: row.confidence,
      embedding: parseVector(row.embedding),
      sourceUrl: row.source_url,
      sourceTitle: row.source_title,
      supersededBy: row.superseded_by,
      decayed: row.decayed,
      agentColor: row.agent_color,
      fleetId: row.fleet_id,
      createdAt: row.created_at,
    };
  }

  private rowToSegment(row: TopicSegmentRow | undefined): TopicSegment {
    if (!row) {
      throw new Error("Expected segment row.");
    }

    return {
      id: row.id,
      sessionId: row.session_id,
      startIndex: row.start_index,
      endIndex: row.end_index,
      topicOrder: row.topic_order,
      driftScore: row.drift_score,
      createdAt: row.created_at,
    };
  }
}
