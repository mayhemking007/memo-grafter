import postgres, { type Sql } from "postgres";
import type { Message, TopicEdge, TopicNode, TopicSegment } from "../types.js";
import { parseVector, toVectorLiteral } from "../utils/vectorLiteral.js";

interface TopicNodeRow {
  id: string;
  session_id: string;
  segment_id: string;
  label: string | null;
  summary: string | null;
  embedding: string | number[] | null;
  message_range: number[] | null;
  topic_order?: number | null;
  drift_score?: number | null;
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
  type: "semantic" | "temporal";
}

export class GraphStore {
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
      CREATE INDEX IF NOT EXISTS mg_segments_session_idx
      ON mg_segments(session_id, topic_order)
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS mg_nodes_session_idx
      ON mg_topic_nodes(session_id)
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS mg_nodes_embedding_idx
      ON mg_topic_nodes
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `;

    await this.sql`ALTER TABLE mg_segments DROP COLUMN IF EXISTS node_id`;
    await this.sql`ALTER TABLE mg_topic_nodes ADD COLUMN IF NOT EXISTS segment_id TEXT`;
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

  async saveMessages(sessionId: string, messages: Message[]): Promise<void> {
    for (const [index, message] of messages.entries()) {
      await this.sql`
        INSERT INTO mg_message_buffer (session_id, message_index, role, content)
        VALUES (${sessionId}, ${index}, ${message.role}, ${message.content})
        ON CONFLICT DO NOTHING
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
      INSERT INTO mg_topic_nodes (id, session_id, segment_id, label, summary, embedding, message_range, created_at)
      VALUES (
        ${node.id},
        ${node.sessionId},
        ${node.segmentId},
        ${node.label},
        ${node.summary},
        ${toVectorLiteral(node.embedding)}::vector,
        ${node.messageRange},
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

  async getNodeBySegment(segmentId: string): Promise<TopicNode | null> {
    const rows = await this.sql<TopicNodeRow[]>`
      SELECT * FROM mg_topic_nodes
      WHERE segment_id = ${segmentId}
      LIMIT 1
    `;

    return rows[0] ? this.rowToNode(rows[0]) : null;
  }

  async getNodesBySession(sessionId: string): Promise<TopicNode[]> {
    const rows = await this.sql<TopicNodeRow[]>`
      SELECT n.*, s.topic_order, s.drift_score
      FROM mg_topic_nodes n
      INNER JOIN mg_segments s ON s.id = n.segment_id
      WHERE n.session_id = ${sessionId}
      ORDER BY s.topic_order ASC, n.created_at ASC
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

  async getTopKSimilar(nodeId: string, embedding: number[], sessionId: string, k: number): Promise<TopicNode[]> {
    const rows = await this.sql<TopicNodeRow[]>`
      SELECT n.*, s.topic_order, s.drift_score
      FROM mg_topic_nodes n
      INNER JOIN mg_segments s ON s.id = n.segment_id
      WHERE n.session_id = ${sessionId}
        AND n.id != ${nodeId}
      ORDER BY n.embedding <=> ${toVectorLiteral(embedding)}::vector ASC
      LIMIT ${k}
    `;

    return rows.map((row) => this.rowToNode(row));
  }

  async getPreviousNode(sessionId: string, topicOrder: number): Promise<TopicNode | null> {
    const rows = await this.sql<TopicNodeRow[]>`
      SELECT n.*
      FROM mg_topic_nodes n
      INNER JOIN mg_segments s ON s.id = n.segment_id
      WHERE s.session_id = ${sessionId}
        AND s.topic_order = ${topicOrder - 1}
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

  async clearSessionGraph(sessionId: string): Promise<void> {
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

  async getNeighbours(nodeIds: string[], hopDepth: number): Promise<TopicNode[]> {
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
      SELECT n.*, s.topic_order, s.drift_score
      FROM mg_topic_nodes n
      INNER JOIN mg_segments s ON s.id = n.segment_id
      WHERE n.id = ANY(${this.sql.array(ids)})
      ORDER BY s.topic_order ASC, n.created_at ASC
    `;

    return rows.map((row) => this.rowToNode(row));
  }

  async getBufferMessages(sessionId: string, start: number, end: number, maxCharsPerMessage = 700): Promise<Message[]> {
    const rows = await this.sql<MessageRow[]>`
      SELECT * FROM mg_message_buffer
      WHERE session_id = ${sessionId}
        AND message_index >= ${start}
        AND message_index <= ${end}
      ORDER BY message_index ASC
    `;

    return rows.map((row) => ({
      role: row.role,
      content: row.role === 'assistant' && row.content.length > maxCharsPerMessage
      ? row.content.slice(0, maxCharsPerMessage) + '...[truncated]'
      : row.content,
    }));
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  private rowToNode(row: TopicNodeRow): TopicNode {
    const [start = 0, end = start] = row.message_range ?? [];
    const node: TopicNode = {
      id: row.id,
      sessionId: row.session_id,
      segmentId: row.segment_id,
      label: row.label ?? "Untitled topic",
      summary: row.summary ?? "",
      embedding: parseVector(row.embedding),
      messageRange: [start, end],
      createdAt: row.created_at,
    };

    if (row.topic_order !== undefined && row.topic_order !== null) {
      node.topicOrder = row.topic_order;
    }

    if (row.drift_score !== undefined && row.drift_score !== null) {
      node.driftScore = row.drift_score;
    }

    return node;
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
