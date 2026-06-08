ALTER TABLE mg_memory_nodes
  ADD COLUMN IF NOT EXISTS forgotten BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE mg_memory_nodes
  ADD COLUMN IF NOT EXISTS forgotten_at TIMESTAMPTZ;

ALTER TABLE mg_topic_nodes
  ADD COLUMN IF NOT EXISTS suppressed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE mg_topic_nodes
  ADD COLUMN IF NOT EXISTS suppressed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_memory_nodes_active_lifecycle
  ON mg_memory_nodes(session_id, forgotten, decayed)
  WHERE forgotten = FALSE;

CREATE INDEX IF NOT EXISTS idx_topic_nodes_active_lifecycle
  ON mg_topic_nodes(session_id, suppressed)
  WHERE suppressed = FALSE;
