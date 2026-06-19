// Your application schema entrypoint.
//
// MemoGrafter owns and regenerates mg-schema.ts.
// This file is user-owned and will not be overwritten.
//
// Today, `memo-grafter migrate` manages only MemoGrafter `mg_*` tables.
// If you use Prisma, keep app models in prisma/schema.prisma.
// If you use another migration tool, keep using it for app tables.

export * from "./mg-schema.js";

/*
Example app table SQL for your own migration tool:

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
*/
