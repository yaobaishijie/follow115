import type { NormalizedResourceCandidate, SubscriptionState } from "@follow115/contracts";
import type { QueryResultRow } from "pg";
import { createPan115DirectoryScanService } from "../pan115/directory-scan-service.js";
import type { Pan115FolderPageClient } from "../pan115/list-folder.js";
import type { CredentialStore } from "../settings/settings-service.js";
import type { PostgresResourceCandidateRepository } from "../resources/resource-repositories.js";
import type { ReadOnlySubscriptionCheckStore, ReadOnlySubscriptionSnapshot, SeasonEpisodeReader } from "./read-only-subscription-check.js";

export interface ReadOnlyCheckPool {
  query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

type SnapshotRow = {
  id: string; title: string; aliases: unknown; year: number | null; mediaType: "series" | "movie";
  seasonNumber: number; preferredGroupKey: string | null; subscriptionStatus: SubscriptionState["subscriptionStatus"];
  lifecycleStatus: SubscriptionState["lifecycleStatus"]; runStatus: SubscriptionState["runStatus"];
  missingEpisodeKeys: unknown; completionConfirmed: boolean; totalEpisodes: number | null;
  resolvedLatestEpisode: number; pendingLatestEpisode: number | null; lastBtbtlaCalibratedAt: Date | null; targetSeasonCid: string | null; targetSeasonPath: string | null;
};

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") { try { return strings(JSON.parse(value)); } catch { return []; } }
  return [];
}

export class PostgresReadOnlySubscriptionCheckStore implements ReadOnlySubscriptionCheckStore {
  constructor(private readonly pool: ReadOnlyCheckPool, private readonly candidates: Pick<PostgresResourceCandidateRepository, "recordDiscovered">) {}

  async get(id: string): Promise<ReadOnlySubscriptionSnapshot | null> {
    const result = await this.pool.query<SnapshotRow>(`
      SELECT s.id::text AS id, se.series_title AS title, se.aliases, se.series_year AS year,
        se.media_type AS "mediaType", s.season_number AS "seasonNumber", s.preferred_group_key AS "preferredGroupKey",
        s.subscription_status AS "subscriptionStatus", s.lifecycle_status AS "lifecycleStatus", s.run_status AS "runStatus",
        s.missing_episode_keys AS "missingEpisodeKeys", s.completion_confirmed AS "completionConfirmed",
        s.total_episodes AS "totalEpisodes", s.resolved_latest_episode AS "resolvedLatestEpisode",
        s.pending_latest_episode AS "pendingLatestEpisode", s.last_btbtla_calibrated_at AS "lastBtbtlaCalibratedAt", s.target_season_cid AS "targetSeasonCid",
        s.target_season_path AS "targetSeasonPath"
      FROM subscriptions s JOIN series se ON se.id = s.series_id WHERE s.id::text = $1 LIMIT 1`, [id]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id, title: row.title, aliases: strings(row.aliases), year: row.year, mediaType: row.mediaType,
      seasonNumber: row.seasonNumber, preferredGroupKey: row.preferredGroupKey,
      state: {
        mediaType: row.mediaType, subscriptionStatus: row.subscriptionStatus, lifecycleStatus: row.lifecycleStatus,
        runStatus: row.runStatus, missingEpisodeKeys: strings(row.missingEpisodeKeys),
        completionConfirmed: row.completionConfirmed, totalEpisodes: row.totalEpisodes
      },
      resolvedLatestEpisode: row.resolvedLatestEpisode, pendingLatestEpisode: row.pendingLatestEpisode, lastBtbtlaCalibratedAt: row.lastBtbtlaCalibratedAt,
      targetSeasonCid: row.targetSeasonCid, targetSeasonPath: row.targetSeasonPath
    };
  }

  async finishRound(input: { subscriptionId: string; existingEpisodeKeys: readonly string[]; resolvedLatestEpisode: number; pendingLatestEpisode: number | null; missingEpisodeKeys: readonly string[]; btbtlaCalibratedAt?: Date }): Promise<void> {
    await this.pool.query(`
      UPDATE subscriptions SET existing_episode_keys = $2::jsonb, resolved_latest_episode = $3,
        pending_latest_episode = $4, missing_episode_keys = $5::jsonb,
        last_btbtla_calibrated_at = COALESCE($6::timestamptz, last_btbtla_calibrated_at), last_checked_at = now(), run_status = 'waiting'
      WHERE id::text = $1 AND subscription_status = 'following' AND lifecycle_status = 'active'
        AND NOT EXISTS (SELECT 1 FROM release_requests rr WHERE rr.subscription_id = subscriptions.id AND rr.status IN ('queued', 'running', 'verifying'))`, [input.subscriptionId, JSON.stringify(input.existingEpisodeKeys), input.resolvedLatestEpisode, input.pendingLatestEpisode, JSON.stringify(input.missingEpisodeKeys), input.btbtlaCalibratedAt]);
  }

  recordCandidate(subscriptionId: string, candidate: NormalizedResourceCandidate, round: { id: string; rank: number }): Promise<string> {
    return this.candidates.recordDiscovered(subscriptionId, candidate, round);
  }
}

/** Reads only an already-bound Season directory; directory creation belongs to the explicit write workflow. */
export class SavedCredentialSeasonEpisodeReader implements SeasonEpisodeReader {
  constructor(private readonly credentials: CredentialStore, private readonly createClient: (cookie: string) => Pan115FolderPageClient) {}

  async listExistingEpisodeKeys(snapshot: ReadOnlySubscriptionSnapshot): Promise<readonly string[]> {
    if (!snapshot.targetSeasonCid) return [];
    const credential = await this.credentials.getPan115Credential();
    if (!credential) return [];
    const parentPath = snapshot.targetSeasonPath?.split("/").map((part) => part.trim()).filter(Boolean) ?? [];
    const scan = await createPan115DirectoryScanService(this.createClient(credential.cookie)).scan({ cid: snapshot.targetSeasonCid, parentPath });
    return [...new Set(scan.videos.flatMap((video) => video.episodeKeys))].sort();
  }
}
