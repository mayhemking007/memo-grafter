CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS mg_memory_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id TEXT NOT NULL REFERENCES mg_segments(id) ON DELETE CASCADE,
  topic_node_id TEXT NOT NULL REFERENCES mg_topic_nodes(id) ON DELETE CASCADE,
  agent_id TEXT,
  session_id TEXT NOT NULL,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('fact','insight','question','task','reference')),
  source_type TEXT NOT NULL DEFAULT 'conversation' CHECK (source_type IN ('conversation','note','document','code')),
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  value TEXT NOT NULL,
  confidence FLOAT NOT NULL DEFAULT 1.0,
  embedding vector(1536),
  source_url TEXT,
  source_title TEXT,
  superseded_by UUID REFERENCES mg_memory_nodes(id),
  decayed BOOLEAN NOT NULL DEFAULT FALSE,
  agent_color TEXT,
  fleet_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_topic ON mg_memory_nodes(topic_node_id);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_segment ON mg_memory_nodes(segment_id);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_session ON mg_memory_nodes(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_nodes_embedding ON mg_memory_nodes
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS mg_memory_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES mg_memory_nodes(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES mg_memory_nodes(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL CHECK (edge_type IN ('semantic','conflicts','updates','related')),
  weight FLOAT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_edges_source ON mg_memory_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_memory_edges_target ON mg_memory_edges(target_id);
