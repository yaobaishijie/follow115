import type { LifecycleStatus, MediaType, RunStatus, SubscriptionActivity, SubscriptionStatus } from "@follow115/contracts";
import type { QueryResultRow } from "pg";
import type { MediaMetadata, Page, ReadRepository, Settings, SubscriptionDetail, SubscriptionSummary } from "./mock-read-repository.js";
import type { SearchSourceProxySettings } from "@follow115/contracts";

/** The small pool surface the read repository needs, kept deliberately easy to stub. */
export interface ReadQueryPool {
  query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

type MediaRow = {
  id: string; sourceId: string; source: string; title: string; aliases: unknown; year: number | null;
  mediaType: MediaType; region: string | null; genres: unknown; posterUrl: string | null; backdropUrl: string | null;
  rating: number | string | null; recommendation: string | null; latestEpisode: number | null; totalEpisodes: number | null; summary: string | null;
};
type SubscriptionRow = {
  id: string; seriesId: string; title: string; seasonNumber: number; subscriptionStatus: SubscriptionStatus;
  lifecycleStatus: LifecycleStatus; runStatus: RunStatus; resolvedLatestEpisode: number; missingEpisodeKeys: unknown;
  targetQuality: "2160p" | "1080p"; targetSeasonPath: string | null; lastCheckedAt: Date | string | null;
  consecutiveFailRounds: number; updatedAt: Date | string;
  mediaType?: MediaType; year?: number | null; posterUrl?: string | null; hasStoredFiles?: boolean;
};
type DetailRow = MediaRow & {
  subscriptionId: string; seriesId: string; seriesTitle: string; mediaId: string; mediaTitle: string; seasonNumber: number; subscriptionStatus: SubscriptionStatus;
  lifecycleStatus: LifecycleStatus; runStatus: RunStatus; resolvedLatestEpisode: number; missingEpisodeKeys: unknown;
  subscriptionTotalEpisodes: number | null; targetQuality: "2160p" | "1080p"; targetSeasonPath: string | null; lastCheckedAt: Date | string | null;
  consecutiveFailRounds: number; updatedAt: Date | string;
};
type ActivityRow = { time: Date | string; level: SubscriptionActivity["level"]; type: string; message: string };

const storageCategories = [
  ["cn_drama", "国产剧"], ["us_drama", "美剧"], ["jp_kr_drama", "日韩剧"], ["tv", "电视剧"],
  ["variety", "综艺"], ["animation", "动漫"], ["documentary", "纪录片"], ["movie", "电影"]
] as const;

function jsonArray(value: unknown): string[] {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value;
  if (typeof value === "string") {
    try { return jsonArray(JSON.parse(value)); } catch { return []; }
  }
  return [];
}

function asMedia(row: MediaRow): MediaMetadata {
  return {
    id: row.id, sourceId: row.sourceId, source: row.source, title: row.title, aliases: jsonArray(row.aliases), year: row.year ?? 0,
    mediaType: row.mediaType, region: row.region ?? "", genres: jsonArray(row.genres), posterUrl: row.posterUrl, backdropUrl: row.backdropUrl,
    rating: row.rating === null ? null : Number(row.rating), recommendation: row.recommendation, latestEpisode: row.latestEpisode,
    totalEpisodes: row.totalEpisodes, summary: row.summary ?? ""
  };
}

function asSummary(row: SubscriptionRow): SubscriptionSummary {
  return {
    id: row.id, seriesId: row.seriesId, title: row.title, seasonNumber: row.seasonNumber, subscriptionStatus: row.subscriptionStatus,
    lifecycleStatus: row.lifecycleStatus, runStatus: row.runStatus, resolvedLatestEpisode: row.resolvedLatestEpisode,
    missingEpisodeKeys: jsonArray(row.missingEpisodeKeys), targetQuality: row.targetQuality,
    targetSeasonPath: row.targetSeasonPath, lastCheckedAt: row.lastCheckedAt === null ? null : new Date(row.lastCheckedAt).toISOString(),
    consecutiveFailRounds: row.consecutiveFailRounds, mediaType: row.mediaType, year: row.year ?? null, posterUrl: row.posterUrl ?? null,
    hasStoredFiles: row.hasStoredFiles, updatedAt: new Date(row.updatedAt).toISOString()
  };
}

function subscriptionCursor(row: SubscriptionRow): string {
  return `${new Date(row.updatedAt).toISOString()}|${row.id}`;
}

function decodeSubscriptionCursor(cursor: string | undefined): { updatedAt: string; id: string } | null {
  if (cursor === undefined) return null;
  const separator = cursor.lastIndexOf("|");
  if (separator < 1 || separator === cursor.length - 1) return null;
  const updatedAt = cursor.slice(0, separator);
  return Number.isNaN(Date.parse(updatedAt)) ? null : { updatedAt, id: cursor.slice(separator + 1) };
}

function page<T>(rows: T[], limit: number, cursor: (row: T) => string): Page<T> {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit && items.length > 0 ? cursor(items[items.length - 1]!) : null };
}

export class PostgresReadRepository implements ReadRepository {
  constructor(private readonly pool: ReadQueryPool) {}

  async discoverMedia(cursor: string | undefined, limit: number): Promise<Page<MediaMetadata>> {
    const result = await this.pool.query<MediaRow>(`
      SELECT id::text AS "id", source_id AS "sourceId", source, title, aliases, year, media_type AS "mediaType", region, genres,
             poster_url AS "posterUrl", backdrop_url AS "backdropUrl", rating, recommendation,
             latest_episode AS "latestEpisode", total_episodes AS "totalEpisodes", summary
      FROM media_metadata
      WHERE ($1::text IS NULL OR id::text > $1)
      ORDER BY id ASC
      LIMIT $2`, [cursor ?? null, limit + 1]);
    const resultPage = page(result.rows, limit, (row) => row.id);
    return { ...resultPage, items: resultPage.items.map(asMedia) };
  }

  async searchMedia(query: string, cursor: string | undefined, limit: number): Promise<Page<MediaMetadata>> {
    const result = await this.pool.query<MediaRow>(`
      SELECT id::text AS "id", source_id AS "sourceId", source, title, aliases, year, media_type AS "mediaType", region, genres,
             poster_url AS "posterUrl", backdrop_url AS "backdropUrl", rating, recommendation,
             latest_episode AS "latestEpisode", total_episodes AS "totalEpisodes", summary
      FROM media_metadata
      WHERE (title ILIKE '%' || $1 || '%' OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(aliases) AS alias WHERE alias ILIKE '%' || $1 || '%'))
        AND ($2::text IS NULL OR id::text > $2)
      ORDER BY id ASC
      LIMIT $3`, [query, cursor ?? null, limit + 1]);
    const resultPage = page(result.rows, limit, (row) => row.id);
    return { ...resultPage, items: resultPage.items.map(asMedia) };
  }

  async getMedia(id: string): Promise<MediaMetadata | null> {
    const result = await this.pool.query<MediaRow>(`
      SELECT id::text AS "id", source_id AS "sourceId", source, title, aliases, year, media_type AS "mediaType", region, genres,
             poster_url AS "posterUrl", backdrop_url AS "backdropUrl", rating, recommendation,
             latest_episode AS "latestEpisode", total_episodes AS "totalEpisodes", summary
      FROM media_metadata
      WHERE id::text = $1
      LIMIT 1`, [id]);
    const row = result.rows[0];
    return row === undefined ? null : asMedia(row);
  }

  async listSubscriptions(cursor: string | undefined, limit: number): Promise<Page<SubscriptionSummary>> {
    const boundary = decodeSubscriptionCursor(cursor);
    const result = await this.pool.query<SubscriptionRow>(`
      SELECT s.id::text AS "id", s.series_id::text AS "seriesId", se.series_title AS "title", s.season_number AS "seasonNumber",
             s.subscription_status AS "subscriptionStatus", s.lifecycle_status AS "lifecycleStatus", s.run_status AS "runStatus",
             s.resolved_latest_episode AS "resolvedLatestEpisode", s.missing_episode_keys AS "missingEpisodeKeys",
             s.target_quality AS "targetQuality", s.target_season_path AS "targetSeasonPath", s.last_checked_at AS "lastCheckedAt",
             s.consecutive_fail_rounds AS "consecutiveFailRounds", s.updated_at AS "updatedAt",
             m.media_type AS "mediaType", m.year, m.poster_url AS "posterUrl",
             EXISTS (SELECT 1 FROM media_files mf WHERE mf.subscription_id = s.id) AS "hasStoredFiles"
      FROM subscriptions s JOIN series se ON se.id = s.series_id JOIN media_metadata m ON m.id = se.media_metadata_id
      WHERE ($1::timestamptz IS NULL OR (s.updated_at, s.id) < ($1::timestamptz, $2::uuid))
      ORDER BY s.updated_at DESC, s.id DESC
      LIMIT $3`, [boundary?.updatedAt ?? null, boundary?.id ?? null, limit + 1]);
    const resultPage = page(result.rows, limit, subscriptionCursor);
    return { ...resultPage, items: resultPage.items.map(asSummary) };
  }

  async getSubscription(id: string): Promise<SubscriptionDetail | null> {
    const result = await this.pool.query<DetailRow>(`
      SELECT s.id::text AS "subscriptionId", s.series_id::text AS "seriesId", se.series_title AS "seriesTitle", s.season_number AS "seasonNumber",
             s.subscription_status AS "subscriptionStatus", s.lifecycle_status AS "lifecycleStatus", s.run_status AS "runStatus",
             s.resolved_latest_episode AS "resolvedLatestEpisode", s.missing_episode_keys AS "missingEpisodeKeys",
             s.total_episodes AS "subscriptionTotalEpisodes", s.target_quality AS "targetQuality", s.target_season_path AS "targetSeasonPath", s.last_checked_at AS "lastCheckedAt",
             s.consecutive_fail_rounds AS "consecutiveFailRounds", s.updated_at AS "updatedAt",
             m.id::text AS "mediaId", m.source_id AS "sourceId", m.source, m.title AS "mediaTitle", m.aliases, m.year, m.media_type AS "mediaType", m.region, m.genres,
             m.poster_url AS "posterUrl", m.backdrop_url AS "backdropUrl", m.rating, m.recommendation, m.latest_episode AS "latestEpisode", m.total_episodes AS "totalEpisodes", m.summary
      FROM subscriptions s
      JOIN series se ON se.id = s.series_id
      JOIN media_metadata m ON m.id = se.media_metadata_id
      WHERE s.id::text = $1
      LIMIT 1`, [id]);
    const row = result.rows[0];
    if (row === undefined) return null;
    const summary = asSummary({
      id: row.subscriptionId, seriesId: row.seriesId, title: row.seriesTitle, seasonNumber: row.seasonNumber,
      subscriptionStatus: row.subscriptionStatus, lifecycleStatus: row.lifecycleStatus, runStatus: row.runStatus,
      resolvedLatestEpisode: row.resolvedLatestEpisode, missingEpisodeKeys: row.missingEpisodeKeys,
      targetQuality: row.targetQuality, targetSeasonPath: row.targetSeasonPath, lastCheckedAt: row.lastCheckedAt,
      consecutiveFailRounds: row.consecutiveFailRounds, updatedAt: row.updatedAt
    });
    const activities = await this.pool.query<ActivityRow>(`
      SELECT created_at AS "time", level::text AS "level", event_type AS "type", message
      FROM activities
      WHERE subscription_id::text = $1
      ORDER BY created_at DESC
      LIMIT 20`, [id]);
    return {
      ...summary, media: asMedia({ ...row, id: row.mediaId, title: row.mediaTitle }), totalEpisodes: row.subscriptionTotalEpisodes,
      activities: activities.rows.map((activity) => ({ ...activity, time: new Date(activity.time).toISOString() }))
    };
  }

  async getSettings(): Promise<Settings> {
    const [categories, setting, searchSourceProxySetting] = await Promise.all([
      this.pool.query<{ key: string; configured: boolean; folderCid: string | null; folderPath: string | null }>("SELECT key, is_configured AS configured, parent_cid AS \"folderCid\", parent_path AS \"folderPath\" FROM storage_categories WHERE key = ANY($1::text[])", [storageCategories.map(([key]) => key)]),
      this.pool.query<{ value: unknown }>("SELECT value FROM app_settings WHERE key = 'default_target_quality' LIMIT 1"),
      this.pool.query<{ value: unknown }>("SELECT value FROM app_settings WHERE key = 'search_source_proxy_settings' LIMIT 1")
    ]);
    const configured = new Map(categories.rows.map((row) => [row.key, row]));
    const value = setting.rows[0]?.value;
    const defaultTargetQuality = value === "2160p" || value === "1080p" ? value : "1080p";
    const sourceValue = searchSourceProxySetting.rows[0]?.value;
    const searchSourceProxy = isSearchSourceProxySettings(sourceValue) ? sourceValue : defaultSearchSourceProxySettings();
    return {
      pan115: { connected: false, configured: false }, defaultTargetQuality,
      searchSourceProxy,
      storageCategories: storageCategories.map(([key, label]) => ({ key, label, configured: configured.get(key)?.configured ?? false, folderCid: configured.get(key)?.folderCid ?? null, folderPath: configured.get(key)?.folderPath ?? null }))
    };
  }
}

function defaultSearchSourceProxySettings(): SearchSourceProxySettings {
  return { btbtlaEnabled: true, isProxyEnabled: true, httpProxyHost: "clash", httpProxyPort: 7890 };
}

function isSearchSourceProxySettings(value: unknown): value is SearchSourceProxySettings {
  if (typeof value !== "object" || value === null) return false;
  const setting = value as Partial<SearchSourceProxySettings>;
  const port = setting.httpProxyPort;
  return typeof setting.btbtlaEnabled === "boolean" && typeof setting.isProxyEnabled === "boolean"
    && typeof setting.httpProxyHost === "string" && setting.httpProxyHost.trim().length > 0
    && typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535;
}
