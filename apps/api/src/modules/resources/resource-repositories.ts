import type { CandidateSource, NormalizedResourceCandidate, ResourceFailureRecord } from "@follow115/contracts";
import type { QueryResultRow } from "pg";
import type { ResourceFailureReader } from "./resource-candidate-service.js";

export interface ResourceQueryPool {
  query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

type FailureRow = { failureCount: number; isBlacklisted: boolean };

/** PostgreSQL backing for PRD §9.10's resource-level blacklist. */
export class PostgresResourceFailureRepository implements ResourceFailureReader {
  constructor(private readonly pool: ResourceQueryPool) {}

  async find(source: CandidateSource, candidateKey: string): Promise<ResourceFailureRecord | null> {
    const result = await this.pool.query<FailureRow>(`
      SELECT failure_count AS "failureCount", is_blacklisted AS "isBlacklisted"
      FROM resource_failures WHERE source_type = $1::candidate_source AND candidate_key = $2 LIMIT 1`, [source, candidateKey]);
    const row = result.rows[0];
    return row === undefined ? null : { failureCount: row.failureCount, isBlacklisted: row.isBlacklisted };
  }

  /**
   * Call only after a failure has been classified as resource-specific (such
   * as an invalid share code). Network, proxy, timeout, and 115 service
   * faults deliberately have no method here and therefore cannot blacklist.
   */
  async recordConfirmedResourceFailure(source: CandidateSource, candidateKey: string, reason: string): Promise<ResourceFailureRecord> {
    if (!candidateKey.trim()) throw new RangeError("candidateKey must not be empty.");
    if (!reason.trim()) throw new RangeError("reason must not be empty.");
    const result = await this.pool.query<FailureRow>(`
      INSERT INTO resource_failures (source_type, candidate_key, failure_count, failure_reason, is_blacklisted)
      VALUES ($1::candidate_source, $2, 1, $3, false)
      ON CONFLICT (source_type, candidate_key) DO UPDATE SET
        failure_count = LEAST(resource_failures.failure_count + 1, 2),
        failure_reason = EXCLUDED.failure_reason,
        last_failed_at = now(),
        is_blacklisted = resource_failures.failure_count + 1 >= 2
      RETURNING failure_count AS "failureCount", is_blacklisted AS "isBlacklisted"`, [source, candidateKey, reason.trim()]);
    const row = result.rows[0];
    if (!row) throw new Error("resource failure upsert returned no row.");
    return { failureCount: row.failureCount, isBlacklisted: row.isBlacklisted };
  }
}

/** Candidate history is persisted before execution; this store never executes a candidate. */
export class PostgresResourceCandidateRepository {
  constructor(private readonly pool: ResourceQueryPool) {}

  async recordDiscovered(subscriptionId: string, candidate: NormalizedResourceCandidate, round: { id: string; rank: number }): Promise<string> {
    const shareCode = candidate.source === "pan115" ? candidate.share?.shareCode ?? null : null;
    const receiveCode = candidate.source === "pan115" ? candidate.share?.receiveCode ?? null : null;
    const infoHash = candidate.source === "magnet" ? candidate.candidateKey : null;
    if ((candidate.source === "pan115" && !shareCode) || (candidate.source === "magnet" && !infoHash)) {
      throw new RangeError("Only normalized candidates with a source-specific key may be recorded.");
    }
    const result = await this.pool.query<{ id: string }>(`
      INSERT INTO resource_candidates (
        subscription_id, source, resource_id, share_code, receive_code, info_hash, title, season_number,
        episode_keys, missing_coverage_count, covers_all_missing, complete_pack, quality, channel_sort_order,
        preferred_group_hit, status, raw
      ) VALUES (
        $1::uuid, $2::candidate_source, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12,
        $13::quality_tier, $14, $15, 'expanded'::candidate_status, $16::jsonb
      ) RETURNING id::text AS id`, [
      subscriptionId, candidate.source, candidate.candidateKey, shareCode, receiveCode, infoHash, candidate.title,
      candidate.parsedSeason, JSON.stringify(candidate.episodes.map((episode) => `S${String(candidate.parsedSeason ?? 0).padStart(2, "0")}E${String(episode).padStart(2, "0")}`)),
      candidate.missingCoverageCount, candidate.coversAllMissing, candidate.isSeasonPackage, candidate.quality,
      Number.isSafeInteger(candidate.channelSortOrder) ? candidate.channelSortOrder : null,
      candidate.preferredGroupMatched, JSON.stringify({
        candidateKey: candidate.candidateKey, checkRoundId: round.id, roundRank: round.rank,
        ...(candidate.source === "magnet" ? { magnet: candidate.magnet } : {})
      })
    ]);
    const id = result.rows[0]?.id;
    if (!id) throw new Error("resource candidate insert returned no id.");
    return id;
  }
}
