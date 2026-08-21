CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE media_type AS ENUM ('series', 'movie');
CREATE TYPE subscription_status AS ENUM ('following', 'paused', 'stopped');
CREATE TYPE lifecycle_status AS ENUM ('active', 'completed');
CREATE TYPE run_status AS ENUM ('waiting', 'checking', 'backfilling', 'exception', 'released');
CREATE TYPE quality_tier AS ENUM ('2160p', '1080p', 'unknown');
CREATE TYPE candidate_source AS ENUM ('pan115', 'magnet');
CREATE TYPE candidate_status AS ENUM ('discovered', 'expanded', 'selected', 'submitted', 'verified', 'failed', 'blacklisted');
CREATE TYPE cleanup_status AS ENUM ('pending', 'running', 'completed', 'skipped', 'failed');
CREATE TYPE activity_level AS ENUM ('info', 'warning', 'error');
CREATE TYPE run_outcome AS ENUM ('running', 'succeeded', 'failed', 'cancelled', 'skipped');

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  is_sensitive boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE storage_categories (
  key text PRIMARY KEY CHECK (key IN ('cn_drama', 'us_drama', 'jp_kr_drama', 'tv', 'variety', 'animation', 'documentary', 'movie')),
  label text NOT NULL,
  parent_cid text,
  parent_path text,
  is_configured boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL,
  source text NOT NULL,
  title text NOT NULL,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  year integer CHECK (year BETWEEN 1888 AND 3000),
  media_type media_type NOT NULL,
  region text,
  genres jsonb NOT NULL DEFAULT '[]'::jsonb,
  poster_url text,
  backdrop_url text,
  rating numeric(3,1),
  recommendation text,
  latest_episode integer CHECK (latest_episode >= 0),
  total_episodes integer CHECK (total_episodes > 0),
  summary text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE(source, source_id)
);

CREATE TABLE series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_metadata_id uuid UNIQUE REFERENCES media_metadata(id) ON DELETE SET NULL,
  series_title text NOT NULL,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  series_year integer CHECK (series_year BETWEEN 1888 AND 3000),
  media_type media_type NOT NULL,
  tmdb_id text,
  storage_category text NOT NULL REFERENCES storage_categories(key),
  target_series_cid text,
  target_series_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX series_title_idx ON series USING gin (to_tsvector('simple', series_title));

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id uuid NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  season_number integer NOT NULL CHECK (season_number >= 0),
  season_year integer CHECK (season_year BETWEEN 1888 AND 3000),
  subscription_status subscription_status NOT NULL DEFAULT 'following',
  lifecycle_status lifecycle_status NOT NULL DEFAULT 'active',
  run_status run_status NOT NULL DEFAULT 'waiting',
  target_season_cid text,
  target_season_path text,
  resolved_latest_episode integer NOT NULL DEFAULT 0 CHECK (resolved_latest_episode >= 0),
  pending_latest_episode integer CHECK (pending_latest_episode > 0),
  total_episodes integer CHECK (total_episodes > 0),
  completion_confirmed boolean NOT NULL DEFAULT false,
  completion_source text,
  existing_episode_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_episode_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  processing_episode_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  target_quality quality_tier NOT NULL DEFAULT '1080p' CHECK (target_quality <> 'unknown'),
  quality_upgrade_status text NOT NULL DEFAULT 'idle' CHECK (quality_upgrade_status IN ('idle', 'queued', 'running', 'paused', 'cancelled', 'completed', 'failed')),
  preferred_group_key text,
  consecutive_fail_rounds integer NOT NULL DEFAULT 0 CHECK (consecutive_fail_rounds >= 0),
  last_btbtla_calibrated_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(series_id, season_number),
  CHECK (NOT completion_confirmed OR total_episodes IS NOT NULL),
  CHECK (NOT (lifecycle_status = 'completed' AND (completion_confirmed = false OR jsonb_array_length(missing_episode_keys) <> 0))),
  CHECK (NOT (subscription_status IN ('paused', 'stopped') AND run_status IN ('checking', 'backfilling')))
);
CREATE INDEX subscriptions_active_idx ON subscriptions (subscription_status, lifecycle_status, last_checked_at);

CREATE TABLE media_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  file_id text NOT NULL,
  parent_cid text,
  name text NOT NULL,
  episode_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  quality quality_tier NOT NULL DEFAULT 'unknown',
  extension text,
  size_bytes bigint CHECK (size_bytes >= 0),
  pick_code text,
  is_video boolean NOT NULL DEFAULT false,
  is_parseable boolean NOT NULL DEFAULT false,
  added_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscription_id, file_id)
);
CREATE INDEX media_files_subscription_idx ON media_files(subscription_id, is_video, is_parseable);

CREATE TABLE search_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  channel_id text NOT NULL UNIQUE,
  is_enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL,
  last_check_status text CHECK (last_check_status IN ('unknown', 'ok', 'failed')) DEFAULT 'unknown',
  last_checked_at timestamptz,
  last_check_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sort_order)
);

CREATE TABLE resource_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  source candidate_source NOT NULL,
  resource_id text,
  source_channel_id uuid REFERENCES search_channels(id) ON DELETE SET NULL,
  share_code text,
  receive_code text,
  info_hash text,
  title text NOT NULL,
  season_number integer,
  episode_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_coverage_count integer NOT NULL DEFAULT 0 CHECK (missing_coverage_count >= 0),
  covers_all_missing boolean NOT NULL DEFAULT false,
  complete_pack boolean NOT NULL DEFAULT false,
  quality quality_tier NOT NULL DEFAULT 'unknown',
  channel_sort_order integer,
  preferred_group_hit boolean NOT NULL DEFAULT false,
  parent_path text,
  status candidate_status NOT NULL DEFAULT 'discovered',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'pan115' AND share_code IS NOT NULL AND info_hash IS NULL) OR (source = 'magnet' AND info_hash IS NOT NULL AND share_code IS NULL))
);
CREATE INDEX resource_candidates_rank_idx ON resource_candidates(subscription_id, covers_all_missing DESC, missing_coverage_count DESC, complete_pack DESC, quality DESC, channel_sort_order ASC);

CREATE TABLE resource_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type candidate_source NOT NULL,
  candidate_key text NOT NULL,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count BETWEEN 0 AND 2),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  failure_reason text NOT NULL,
  is_blacklisted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_type, candidate_key),
  CHECK ((failure_count < 2 AND is_blacklisted = false) OR (failure_count = 2 AND is_blacklisted = true))
);

CREATE TABLE cleanup_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  episode_key text NOT NULL,
  keep_file_id text NOT NULL,
  remove_file_id text NOT NULL,
  keep_quality quality_tier NOT NULL,
  remove_quality quality_tier NOT NULL,
  reason text NOT NULL,
  status cleanup_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscription_id, remove_file_id)
);

CREATE TABLE subscription_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  job_kind text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  outcome run_outcome NOT NULL DEFAULT 'running',
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX subscription_runs_open_idx ON subscription_runs(subscription_id, job_kind) WHERE outcome = 'running';

CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE CASCADE,
  level activity_level NOT NULL DEFAULT 'info',
  event_type text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_subscription_idx ON activities(subscription_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER app_users_updated_at BEFORE UPDATE ON app_users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER series_updated_at BEFORE UPDATE ON series FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER search_channels_updated_at BEFORE UPDATE ON search_channels FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER resource_candidates_updated_at BEFORE UPDATE ON resource_candidates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER resource_failures_updated_at BEFORE UPDATE ON resource_failures FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER cleanup_candidates_updated_at BEFORE UPDATE ON cleanup_candidates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO storage_categories (key, label) VALUES
  ('cn_drama', '国产剧'), ('us_drama', '美剧'), ('jp_kr_drama', '日韩剧'), ('tv', '电视剧'),
  ('variety', '综艺'), ('animation', '动漫'), ('documentary', '纪录片'), ('movie', '电影')
ON CONFLICT (key) DO NOTHING;
