CREATE TABLE IF NOT EXISTS mg_sessions (
  session_id TEXT PRIMARY KEY,
  label TEXT,
  description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mg_sessions_label_lower_idx
ON mg_sessions(lower(label));
