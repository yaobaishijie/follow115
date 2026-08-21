import type { QueryResultRow } from "pg";
import type { GeneratedCleanupCandidate } from "./duplicate-candidate-generator.js";
import type { DuplicateCleanupSnapshot, DuplicateCleanupStore } from "./cleanup-worker.js";

export interface CleanupCandidatePreview {
  id: string;
  subscriptionId: string;
  title: string;
  episodeKey: string;
  keep: { fileId: string; name: string; quality: "2160p" | "1080p" };
  remove: { fileId: string; name: string; quality: "2160p" | "1080p" };
  reason: string;
}
export interface CleanupCandidateQueryPool { query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>; }
export interface CleanupCandidateRepository { upsertPending(candidates: readonly GeneratedCleanupCandidate[]): Promise<void>; listPending(): Promise<readonly CleanupCandidatePreview[]>; listPendingIds(candidateIds?: readonly string[]): Promise<readonly string[]>; }

type PreviewRow = { id: string; subscriptionId: string; title: string; episodeKey: string; keepFileId: string; keepName: string; keepQuality: "2160p" | "1080p"; removeFileId: string; removeName: string; removeQuality: "2160p" | "1080p"; reason: string; };

/** Local-only persistence; it neither reads 115 nor queues a deletion. */
export class PostgresCleanupCandidateRepository implements CleanupCandidateRepository, DuplicateCleanupStore {
  constructor(private readonly pool: CleanupCandidateQueryPool) {}
  async upsertPending(candidates: readonly GeneratedCleanupCandidate[]): Promise<void> {
    for (const candidate of candidates) await this.pool.query(`
      INSERT INTO cleanup_candidates (subscription_id, episode_key, keep_file_id, remove_file_id, keep_quality, remove_quality, reason, status)
      VALUES ($1::uuid, $2, $3, $4, $5::quality_tier, $6::quality_tier, $7, 'pending')
      ON CONFLICT (subscription_id, remove_file_id) DO UPDATE SET
        episode_key = EXCLUDED.episode_key, keep_file_id = EXCLUDED.keep_file_id, keep_quality = EXCLUDED.keep_quality,
        remove_quality = EXCLUDED.remove_quality, reason = EXCLUDED.reason, updated_at = now()
      WHERE cleanup_candidates.status = 'pending'`, [candidate.subscriptionId, candidate.episodeKey, candidate.keepFileId, candidate.removeFileId, candidate.keepQuality, candidate.removeQuality, candidate.reason]);
  }
  async listPending(): Promise<readonly CleanupCandidatePreview[]> {
    const result = await this.pool.query<PreviewRow>(`
      SELECT c.id::text AS "id", c.subscription_id::text AS "subscriptionId", se.series_title AS "title", c.episode_key AS "episodeKey",
        c.keep_file_id AS "keepFileId", keep.name AS "keepName", c.keep_quality AS "keepQuality",
        c.remove_file_id AS "removeFileId", remove.name AS "removeName", c.remove_quality AS "removeQuality", c.reason
      FROM cleanup_candidates c
      JOIN subscriptions s ON s.id = c.subscription_id
      JOIN series se ON se.id = s.series_id
      JOIN media_files keep ON keep.subscription_id = c.subscription_id AND keep.file_id = c.keep_file_id
      JOIN media_files remove ON remove.subscription_id = c.subscription_id AND remove.file_id = c.remove_file_id
      WHERE c.status = 'pending'
      ORDER BY c.created_at ASC, c.id ASC`);
    return result.rows.map((row) => ({ id: row.id, subscriptionId: row.subscriptionId, title: row.title, episodeKey: row.episodeKey,
      keep: { fileId: row.keepFileId, name: row.keepName, quality: row.keepQuality }, remove: { fileId: row.removeFileId, name: row.removeName, quality: row.removeQuality }, reason: row.reason }));
  }

  async listPendingIds(candidateIds?: readonly string[]): Promise<readonly string[]> {
    const result = await this.pool.query<{ id: string }>(`SELECT id::text AS id FROM cleanup_candidates
      WHERE status = 'pending' AND ($1::text[] IS NULL OR id::text = ANY($1::text[])) ORDER BY created_at ASC, id ASC`, [candidateIds ? [...candidateIds] : null]);
    return result.rows.map((row) => row.id);
  }

  async get(candidateId: string): Promise<DuplicateCleanupSnapshot | null> {
    const result = await this.pool.query<DuplicateCleanupSnapshot>(`
      SELECT c.id::text AS "candidateId", c.subscription_id::text AS "subscriptionId", c.episode_key AS "episodeKey",
        s.target_season_cid AS "targetSeasonCid", c.keep_file_id AS "keepFileId", c.remove_file_id AS "removeFileId",
        c.keep_quality AS "keepQuality", c.remove_quality AS "removeQuality", c.status,
        EXISTS (SELECT 1 FROM release_requests rr WHERE rr.subscription_id = c.subscription_id AND rr.status IN ('queued','running','verifying')) AS "releaseInProgress"
      FROM cleanup_candidates c JOIN subscriptions s ON s.id = c.subscription_id
      WHERE c.id::text = $1 AND c.status IN ('pending','running') LIMIT 1`, [candidateId]);
    return result.rows[0] ?? null;
  }

  async claim(snapshot: DuplicateCleanupSnapshot): Promise<boolean> {
    const result = await this.pool.query<{ id: string }>(`
      WITH claimed AS (
        UPDATE cleanup_candidates c SET status = 'running' WHERE c.id::text = $1 AND c.status IN ('pending','running')
          AND NOT EXISTS (SELECT 1 FROM release_requests rr WHERE rr.subscription_id = c.subscription_id AND rr.status IN ('queued','running','verifying'))
        RETURNING c.id, c.subscription_id
      ), run AS (
        INSERT INTO subscription_runs (subscription_id, job_kind, idempotency_key, metadata)
        SELECT subscription_id, 'duplicate.cleanup', 'duplicate-cleanup:' || id::text, jsonb_build_object('cleanupCandidateId', id::text)
        FROM claimed ON CONFLICT (idempotency_key) DO NOTHING
      ) SELECT id::text AS id FROM claimed`, [snapshot.candidateId]);
    return result.rows.length === 1;
  }

  async markCompleted(snapshot: DuplicateCleanupSnapshot): Promise<void> { await this.finish(snapshot, "completed", "duplicate.cleanup.completed", "重复文件已清理，系统推荐版本已保留"); }
  async markSkipped(snapshot: DuplicateCleanupSnapshot, reason: string): Promise<void> { await this.finish(snapshot, "skipped", "duplicate.cleanup.skipped", "目录已变化，本次清理已安全跳过", reason); }
  async markFailed(snapshot: DuplicateCleanupSnapshot, reason: string): Promise<void> { await this.finish(snapshot, "failed", "duplicate.cleanup.failed", "重复文件清理未完成", reason); }

  private async finish(snapshot: DuplicateCleanupSnapshot, status: "completed" | "skipped" | "failed", eventType: string, message: string, error?: string): Promise<void> {
    await this.pool.query(`WITH candidate AS (
      UPDATE cleanup_candidates SET status = $2::cleanup_status WHERE id::text = $1 AND status = 'running' RETURNING subscription_id
    ), run AS (
      UPDATE subscription_runs SET outcome = $3::run_outcome, error_code = $4, error_message = $5, finished_at = now()
      WHERE idempotency_key = 'duplicate-cleanup:' || $1 AND outcome = 'running'
    ) INSERT INTO activities (subscription_id, level, event_type, message, metadata)
      SELECT subscription_id, $6::activity_level, $7, $8, jsonb_build_object('cleanupCandidateId', $1::text) FROM candidate`,
      [snapshot.candidateId, status, status === "completed" ? "succeeded" : status === "skipped" ? "cancelled" : "failed", error ? "DUPLICATE_CLEANUP_REVALIDATION" : null, error ?? null, status === "failed" ? "error" : status === "skipped" ? "warning" : "info", eventType, message]);
  }
}
