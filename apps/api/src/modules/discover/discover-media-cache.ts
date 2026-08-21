import type { MediaMetadata } from "../read-api/mock-read-repository.js";

/** Minimal persistence port: hot cards must resolve to the same local media ID. */
export interface DiscoverMediaCache {
  upsert(input: DiscoverMediaCacheInput): Promise<MediaMetadata>;
}

export interface DiscoverMediaCacheInput extends Omit<MediaMetadata, "id"> {
  raw: Record<string, unknown>;
}

/** Test/local fallback; production wires the Postgres implementation below. */
export class InMemoryDiscoverMediaCache implements DiscoverMediaCache {
  private readonly items = new Map<string, MediaMetadata>();
  async upsert(input: DiscoverMediaCacheInput): Promise<MediaMetadata> {
    const key = `${input.source}:${input.sourceId}`;
    const existing = this.items.get(key);
    const item: MediaMetadata = { ...input, id: existing?.id ?? crypto.randomUUID() };
    this.items.set(key, item);
    return item;
  }
}

export interface DiscoverQueryPool {
  query<Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

/** Upserts only normalized, non-sensitive Douban fields into the app's local cache. */
export class PostgresDiscoverMediaCache implements DiscoverMediaCache {
  constructor(private readonly pool: DiscoverQueryPool) {}

  async upsert(input: DiscoverMediaCacheInput): Promise<MediaMetadata> {
    const result = await this.pool.query<{
      id: string; sourceId: string; source: string; title: string; aliases: unknown; year: number | null;
      mediaType: MediaMetadata["mediaType"]; region: string | null; genres: unknown; posterUrl: string | null;
      backdropUrl: string | null; rating: number | string | null; recommendation: string | null;
      latestEpisode: number | null; totalEpisodes: number | null; summary: string | null;
    }>(`
      INSERT INTO media_metadata (
        source_id, source, title, aliases, year, media_type, region, genres, poster_url, backdrop_url,
        rating, recommendation, latest_episode, total_episodes, summary, raw, fetched_at, expires_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $6::media_type, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, now(), now() + interval '5 minutes')
      ON CONFLICT (source, source_id) DO UPDATE SET
        title = EXCLUDED.title, aliases = EXCLUDED.aliases, year = EXCLUDED.year, media_type = EXCLUDED.media_type,
        region = EXCLUDED.region, genres = EXCLUDED.genres, poster_url = EXCLUDED.poster_url, backdrop_url = EXCLUDED.backdrop_url,
        rating = EXCLUDED.rating, recommendation = EXCLUDED.recommendation, latest_episode = EXCLUDED.latest_episode,
        total_episodes = EXCLUDED.total_episodes, summary = EXCLUDED.summary, raw = EXCLUDED.raw,
        fetched_at = now(), expires_at = now() + interval '5 minutes'
      RETURNING id::text AS "id", source_id AS "sourceId", source, title, aliases, year, media_type AS "mediaType", region, genres,
        poster_url AS "posterUrl", backdrop_url AS "backdropUrl", rating, recommendation,
        latest_episode AS "latestEpisode", total_episodes AS "totalEpisodes", summary`,
      [input.sourceId, input.source, input.title, JSON.stringify(input.aliases), input.year || null, input.mediaType,
        input.region || null, JSON.stringify(input.genres), input.posterUrl, input.backdropUrl, input.rating,
        input.recommendation, input.latestEpisode, input.totalEpisodes, input.summary, JSON.stringify(input.raw)]);
    const row = result.rows[0]!;
    return {
      id: row.id, sourceId: row.sourceId, source: row.source, title: row.title,
      aliases: stringArray(row.aliases), year: row.year ?? 0, mediaType: row.mediaType, region: row.region ?? "",
      genres: stringArray(row.genres), posterUrl: row.posterUrl, backdropUrl: row.backdropUrl,
      rating: row.rating === null ? null : Number(row.rating), recommendation: row.recommendation,
      latestEpisode: row.latestEpisode, totalEpisodes: row.totalEpisodes, summary: row.summary ?? ""
    };
  }
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value;
  if (typeof value === "string") try { return stringArray(JSON.parse(value)); } catch { return []; }
  return [];
}
