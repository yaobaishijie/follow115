import type { QueryResultRow } from "pg";
import type { PostgresResourceFailureRepository } from "../resources/resource-repositories.js";
import type { Pan115CandidateSubmission, Pan115CandidateSubmissionStore, SelectedPan115File } from "./pan115-candidate-submit.js";

export interface CandidateSubmitPool {
  query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

type RunnableRow = {
  subscriptionId: string; candidateId: string; shareCode: string; receiveCode: string | null;
  mediaType: "series" | "movie"; seasonNumber: number; targetSeasonCid: string;
  missingEpisodeKeys: unknown; subscriptionStatus: "following" | "paused" | "stopped";
  lifecycleStatus: "active" | "completed"; runStatus: "waiting" | "checking" | "backfilling" | "exception" | "released";
  completionConfirmed: boolean; totalEpisodes: number | null;
};

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") { try { return strings(JSON.parse(value)); } catch { return []; } }
  return [];
}

/** PostgreSQL state and idempotency boundary for a single 115 candidate submission. */
export class PostgresPan115CandidateSubmissionStore implements Pan115CandidateSubmissionStore {
  constructor(private readonly pool: CandidateSubmitPool, private readonly failures: Pick<PostgresResourceFailureRepository, "recordConfirmedResourceFailure">) {}

  async getRunnable(candidateId: string): Promise<Pan115CandidateSubmission | null> {
    const result = await this.pool.query<RunnableRow>(`
      SELECT s.id::text AS "subscriptionId", rc.id::text AS "candidateId", rc.share_code AS "shareCode",
        rc.receive_code AS "receiveCode", se.media_type AS "mediaType", s.season_number AS "seasonNumber",
        s.target_season_cid AS "targetSeasonCid", s.missing_episode_keys AS "missingEpisodeKeys",
        s.subscription_status AS "subscriptionStatus", s.lifecycle_status AS "lifecycleStatus",
        s.run_status AS "runStatus", s.completion_confirmed AS "completionConfirmed", s.total_episodes AS "totalEpisodes"
      FROM resource_candidates rc
      JOIN subscriptions s ON s.id = rc.subscription_id
      JOIN series se ON se.id = s.series_id
      WHERE rc.id::text = $1 AND rc.source = 'pan115' AND rc.status IN ('expanded', 'selected')
        AND rc.share_code IS NOT NULL AND s.target_season_cid IS NOT NULL
        AND s.subscription_status = 'following' AND s.lifecycle_status = 'active'
      LIMIT 1`, [candidateId]);
    const row = result.rows[0];
    if (!row) return null;
    const missingEpisodeKeys = strings(row.missingEpisodeKeys);
    return {
      subscriptionId: row.subscriptionId, candidateId: row.candidateId, candidateKey: row.shareCode,
      mediaType: row.mediaType, seasonNumber: row.seasonNumber, targetSeasonCid: row.targetSeasonCid,
      missingEpisodeKeys,
      state: {
        mediaType: row.mediaType, subscriptionStatus: row.subscriptionStatus, lifecycleStatus: row.lifecycleStatus,
        runStatus: row.runStatus, missingEpisodeKeys, completionConfirmed: row.completionConfirmed, totalEpisodes: row.totalEpisodes
      },
      share: {
        shareCode: row.shareCode,
        ...(row.receiveCode ? { receiveCode: row.receiveCode } : {}),
        url: `https://115.com/s/${encodeURIComponent(row.shareCode)}`
      }
    };
  }

  async claimSubmission(input: Pan115CandidateSubmission, idempotencyKey: string): Promise<boolean> {
    const result = await this.pool.query<{ id: string }>(`
      WITH eligible AS (
        SELECT rc.id, rc.subscription_id FROM resource_candidates rc
        JOIN subscriptions s ON s.id = rc.subscription_id
        WHERE rc.id::text = $1 AND rc.subscription_id::text = $2 AND rc.status IN ('expanded', 'selected')
          AND s.subscription_status = 'following' AND s.lifecycle_status = 'active'
          AND s.target_season_cid = $3
      ), claimed AS (
        INSERT INTO subscription_runs (subscription_id, job_kind, idempotency_key, metadata)
        SELECT subscription_id, 'candidate.submit', $4, jsonb_build_object('candidateId', id::text)
        FROM eligible ON CONFLICT (idempotency_key) DO NOTHING RETURNING id, subscription_id
      ), marked_subscription AS (
        UPDATE subscriptions SET run_status = 'backfilling'
        WHERE id IN (SELECT subscription_id FROM claimed) RETURNING id
      )
      UPDATE resource_candidates SET status = 'selected',
        raw = raw || jsonb_build_object('missingEpisodeKeysAtSubmission', $5::jsonb)
      WHERE id IN (SELECT id FROM eligible) AND EXISTS (SELECT 1 FROM claimed)
      RETURNING id::text AS id`, [input.candidateId, input.subscriptionId, input.targetSeasonCid, idempotencyKey, JSON.stringify(input.missingEpisodeKeys)]);
    return result.rows.length === 1;
  }

  async markSubmitted(candidateId: string, idempotencyKey: string, files: readonly SelectedPan115File[]): Promise<void> {
    await this.finishSubmission(candidateId, idempotencyKey, files, false, null);
  }

  async markSubmissionUncertain(candidateId: string, idempotencyKey: string, files: readonly SelectedPan115File[], errorCode: string): Promise<void> {
    await this.finishSubmission(candidateId, idempotencyKey, files, true, errorCode);
  }

  private async finishSubmission(candidateId: string, idempotencyKey: string, files: readonly SelectedPan115File[], uncertain: boolean, errorCode: string | null): Promise<void> {
    await this.pool.query(`
      WITH candidate AS (
        UPDATE resource_candidates SET status = 'submitted', raw = raw || jsonb_build_object(
          'submittedFiles', $3::jsonb, 'submissionUncertain', $4::boolean, 'submissionErrorCode', $5::text)
        WHERE id::text = $1 RETURNING subscription_id
      ), finished AS (
        UPDATE subscription_runs SET outcome = 'succeeded', finished_at = now(), metadata = metadata || jsonb_build_object(
          'submittedFiles', $3::jsonb, 'submissionUncertain', $4::boolean, 'submissionErrorCode', $5::text)
        WHERE idempotency_key = $2 AND outcome = 'running' RETURNING subscription_id
      )
      INSERT INTO activities (subscription_id, level, event_type, message, metadata)
      SELECT subscription_id, CASE WHEN $4::boolean THEN 'warning'::activity_level ELSE 'info'::activity_level END,
        'candidate.submitted', CASE WHEN $4::boolean THEN '115 提交结果不确定，等待目录验证' ELSE '115 已接受精确文件转存' END,
        jsonb_build_object('candidateId', $1::text, 'fileCount', jsonb_array_length($3::jsonb))
      FROM candidate`, [candidateId, idempotencyKey, JSON.stringify(files), uncertain, errorCode]);
  }

  async markConfirmedResourceFailure(candidateId: string, candidateKey: string, reason: string, idempotencyKey?: string): Promise<void> {
    const failure = await this.failures.recordConfirmedResourceFailure("pan115", candidateKey, reason);
    await this.pool.query(`
      WITH candidate AS (
        UPDATE resource_candidates SET status = $3::candidate_status,
          raw = raw || jsonb_build_object('failureReason', $4::text)
        WHERE id::text = $1 RETURNING subscription_id
      ), finished AS (
        UPDATE subscription_runs SET outcome = 'failed', error_code = 'RESOURCE_UNAVAILABLE', error_message = $4,
          finished_at = now() WHERE $2::text IS NOT NULL AND idempotency_key = $2 AND outcome = 'running'
      )
      INSERT INTO activities (subscription_id, level, event_type, message, metadata)
      SELECT subscription_id, 'warning', 'candidate.failed', '候选资源验证失败',
        jsonb_build_object('candidateId', $1::text, 'candidateKey', $5::text, 'blacklisted', $6::boolean)
      FROM candidate`, [candidateId, idempotencyKey ?? null, failure.isBlacklisted ? "blacklisted" : "failed", reason, candidateKey, failure.isBlacklisted]);
  }
}
