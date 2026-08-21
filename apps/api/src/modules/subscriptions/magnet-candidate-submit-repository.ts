import type { QueryResultRow } from "pg";
import type { MagnetCandidateSubmission, MagnetCandidateSubmissionStore } from "./magnet-candidate-submit.js";

export interface MagnetSubmitPool { query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>; }
type Row = {
  subscriptionId: string; candidateId: string; infoHash: string; magnet: string; mediaType: "series" | "movie";
  seasonNumber: number; targetSeasonCid: string; missingEpisodeKeys: unknown; expectedEpisodeKeys: unknown;
  subscriptionStatus: "following" | "paused" | "stopped"; lifecycleStatus: "active" | "completed";
  runStatus: "waiting" | "checking" | "backfilling" | "exception" | "released"; completionConfirmed: boolean; totalEpisodes: number | null;
};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : typeof value === "string" ? (() => { try { return strings(JSON.parse(value)); } catch { return []; } })() : [];

export class PostgresMagnetCandidateSubmissionStore implements MagnetCandidateSubmissionStore {
  constructor(private readonly pool: MagnetSubmitPool) {}
  async getRunnable(candidateId: string): Promise<MagnetCandidateSubmission | null> {
    const result = await this.pool.query<Row>(`
      SELECT s.id::text AS "subscriptionId", rc.id::text AS "candidateId", rc.info_hash AS "infoHash",
        rc.raw->>'magnet' AS magnet, se.media_type AS "mediaType", s.season_number AS "seasonNumber",
        s.target_season_cid AS "targetSeasonCid", s.missing_episode_keys AS "missingEpisodeKeys",
        rc.episode_keys AS "expectedEpisodeKeys", s.subscription_status AS "subscriptionStatus",
        s.lifecycle_status AS "lifecycleStatus", s.run_status AS "runStatus",
        s.completion_confirmed AS "completionConfirmed", s.total_episodes AS "totalEpisodes"
      FROM resource_candidates rc JOIN subscriptions s ON s.id = rc.subscription_id JOIN series se ON se.id = s.series_id
      WHERE rc.id::text = $1 AND rc.source = 'magnet' AND rc.status IN ('expanded', 'selected')
        AND rc.info_hash IS NOT NULL AND NULLIF(rc.raw->>'magnet', '') IS NOT NULL AND s.target_season_cid IS NOT NULL
        AND s.subscription_status = 'following' AND s.lifecycle_status = 'active'
        AND NOT EXISTS (SELECT 1 FROM release_requests rr WHERE rr.subscription_id = s.id AND rr.status IN ('queued', 'running', 'verifying'))
      LIMIT 1`, [candidateId]);
    const row = result.rows[0]; if (!row) return null;
    const missing = strings(row.missingEpisodeKeys);
    return { subscriptionId: row.subscriptionId, candidateId: row.candidateId, infoHash: row.infoHash, magnet: row.magnet,
      mediaType: row.mediaType, seasonNumber: row.seasonNumber, targetSeasonCid: row.targetSeasonCid,
      missingEpisodeKeys: missing, expectedEpisodeKeys: strings(row.expectedEpisodeKeys), state: {
        mediaType: row.mediaType, subscriptionStatus: row.subscriptionStatus, lifecycleStatus: row.lifecycleStatus,
        runStatus: row.runStatus, missingEpisodeKeys: missing, completionConfirmed: row.completionConfirmed, totalEpisodes: row.totalEpisodes
      } };
  }
  async claimSubmission(input: MagnetCandidateSubmission, idempotencyKey: string): Promise<boolean> {
    const result = await this.pool.query<{ id: string }>(`
      WITH eligible AS (
        SELECT rc.id, rc.subscription_id FROM resource_candidates rc JOIN subscriptions s ON s.id = rc.subscription_id
        WHERE rc.id::text = $1 AND rc.subscription_id::text = $2 AND rc.source = 'magnet' AND rc.status IN ('expanded', 'selected')
          AND s.subscription_status = 'following' AND s.lifecycle_status = 'active' AND s.target_season_cid = $3
          AND NOT EXISTS (SELECT 1 FROM release_requests rr WHERE rr.subscription_id = s.id AND rr.status IN ('queued', 'running', 'verifying'))
      ), claimed AS (
        INSERT INTO subscription_runs (subscription_id, job_kind, idempotency_key, metadata)
        SELECT subscription_id, 'candidate.submit', $4, jsonb_build_object('candidateId', id::text, 'source', 'magnet')
        FROM eligible ON CONFLICT (idempotency_key) DO NOTHING RETURNING subscription_id
      ), subscription AS (
        UPDATE subscriptions SET run_status = 'backfilling' WHERE id IN (SELECT subscription_id FROM claimed)
      )
      UPDATE resource_candidates SET status = 'selected', raw = raw || jsonb_build_object('missingEpisodeKeysAtSubmission', $5::jsonb)
      WHERE id IN (SELECT id FROM eligible) AND EXISTS (SELECT 1 FROM claimed) RETURNING id::text AS id`, [
      input.candidateId, input.subscriptionId, input.targetSeasonCid, idempotencyKey, JSON.stringify(input.missingEpisodeKeys)
    ]);
    return result.rows.length === 1;
  }
  async markSubmitted(input: MagnetCandidateSubmission, idempotencyKey: string, taskId: string | null, uncertain: boolean, errorCode?: string): Promise<void> {
    await this.pool.query(`
      WITH candidate AS (
        UPDATE resource_candidates SET status = 'submitted', raw = raw || jsonb_build_object(
          'offlineTaskId', $3::text, 'expectedEpisodeKeys', $4::jsonb, 'submissionUncertain', $5::boolean, 'submissionErrorCode', $6::text)
        WHERE id::text = $1 RETURNING subscription_id
      ), run AS (
        UPDATE subscription_runs SET outcome = 'succeeded', finished_at = now(), metadata = metadata || jsonb_build_object(
          'offlineTaskId', $3::text, 'submissionUncertain', $5::boolean, 'submissionErrorCode', $6::text)
        WHERE idempotency_key = $2 AND outcome = 'running'
      )
      INSERT INTO activities (subscription_id, level, event_type, message, metadata)
      SELECT subscription_id, CASE WHEN $5 THEN 'warning'::activity_level ELSE 'info'::activity_level END,
        'candidate.submitted', CASE WHEN $5 THEN '115 离线提交结果不确定，等待目录验证' ELSE '115 已接受磁力离线任务' END,
        jsonb_build_object('candidateId', $1::text, 'source', 'magnet') FROM candidate`, [
      input.candidateId, idempotencyKey, taskId, JSON.stringify(input.expectedEpisodeKeys), uncertain, errorCode ?? null
    ]);
  }
}
