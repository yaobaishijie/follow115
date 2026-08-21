import type { QueryResultRow } from "pg";
import { createPan115DirectoryScanService } from "../pan115/directory-scan-service.js";
import type { Pan115FolderPageClient } from "../pan115/list-folder.js";
import type { PostgresResourceFailureRepository } from "../resources/resource-repositories.js";
import type { CredentialStore } from "../settings/settings-service.js";
import type { CandidateDirectoryReader, CandidateDirectoryScan, CandidateVerificationSnapshot, CandidateVerificationStore } from "./candidate-verification.js";
import type { SelectedPan115File } from "./pan115-candidate-submit.js";

export interface CandidateVerificationPool {
  query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

type VerificationRow = {
  subscriptionId: string; candidateId: string; candidateKey: string; mediaType: "series" | "movie";
  source: "pan115" | "magnet";
  seasonNumber: number; targetSeasonCid: string; targetSeasonPath: string | null; raw: unknown;
  missingEpisodeKeys: unknown; subscriptionStatus: "following" | "paused" | "stopped";
  lifecycleStatus: "active" | "completed"; runStatus: "waiting" | "checking" | "backfilling" | "exception" | "released";
  completionConfirmed: boolean; totalEpisodes: number | null;
};

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") { try { return strings(JSON.parse(value)); } catch { return []; } }
  return [];
}
function selectedFiles(value: unknown): SelectedPan115File[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const row = record(item);
    return typeof row.sourceFileId === "string" && typeof row.name === "string"
      ? [{ sourceFileId: row.sourceFileId, name: row.name, episodeKeys: strings(row.episodeKeys) }]
      : [];
  }) : [];
}

export class PostgresCandidateVerificationStore implements CandidateVerificationStore {
  constructor(private readonly pool: CandidateVerificationPool, private readonly failures: Pick<PostgresResourceFailureRepository, "recordConfirmedResourceFailure">) {}

  async get(candidateId: string): Promise<CandidateVerificationSnapshot | null> {
    const result = await this.pool.query<VerificationRow>(`
      SELECT s.id::text AS "subscriptionId", rc.id::text AS "candidateId", COALESCE(rc.share_code, rc.info_hash) AS "candidateKey", rc.source,
        se.media_type AS "mediaType", s.season_number AS "seasonNumber", s.target_season_cid AS "targetSeasonCid",
        s.target_season_path AS "targetSeasonPath", rc.raw, s.missing_episode_keys AS "missingEpisodeKeys",
        s.subscription_status AS "subscriptionStatus", s.lifecycle_status AS "lifecycleStatus", s.run_status AS "runStatus",
        s.completion_confirmed AS "completionConfirmed", s.total_episodes AS "totalEpisodes"
      FROM resource_candidates rc JOIN subscriptions s ON s.id = rc.subscription_id JOIN series se ON se.id = s.series_id
      WHERE rc.id::text = $1 AND rc.status = 'submitted'
        AND ((rc.source = 'pan115' AND rc.share_code IS NOT NULL) OR (rc.source = 'magnet' AND rc.info_hash IS NOT NULL))
        AND s.target_season_cid IS NOT NULL LIMIT 1`, [candidateId]);
    const row = result.rows[0];
    if (!row) return null;
    const raw = record(row.raw);
    const missing = strings(raw.missingEpisodeKeysAtSubmission).length > 0 ? strings(raw.missingEpisodeKeysAtSubmission) : strings(row.missingEpisodeKeys);
    return {
      subscriptionId: row.subscriptionId, candidateId: row.candidateId, candidateKey: row.candidateKey, source: row.source,
      mediaType: row.mediaType, seasonNumber: row.seasonNumber, targetSeasonCid: row.targetSeasonCid,
      targetSeasonPath: row.targetSeasonPath, missingEpisodeKeysAtSubmission: missing,
      selectedFiles: selectedFiles(raw.submittedFiles),
      expectedEpisodeKeys: strings(raw.expectedEpisodeKeys), submissionUncertain: raw.submissionUncertain === true,
      checkRoundId: typeof raw.checkRoundId === "string" ? raw.checkRoundId : "",
      roundRank: Number.isInteger(raw.roundRank) ? Number(raw.roundRank) : 0,
      state: {
        mediaType: row.mediaType, subscriptionStatus: row.subscriptionStatus, lifecycleStatus: row.lifecycleStatus,
        runStatus: row.runStatus, missingEpisodeKeys: strings(row.missingEpisodeKeys), completionConfirmed: row.completionConfirmed,
        totalEpisodes: row.totalEpisodes
      }
    };
  }

  async markVerified(snapshot: CandidateVerificationSnapshot, scan: CandidateDirectoryScan, missingEpisodeKeys: readonly string[]): Promise<void> {
    await this.pool.query(`
      WITH candidate AS (
        UPDATE resource_candidates SET status = 'verified', raw = raw || jsonb_build_object('verifiedAt', now())
        WHERE id::text = $1 RETURNING subscription_id
      ), subscription AS (
        UPDATE subscriptions SET existing_episode_keys = $2::jsonb, missing_episode_keys = $3::jsonb,
          processing_episode_keys = '[]'::jsonb, run_status = 'waiting', last_checked_at = now()
        WHERE id::text = $4 AND subscription_status = 'following' AND lifecycle_status = 'active'
          AND NOT EXISTS (SELECT 1 FROM release_requests rr WHERE rr.subscription_id = subscriptions.id AND rr.status IN ('queued', 'running', 'verifying'))
        RETURNING id
      )
      INSERT INTO activities (subscription_id, level, event_type, message, metadata)
      SELECT subscription_id, 'info', 'candidate.verified', '115 目录已验证新增内容',
        jsonb_build_object('candidateId', $1::text, 'remainingMissing', $3::jsonb) FROM candidate`, [
      snapshot.candidateId, JSON.stringify([...new Set(scan.episodeKeys)].sort()), JSON.stringify(missingEpisodeKeys), snapshot.subscriptionId
    ]);
  }

  async markSkipped(candidateId: string, reason: string): Promise<void> {
    await this.pool.query(`
      WITH candidate AS (
        UPDATE resource_candidates SET raw = raw || jsonb_build_object('verificationSkipped', $2::text)
        WHERE id::text = $1 RETURNING subscription_id
      ) UPDATE subscriptions SET processing_episode_keys = '[]'::jsonb,
          run_status = CASE WHEN run_status = 'released' THEN 'released'::run_status ELSE 'waiting'::run_status END
        WHERE id IN (SELECT subscription_id FROM candidate)
          AND NOT EXISTS (SELECT 1 FROM release_requests rr WHERE rr.subscription_id = subscriptions.id AND rr.status IN ('queued', 'running', 'verifying'))`, [candidateId, reason]);
  }

  async markFinalResourceFailure(snapshot: CandidateVerificationSnapshot, reason: string): Promise<void> {
    const failure = await this.failures.recordConfirmedResourceFailure(snapshot.source, snapshot.candidateKey, reason);
    await this.pool.query(`
      WITH candidate AS (
        UPDATE resource_candidates SET status = $2::candidate_status,
          raw = raw || jsonb_build_object('verificationFailure', $3::text)
        WHERE id::text = $1 RETURNING subscription_id
      ), subscription AS (
        UPDATE subscriptions SET processing_episode_keys = '[]'::jsonb, run_status = 'waiting',
          consecutive_fail_rounds = consecutive_fail_rounds + 1 WHERE id::text = $4
          AND subscription_status = 'following' AND lifecycle_status = 'active'
          AND NOT EXISTS (SELECT 1 FROM release_requests rr WHERE rr.subscription_id = subscriptions.id AND rr.status IN ('queued', 'running', 'verifying'))
          RETURNING id
      )
      INSERT INTO activities (subscription_id, level, event_type, message, metadata)
      SELECT subscription_id, 'warning', 'candidate.verification_failed', '转存后未在 115 目录发现目标内容',
        jsonb_build_object('candidateId', $1::text, 'blacklisted', $5::boolean) FROM candidate`, [
      snapshot.candidateId, failure.isBlacklisted ? "blacklisted" : "failed", reason, snapshot.subscriptionId, failure.isBlacklisted
    ]);
  }

  async markFinalInfrastructureFailure(snapshot: CandidateVerificationSnapshot, reason: string): Promise<void> {
    await this.pool.query(`
      WITH candidate AS (
        UPDATE resource_candidates SET status = 'failed', raw = raw || jsonb_build_object('verificationInfrastructureFailure', $2::text)
        WHERE id::text = $1 RETURNING subscription_id
      ), subscription AS (
        UPDATE subscriptions SET processing_episode_keys = '[]'::jsonb, run_status = 'waiting'
        WHERE id::text = $3 AND subscription_status = 'following' AND lifecycle_status = 'active'
          AND NOT EXISTS (SELECT 1 FROM release_requests rr WHERE rr.subscription_id = subscriptions.id AND rr.status IN ('queued', 'running', 'verifying'))
        RETURNING id
      )
      INSERT INTO activities (subscription_id, level, event_type, message, metadata)
      SELECT subscription_id, 'warning', 'candidate.verification_unconfirmed', '提交结果未能确认，未计入资源黑名单',
        jsonb_build_object('candidateId', $1::text, 'source', $4::text) FROM candidate`, [
      snapshot.candidateId, reason, snapshot.subscriptionId, snapshot.source
    ]);
  }

  async findNextCandidate(snapshot: CandidateVerificationSnapshot): Promise<string | null> {
    if (!snapshot.checkRoundId || snapshot.roundRank >= 1) return null;
    const result = await this.pool.query<{ id: string }>(`
      SELECT id::text AS id FROM resource_candidates
      WHERE subscription_id::text = $1 AND status = 'expanded'
        AND raw->>'checkRoundId' = $2 AND (raw->>'roundRank')::integer = $3
      ORDER BY created_at ASC LIMIT 1`, [snapshot.subscriptionId, snapshot.checkRoundId, snapshot.roundRank + 1]);
    return result.rows[0]?.id ?? null;
  }
}

/** Saved-cookie, read-only scanner used by candidate.verify. */
export class SavedCredentialCandidateDirectoryReader implements CandidateDirectoryReader {
  constructor(private readonly credentials: CredentialStore, private readonly createClient: (cookie: string) => Pan115FolderPageClient) {}
  async scan(snapshot: CandidateVerificationSnapshot): Promise<CandidateDirectoryScan> {
    const credential = await this.credentials.getPan115Credential();
    if (!credential) return { episodeKeys: [], featureFileNames: [] };
    const parentPath = snapshot.targetSeasonPath?.split("/").map((part) => part.trim()).filter(Boolean) ?? [];
    const result = await createPan115DirectoryScanService(this.createClient(credential.cookie)).scan({ cid: snapshot.targetSeasonCid, parentPath });
    return {
      episodeKeys: [...new Set(result.videos.flatMap((video) => video.episodeKeys))].sort(),
      featureFileNames: result.videos.map((video) => video.item.name)
    };
  }
}
