import type { Sql } from "postgres";

export interface StudioSessionSummary {
  id: string;
  messageCount: number;
  topicCount: number;
  memoryCount: number;
  lastUpdatedAt: Date | null;
}

export interface StudioTopicEdge {
  srcId: string;
  dstId: string;
  weight: number;
  type: string;
}

export interface StudioMemorySearchResult {
  id: string;
  segmentId: string;
  topicNodeId: string;
  agentId: string | null;
  sessionId: string;
  memoryType: string;
  sourceType: string;
  subject: string;
  predicate: string;
  value: string;
  confidence: number;
  tags?: string[];
  source?: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  supersededBy: string | null;
  decayed: boolean;
  forgotten: boolean;
  forgottenAt: Date | null;
  hasConflict: boolean;
  agentColor: string | null;
  fleetId: string | null;
  createdAt: Date;
}

export interface StudioMemoryEdge {
  id: string;
  sourceId: string;
  targetId: string;
  edgeType: string;
  weight: number;
  createdAt: Date;
}

interface SessionSummaryRow {
  id: string;
  message_count: number | null;
  topic_count: number | null;
  memory_count: number | null;
  last_updated_at: Date | null;
}

interface TopicEdgeRow {
  src_id: string;
  dst_id: string;
  weight: number;
  type: string;
}

interface MemoryRow {
  id: string;
  segment_id: string;
  topic_node_id: string;
  agent_id: string | null;
  session_id: string;
  memory_type: string;
  source_type: string;
  subject: string;
  predicate: string;
  value: string;
  confidence: number;
  tags: string[] | null;
  source: string | null;
  source_url: string | null;
  source_title: string | null;
  superseded_by: string | null;
  decayed: boolean;
  forgotten: boolean | null;
  forgotten_at: Date | null;
  has_conflict: boolean | null;
  agent_color: string | null;
  fleet_id: string | null;
  created_at: Date;
}

interface MemoryEdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  weight: number | null;
  created_at: Date;
}

export class StudioRepository {
  constructor(private readonly sql: Sql) {}

  async listSessions(): Promise<StudioSessionSummary[]> {
    const rows = await this.sql<SessionSummaryRow[]>`
      WITH sessions AS (
        SELECT session_id FROM mg_message_buffer
        UNION
        SELECT session_id FROM mg_segments
        UNION
        SELECT session_id FROM mg_topic_nodes
        UNION
        SELECT session_id FROM mg_memory_nodes
        UNION
        SELECT session_id FROM mg_session_ingest_state
      ),
      message_counts AS (
        SELECT session_id, COUNT(*)::int AS message_count, MAX(message_index)::int AS last_message_index
        FROM mg_message_buffer
        GROUP BY session_id
      ),
      topic_counts AS (
        SELECT session_id, COUNT(*)::int AS topic_count, MAX(created_at) AS last_topic_at
        FROM mg_topic_nodes
        GROUP BY session_id
      ),
      memory_counts AS (
        SELECT session_id, COUNT(*)::int AS memory_count, MAX(created_at) AS last_memory_at
        FROM mg_memory_nodes
        GROUP BY session_id
      ),
      ingest_updates AS (
        SELECT session_id, MAX(updated_at) AS last_ingest_at
        FROM mg_session_ingest_state
        GROUP BY session_id
      )
      SELECT
        sessions.session_id AS id,
        COALESCE(message_counts.message_count, 0)::int AS message_count,
        COALESCE(topic_counts.topic_count, 0)::int AS topic_count,
        COALESCE(memory_counts.memory_count, 0)::int AS memory_count,
        GREATEST(topic_counts.last_topic_at, memory_counts.last_memory_at, ingest_updates.last_ingest_at) AS last_updated_at
      FROM sessions
      LEFT JOIN message_counts ON message_counts.session_id = sessions.session_id
      LEFT JOIN topic_counts ON topic_counts.session_id = sessions.session_id
      LEFT JOIN memory_counts ON memory_counts.session_id = sessions.session_id
      LEFT JOIN ingest_updates ON ingest_updates.session_id = sessions.session_id
      ORDER BY last_updated_at DESC NULLS LAST, sessions.session_id ASC
    `;

    return rows.map((row) => ({
      id: row.id,
      messageCount: row.message_count ?? 0,
      topicCount: row.topic_count ?? 0,
      memoryCount: row.memory_count ?? 0,
      lastUpdatedAt: row.last_updated_at,
    }));
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    const rows = await this.sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM mg_message_buffer WHERE session_id = ${sessionId}
        UNION
        SELECT 1 FROM mg_segments WHERE session_id = ${sessionId}
        UNION
        SELECT 1 FROM mg_topic_nodes WHERE session_id = ${sessionId}
        UNION
        SELECT 1 FROM mg_memory_nodes WHERE session_id = ${sessionId}
        UNION
        SELECT 1 FROM mg_session_ingest_state WHERE session_id = ${sessionId}
      ) AS exists
    `;

    return rows[0]?.exists ?? false;
  }

  async nodeBelongsToSession(sessionId: string, nodeId: string): Promise<boolean> {
    const rows = await this.sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM mg_topic_nodes
        WHERE session_id = ${sessionId}
          AND id = ${nodeId}
      ) AS exists
    `;

    return rows[0]?.exists ?? false;
  }

  async memoryBelongsToSession(sessionId: string, memoryId: string): Promise<boolean> {
    const rows = await this.sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM mg_memory_nodes
        WHERE session_id = ${sessionId}
          AND id = ${memoryId}::uuid
      ) AS exists
    `;

    return rows[0]?.exists ?? false;
  }

  async getTopicEdgesBySession(sessionId: string): Promise<StudioTopicEdge[]> {
    const rows = await this.sql<TopicEdgeRow[]>`
      SELECT DISTINCT edge.*
      FROM mg_topic_edges edge
      JOIN mg_topic_nodes source ON source.id = edge.src_id
      JOIN mg_topic_nodes target ON target.id = edge.dst_id
      WHERE source.session_id = ${sessionId}
         OR target.session_id = ${sessionId}
      ORDER BY edge.type ASC, edge.src_id ASC, edge.dst_id ASC
    `;

    return rows.map((row) => ({
      srcId: row.src_id,
      dstId: row.dst_id,
      weight: row.weight,
      type: row.type,
    }));
  }

  async getMemoryEdgesBySession(sessionId: string): Promise<StudioMemoryEdge[]> {
    const rows = await this.sql<MemoryEdgeRow[]>`
      SELECT DISTINCT edge.*
      FROM mg_memory_edges edge
      JOIN mg_memory_nodes source ON source.id = edge.source_id
      JOIN mg_memory_nodes target ON target.id = edge.target_id
      WHERE source.session_id = ${sessionId}
        AND target.session_id = ${sessionId}
      ORDER BY edge.created_at ASC, edge.id ASC
    `;

    return rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      edgeType: row.edge_type,
      weight: row.weight ?? 1,
      createdAt: row.created_at,
    }));
  }

  async searchMemories(sessionId: string, query: string, limit = 25): Promise<StudioMemorySearchResult[]> {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const pattern = `%${query}%`;
    const rows = await this.sql<MemoryRow[]>`
      SELECT memory.*
      FROM mg_memory_nodes memory
      JOIN mg_topic_nodes topic ON topic.id = memory.topic_node_id
      WHERE memory.session_id = ${sessionId}
        AND memory.forgotten = FALSE
        AND memory.decayed = FALSE
        AND memory.superseded_by IS NULL
        AND topic.suppressed = FALSE
        AND (
          memory.subject ILIKE ${pattern}
          OR memory.predicate ILIKE ${pattern}
          OR memory.value ILIKE ${pattern}
        )
      ORDER BY memory.created_at DESC, memory.id ASC
      LIMIT ${boundedLimit}
    `;

    return rows.map((row) => this.rowToMemory(row));
  }

  private rowToMemory(row: MemoryRow): StudioMemorySearchResult {
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
      tags: row.tags ?? [],
      ...(row.source ? { source: row.source } : {}),
      sourceUrl: row.source_url,
      sourceTitle: row.source_title,
      supersededBy: row.superseded_by,
      decayed: row.decayed,
      forgotten: row.forgotten ?? false,
      forgottenAt: row.forgotten_at,
      hasConflict: row.has_conflict ?? false,
      agentColor: row.agent_color,
      fleetId: row.fleet_id,
      createdAt: row.created_at,
    };
  }
}
