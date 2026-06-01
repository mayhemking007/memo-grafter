ALTER TABLE mg_topic_nodes
ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE mg_memory_nodes
ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS mg_topic_nodes_tags_idx
ON mg_topic_nodes USING GIN(tags);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_tags
ON mg_memory_nodes USING GIN(tags);
