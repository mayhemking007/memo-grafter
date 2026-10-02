ALTER TABLE mg_memory_nodes ADD COLUMN IF NOT EXISTS source_spans JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE mg_memory_evidence ADD COLUMN IF NOT EXISTS source_spans JSONB NOT NULL DEFAULT '[]'::jsonb;
