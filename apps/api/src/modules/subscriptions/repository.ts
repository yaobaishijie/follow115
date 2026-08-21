import { AppError, StateTransitionError, transitionSubscription, type MediaType, type SubscriptionAction, type SubscriptionState } from "@follow115/contracts";
import type { QueryResultRow } from "pg";
import type { SubscriptionSummary } from "../read-api/mock-read-repository.js";
import { inferStorageCategory } from "../pan115/directory-model.js";
import type { SubscriptionDirectoryBinder } from "./subscription-directory-binder.js";

/** The write-side SQL port is intentionally small so state transitions can be tested without PostgreSQL. */
export interface SubscriptionQueryPool {
  query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

export interface CreateSubscriptionInput {
  mediaMetadataId: string;
  seasonNumber: number;
  targetQuality: "2160p" | "1080p";
}

export interface SubscriptionRepository {
  create(input: CreateSubscriptionInput): Promise<SubscriptionSummary>;
  transition(id: string, action: SubscriptionAction): Promise<SubscriptionSummary>;
  requestRelease(id: string): Promise<{ subscription: SubscriptionSummary; requestId: string; generation: number }>;
  queueQualityUpgrade(id: string): Promise<SubscriptionSummary>;
}

type StateRow = SubscriptionSummary & {
  mediaType: MediaType;
  totalEpisodes: number | null;
  completionConfirmed: boolean;
  qualityUpgradeStatus: "idle" | "queued" | "running" | "paused" | "cancelled" | "completed" | "failed";
};

type SummaryRow = SubscriptionSummary;
type MediaRow = { id: string; title: string; aliases: unknown; year: number | null; mediaType: MediaType; region: string | null; genres: unknown };
type CategoryRow = { configured: boolean; folderCid: string | null; folderPath: string | null };

function jsonArray(value: unknown): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  if (typeof value === "string") {
    try { return jsonArray(JSON.parse(value)); } catch { return []; }
  }
  return [];
}

function summary(row: SummaryRow): SubscriptionSummary {
  return {
    ...row,
    missingEpisodeKeys: jsonArray(row.missingEpisodeKeys),
    lastCheckedAt: row.lastCheckedAt === null ? null : new Date(row.lastCheckedAt).toISOString()
  };
}

function stateOf(row: StateRow): SubscriptionState {
  return {
    mediaType: row.mediaType, subscriptionStatus: row.subscriptionStatus, lifecycleStatus: row.lifecycleStatus,
    runStatus: row.runStatus, missingEpisodeKeys: jsonArray(row.missingEpisodeKeys),
    completionConfirmed: row.completionConfirmed, totalEpisodes: row.totalEpisodes
  };
}

export class PostgresSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly pool: SubscriptionQueryPool, private readonly directories: SubscriptionDirectoryBinder) {}

  async create(input: CreateSubscriptionInput): Promise<SubscriptionSummary> {
    const mediaResult = await this.pool.query<MediaRow>(`
      SELECT id::text AS "id", title, aliases, year, media_type AS "mediaType", region, genres
      FROM media_metadata WHERE id::text = $1 LIMIT 1`, [input.mediaMetadataId]);
    const media = mediaResult.rows[0];
    if (media === undefined) throw new AppError("NOT_FOUND", "Media metadata was not found.");
    const category = inferStorageCategory({ mediaType: media.mediaType, regions: media.region ? [media.region] : [], genres: jsonArray(media.genres), title: media.title });
    const configured = await this.pool.query<CategoryRow>('SELECT is_configured AS configured, parent_cid AS "folderCid", parent_path AS "folderPath" FROM storage_categories WHERE key = $1', [category]);
    const mapping = configured.rows[0];
    if (mapping?.configured !== true || !mapping.folderCid || !mapping.folderPath) throw new AppError("CONFIGURATION_REQUIRED", "The matching 115 storage category must be configured before following.");

    const seriesResult = await this.pool.query<{ id: string; targetSeriesCid: string | null; targetSeriesPath: string | null; tmdbId: string | null }>(`
      INSERT INTO series (media_metadata_id, series_title, aliases, series_year, media_type, storage_category)
      VALUES ($1::uuid, $2, $3::jsonb, $4, $5::media_type, $6)
      ON CONFLICT (media_metadata_id) DO UPDATE SET updated_at = now()
      RETURNING id::text AS "id", target_series_cid AS "targetSeriesCid", target_series_path AS "targetSeriesPath", tmdb_id AS "tmdbId"`, [media.id, media.title, JSON.stringify(jsonArray(media.aliases)), media.year, media.mediaType, category]);
    const series = seriesResult.rows[0]!;
    const seriesId = series.id;
    const tmdbId = series.tmdbId && /^\d+$/u.test(series.tmdbId) ? Number(series.tmdbId) : null;
    const binding = await this.directories.bind({
      mediaType: media.mediaType, title: media.title, year: media.year, tmdbId, seasonNumber: input.seasonNumber,
      categoryFolderCid: mapping.folderCid, categoryFolderPath: mapping.folderPath,
      existingSeriesCid: series.targetSeriesCid, existingSeriesPath: series.targetSeriesPath
    });
    await this.pool.query(`UPDATE series SET target_series_cid = $2, target_series_path = $3 WHERE id::text = $1`, [seriesId, binding.targetSeriesCid, binding.targetSeriesPath]);
    const inserted = await this.pool.query<SummaryRow>(`
      INSERT INTO subscriptions (series_id, season_number, season_year, target_quality, target_season_cid, target_season_path)
      VALUES ($1::uuid, $2, $4, $3::quality_tier, $5, $6)
      ON CONFLICT (series_id, season_number) DO NOTHING
      RETURNING id::text AS "id", series_id::text AS "seriesId", $7::text AS "title", season_number AS "seasonNumber",
        subscription_status AS "subscriptionStatus", lifecycle_status AS "lifecycleStatus", run_status AS "runStatus",
        resolved_latest_episode AS "resolvedLatestEpisode", missing_episode_keys AS "missingEpisodeKeys",
        target_quality AS "targetQuality", target_season_path AS "targetSeasonPath", last_checked_at AS "lastCheckedAt",
        consecutive_fail_rounds AS "consecutiveFailRounds"`, [seriesId, input.seasonNumber, input.targetQuality, media.year, binding.targetSeasonCid, binding.targetSeasonPath, media.title]);
    const row = inserted.rows[0];
    if (row === undefined) throw new AppError("CONFLICT", "That Season is already being followed.");
    return summary(row);
  }

  async transition(id: string, action: SubscriptionAction): Promise<SubscriptionSummary> {
    const current = await this.pool.query<StateRow>(`
      SELECT s.id::text AS "id", s.series_id::text AS "seriesId", se.series_title AS "title", s.season_number AS "seasonNumber",
        s.subscription_status AS "subscriptionStatus", s.lifecycle_status AS "lifecycleStatus", s.run_status AS "runStatus",
        s.resolved_latest_episode AS "resolvedLatestEpisode", s.missing_episode_keys AS "missingEpisodeKeys",
        m.media_type AS "mediaType", s.total_episodes AS "totalEpisodes", s.completion_confirmed AS "completionConfirmed",
        s.quality_upgrade_status AS "qualityUpgradeStatus"
      FROM subscriptions s JOIN series se ON se.id = s.series_id
      JOIN media_metadata m ON m.id = se.media_metadata_id WHERE s.id::text = $1 LIMIT 1`, [id]);
    const row = current.rows[0];
    if (row === undefined) throw new AppError("NOT_FOUND", "Subscription was not found.");
    let next: SubscriptionState;
    try { next = transitionSubscription(stateOf(row), action); }
    catch (error) {
      if (error instanceof StateTransitionError) throw new AppError("INVALID_STATE_TRANSITION", error.message);
      throw error;
    }
    const upgradeStatus = action === "pause" ? (row.qualityUpgradeStatus === "queued" || row.qualityUpgradeStatus === "running" ? "paused" : row.qualityUpgradeStatus)
      : action === "stop" ? (row.qualityUpgradeStatus === "queued" || row.qualityUpgradeStatus === "running" || row.qualityUpgradeStatus === "paused" ? "cancelled" : row.qualityUpgradeStatus)
      : row.qualityUpgradeStatus;
    const updated = await this.pool.query<SummaryRow>(`
      UPDATE subscriptions SET subscription_status = $2::subscription_status, lifecycle_status = $3::lifecycle_status,
        run_status = $4::run_status, completion_confirmed = $5, quality_upgrade_status = $6
      WHERE id::text = $1
      RETURNING id::text AS "id", series_id::text AS "seriesId", $7::text AS "title", season_number AS "seasonNumber",
        subscription_status AS "subscriptionStatus", lifecycle_status AS "lifecycleStatus", run_status AS "runStatus",
        resolved_latest_episode AS "resolvedLatestEpisode", missing_episode_keys AS "missingEpisodeKeys",
        target_quality AS "targetQuality", target_season_path AS "targetSeasonPath", last_checked_at AS "lastCheckedAt",
        consecutive_fail_rounds AS "consecutiveFailRounds"`, [id, next.subscriptionStatus, next.lifecycleStatus, next.runStatus, next.completionConfirmed, upgradeStatus, row.title]);
    return summary(updated.rows[0]!);
  }

  async requestRelease(id: string): Promise<{ subscription: SubscriptionSummary; requestId: string; generation: number }> {
    const result = await this.pool.query<SummaryRow & { requestId: string; generation: number }>(`
      WITH released AS (
        UPDATE subscriptions SET subscription_status = 'paused', lifecycle_status = 'active', run_status = 'waiting',
          release_generation = release_generation + 1,
          quality_upgrade_status = CASE WHEN quality_upgrade_status IN ('queued', 'running') THEN 'paused' ELSE quality_upgrade_status END
        WHERE id::text = $1 AND subscription_status <> 'stopped' AND target_season_cid IS NOT NULL
        RETURNING id, series_id, season_number, subscription_status, lifecycle_status, run_status,
          resolved_latest_episode, missing_episode_keys, target_quality, target_season_path, last_checked_at,
          consecutive_fail_rounds, target_season_cid, release_generation
      ), requested AS (
        INSERT INTO release_requests (subscription_id, generation, target_season_cid)
        SELECT id, release_generation, target_season_cid FROM released
        RETURNING id, subscription_id, generation
      ), activity AS (
        INSERT INTO activities (subscription_id, level, event_type, message, metadata)
        SELECT subscription_id, 'info', 'release.queued', '已暂停追更，等待释放当前 Season 内容',
          jsonb_build_object('releaseRequestId', id::text, 'generation', generation) FROM requested
      )
      SELECT r.id::text AS "id", r.series_id::text AS "seriesId", se.series_title AS "title",
        r.season_number AS "seasonNumber", r.subscription_status AS "subscriptionStatus",
        r.lifecycle_status AS "lifecycleStatus", r.run_status AS "runStatus",
        r.resolved_latest_episode AS "resolvedLatestEpisode", r.missing_episode_keys AS "missingEpisodeKeys",
        r.target_quality AS "targetQuality", r.target_season_path AS "targetSeasonPath", r.last_checked_at AS "lastCheckedAt",
        r.consecutive_fail_rounds AS "consecutiveFailRounds",
        q.id::text AS "requestId", q.generation
      FROM released r JOIN requested q ON q.subscription_id = r.id JOIN series se ON se.id = r.series_id`, [id]);
    const row = result.rows[0];
    if (!row) {
      const current = await this.pool.query<{ exists: boolean; stopped: boolean; bound: boolean }>(`
        SELECT true AS exists, subscription_status = 'stopped' AS stopped, target_season_cid IS NOT NULL AS bound
        FROM subscriptions WHERE id::text = $1`, [id]);
      if (!current.rows[0]?.exists) throw new AppError("NOT_FOUND", "Subscription was not found.");
      if (current.rows[0].stopped) throw new AppError("INVALID_STATE_TRANSITION", "Stopped subscriptions cannot be released from the active workflow.");
      throw new AppError("CONFIGURATION_REQUIRED", "The subscription has no bound Season directory.");
    }
    return { subscription: summary(row), requestId: row.requestId, generation: row.generation };
  }

  async queueQualityUpgrade(id: string): Promise<SubscriptionSummary> {
    const current = await this.pool.query<StateRow>(`
      SELECT s.id::text AS "id", s.series_id::text AS "seriesId", se.series_title AS "title", s.season_number AS "seasonNumber",
        s.subscription_status AS "subscriptionStatus", s.lifecycle_status AS "lifecycleStatus", s.run_status AS "runStatus",
        s.resolved_latest_episode AS "resolvedLatestEpisode", s.missing_episode_keys AS "missingEpisodeKeys", m.media_type AS "mediaType",
        s.total_episodes AS "totalEpisodes", s.completion_confirmed AS "completionConfirmed", s.quality_upgrade_status AS "qualityUpgradeStatus"
      FROM subscriptions s JOIN series se ON se.id = s.series_id JOIN media_metadata m ON m.id = se.media_metadata_id
      WHERE s.id::text = $1 LIMIT 1`, [id]);
    const row = current.rows[0];
    if (row === undefined) throw new AppError("NOT_FOUND", "Subscription was not found.");
    if (row.subscriptionStatus !== "following" || jsonArray(row.missingEpisodeKeys).length > 0) {
      throw new AppError("INVALID_STATE_TRANSITION", "Quality upgrade requires a following Season with no missing episodes.");
    }
    const updated = await this.pool.query<SummaryRow>(`
      UPDATE subscriptions SET quality_upgrade_status = 'queued' WHERE id::text = $1
      RETURNING id::text AS "id", series_id::text AS "seriesId", $2::text AS "title", season_number AS "seasonNumber",
        subscription_status AS "subscriptionStatus", lifecycle_status AS "lifecycleStatus", run_status AS "runStatus",
        resolved_latest_episode AS "resolvedLatestEpisode", missing_episode_keys AS "missingEpisodeKeys",
        target_quality AS "targetQuality", target_season_path AS "targetSeasonPath", last_checked_at AS "lastCheckedAt",
        consecutive_fail_rounds AS "consecutiveFailRounds"`, [id, row.title]);
    return summary(updated.rows[0]!);
  }
}
