CREATE TABLE IF NOT EXISTS mg_agent_identities (
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, agent_id)
);
CREATE TABLE IF NOT EXISTS mg_agent_runs (
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  session_id TEXT,
  project_id TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','interrupted','succeeded','failed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, run_id),
  FOREIGN KEY (tenant_id, agent_id) REFERENCES mg_agent_identities(tenant_id, agent_id)
);
CREATE TABLE IF NOT EXISTS mg_agent_events (
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  sequence INT NOT NULL CHECK (sequence >= 0),
  event JSONB NOT NULL CHECK (jsonb_typeof(event) = 'object'),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, run_id, event_id),
  UNIQUE (tenant_id, run_id, sequence),
  FOREIGN KEY (tenant_id, run_id) REFERENCES mg_agent_runs(tenant_id, run_id)
);
CREATE INDEX IF NOT EXISTS mg_agent_runs_owner_idx ON mg_agent_runs (tenant_id, agent_id, created_at);
CREATE INDEX IF NOT EXISTS mg_agent_runs_project_idx ON mg_agent_runs (tenant_id, project_id, created_at) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mg_agent_events_tool_idx ON mg_agent_events
  (tenant_id, run_id, (event->'data'->>'type'), (event->'data'->>'toolCallId'))
  WHERE event->'data'->>'type' IN ('tool.call','tool.result');
