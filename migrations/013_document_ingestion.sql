ALTER TABLE mg_ingestion_runs ADD COLUMN IF NOT EXISTS document_payload JSONB;
ALTER TABLE mg_ingestion_runs ADD COLUMN IF NOT EXISTS prepared_payload JSONB;
ALTER TABLE mg_ingestion_runs ADD COLUMN IF NOT EXISTS result_payload JSONB;
ALTER TABLE mg_ingestion_runs ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ;
ALTER TABLE mg_ingestion_runs ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
-- Document replacement can reuse ranges; ordinary message-run uniqueness stays intact.
DO $$ DECLARE constraint_name TEXT; BEGIN
  FOR constraint_name IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'mg_ingestion_runs'::regclass AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (session_id, start_index, end_index, kind)'
  LOOP EXECUTE format('ALTER TABLE mg_ingestion_runs DROP CONSTRAINT %I', constraint_name); END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS mg_ingestion_runs_current_message_range_idx
  ON mg_ingestion_runs(session_id, start_index, end_index, kind)
  WHERE document_payload IS NULL AND superseded_at IS NULL;
