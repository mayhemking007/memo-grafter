import { mgIndex, mgTable } from "./builders.js";

export const agentRunTables = [
  mgTable({
    name: "mg_agent_identities", description: "Persistent agent identities within a tenant, independent of fleet workers.",
    columns: [
      { name: "tenant_id", type: "text", primaryKey: true },
      { name: "agent_id", type: "text", primaryKey: true },
      { name: "created_at", type: "timestamptz", default: "now()" },
    ],
  }),
  mgTable({
    name: "mg_agent_runs", description: "Agent task execution records, distinct from memory ingestion jobs.",
    columns: [
      { name: "tenant_id", type: "text", primaryKey: true },
      { name: "run_id", type: "text", primaryKey: true },
      { name: "agent_id", type: "text" },
      { name: "task_id", type: "text" },
      { name: "objective", type: "text" },
      { name: "session_id", type: "text", nullable: true },
      { name: "project_id", type: "text", nullable: true },
      { name: "status", type: "text", default: "'running'", check: "status IN ('running','interrupted','succeeded','failed','cancelled')" },
      { name: "created_at", type: "timestamptz", default: "now()" },
      { name: "updated_at", type: "timestamptz", default: "now()" },
    ], constraints: ["FOREIGN KEY (tenant_id, agent_id) REFERENCES mg_agent_identities(tenant_id, agent_id)"],
  }),
  mgTable({
    name: "mg_agent_events", description: "Immutable ordered agent events with retry-safe IDs and original evidence.",
    columns: [
      { name: "tenant_id", type: "text", primaryKey: true },
      { name: "run_id", type: "text", primaryKey: true },
      { name: "event_id", type: "text", primaryKey: true },
      { name: "sequence", type: "int", check: "sequence >= 0" },
      { name: "event", type: "jsonb", check: "jsonb_typeof(event) = 'object'" },
      { name: "received_at", type: "timestamptz", default: "now()" },
    ], constraints: ["UNIQUE (tenant_id, run_id, sequence)", "FOREIGN KEY (tenant_id, run_id) REFERENCES mg_agent_runs(tenant_id, run_id)"],
  }),
];
export const agentRunIndexes = [
  mgIndex({ name: "mg_agent_events_tool_idx", table: "mg_agent_events", description: "Unique tool-call/result correlation within a run." }),
  mgIndex({ name: "mg_agent_runs_owner_idx", table: "mg_agent_runs", description: "Runs by tenant and owning agent." }),
  mgIndex({ name: "mg_agent_runs_project_idx", table: "mg_agent_runs", description: "Project-shared runs within a tenant." }),
];
