CREATE TYPE release_request_status AS ENUM ('queued', 'running', 'verifying', 'completed', 'failed');

ALTER TABLE subscriptions
  ADD COLUMN release_generation integer NOT NULL DEFAULT 0 CHECK (release_generation >= 0);

CREATE TABLE release_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  generation integer NOT NULL CHECK (generation > 0),
  status release_request_status NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  target_season_cid text NOT NULL,
  target_entry_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_error text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscription_id, generation)
);

CREATE INDEX release_requests_recovery_idx
  ON release_requests(status, updated_at)
  WHERE status IN ('queued', 'running', 'verifying');

CREATE TRIGGER release_requests_updated_at
  BEFORE UPDATE ON release_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
