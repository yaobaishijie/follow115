import type { QueryResultRow } from "pg";
import { readAllFolderPages, type Pan115FolderPageClient } from "../pan115/list-folder.js";
import type { CredentialStore } from "../settings/settings-service.js";
import type { ReleaseCleanupSnapshot, ReleaseCleanupStore, ReleaseDirectoryReader } from "./release-cleanup.js";

export interface ReleaseCleanupPool {
  query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

type ReleaseRow = ReleaseCleanupSnapshot;

export class PostgresReleaseCleanupStore implements ReleaseCleanupStore {
  constructor(private readonly pool: ReleaseCleanupPool) {}

  async get(requestId: string): Promise<ReleaseCleanupSnapshot | null> {
    const result = await this.pool.query<ReleaseRow>(`
      SELECT rr.id::text AS "requestId", rr.subscription_id::text AS "subscriptionId", rr.generation,
        rr.target_season_cid AS "targetSeasonCid", rr.status AS "requestStatus",
        s.subscription_status AS "subscriptionStatus", s.release_generation AS "currentGeneration"
      FROM release_requests rr JOIN subscriptions s ON s.id = rr.subscription_id
      WHERE rr.id::text = $1 AND rr.status IN ('queued', 'running', 'verifying') LIMIT 1`, [requestId]);
    return result.rows[0] ?? null;
  }

  async claim(snapshot: ReleaseCleanupSnapshot): Promise<boolean> {
    const result = await this.pool.query<{ id: string }>(`
      WITH claimed AS (
        UPDATE release_requests SET status = 'running', attempts = attempts + 1, claimed_at = now()
        WHERE id::text = $1 AND generation = $2 AND status IN ('queued', 'running', 'verifying')
        RETURNING id, subscription_id
      ), run AS (
        INSERT INTO subscription_runs (subscription_id, job_kind, idempotency_key, metadata)
        SELECT subscription_id, 'cleanup', 'release:' || id::text,
          jsonb_build_object('releaseRequestId', id::text, 'generation', $2::integer)
        FROM claimed ON CONFLICT (idempotency_key) DO NOTHING
      )
      SELECT id::text AS id FROM claimed`, [snapshot.requestId, snapshot.generation]);
    return result.rows.length === 1;
  }

  async markVerifying(snapshot: ReleaseCleanupSnapshot, targetEntryIds: readonly string[], error?: string): Promise<void> {
    await this.pool.query(`
      WITH request AS (
        UPDATE release_requests SET status = 'verifying', target_entry_ids = $2::jsonb,
          submitted_at = now(), last_error = $3 WHERE id::text = $1 RETURNING id
      )
      UPDATE subscription_runs SET metadata = metadata || jsonb_build_object(
        'targetEntryIds', $2::jsonb, 'lastDeleteError', $3::text)
      WHERE idempotency_key = 'release:' || $1 AND outcome = 'running'`, [snapshot.requestId, JSON.stringify(targetEntryIds), error ?? null]);
  }

  async markCompleted(snapshot: ReleaseCleanupSnapshot): Promise<void> {
    await this.pool.query(`
      WITH request AS (
        UPDATE release_requests SET status = 'completed', completed_at = now(), last_error = NULL
        WHERE id::text = $1 AND generation = $2 RETURNING subscription_id
      ), subscription AS (
        UPDATE subscriptions SET run_status = 'released', existing_episode_keys = '[]'::jsonb,
          missing_episode_keys = '[]'::jsonb, processing_episode_keys = '[]'::jsonb
        WHERE id IN (SELECT subscription_id FROM request) AND release_generation = $2 AND subscription_status = 'paused'
        RETURNING id
      ), files AS (
        DELETE FROM media_files WHERE subscription_id IN (SELECT id FROM subscription)
      ), run AS (
        UPDATE subscription_runs SET outcome = 'succeeded', finished_at = now()
        WHERE idempotency_key = 'release:' || $1 AND outcome = 'running'
      )
      INSERT INTO activities (subscription_id, level, event_type, message, metadata)
      SELECT id, 'info', 'release.completed', '当前 Season 内容已释放，文件夹与订阅已保留',
        jsonb_build_object('releaseRequestId', $1::text, 'generation', $2::integer) FROM subscription`, [snapshot.requestId, snapshot.generation]);
  }

  async markFailed(snapshot: ReleaseCleanupSnapshot, error: string): Promise<void> {
    await this.pool.query(`
      WITH request AS (
        UPDATE release_requests SET status = 'failed', last_error = $3, completed_at = now()
        WHERE id::text = $1 AND generation = $2 RETURNING subscription_id
      ), subscription AS (
        UPDATE subscriptions SET run_status = 'waiting'
        WHERE id IN (SELECT subscription_id FROM request) AND release_generation = $2 RETURNING id
      ), run AS (
        UPDATE subscription_runs SET outcome = 'failed', error_code = 'RELEASE_VERIFICATION_FAILED',
          error_message = $3, finished_at = now()
        WHERE idempotency_key = 'release:' || $1 AND outcome = 'running'
      )
      INSERT INTO activities (subscription_id, level, event_type, message, metadata)
      SELECT id, 'error', 'release.failed', '释放未完成，订阅保持暂停',
        jsonb_build_object('releaseRequestId', $1::text, 'generation', $2::integer) FROM subscription`, [snapshot.requestId, snapshot.generation, error]);
  }

  async listRecoverable(): Promise<readonly { requestId: string; subscriptionId: string; generation: number }[]> {
    const result = await this.pool.query<{ requestId: string; subscriptionId: string; generation: number }>(`
      SELECT id::text AS "requestId", subscription_id::text AS "subscriptionId", generation
      FROM release_requests WHERE status IN ('queued', 'running', 'verifying') ORDER BY requested_at ASC`);
    return result.rows;
  }
}

export class SavedCredentialReleaseDirectoryReader implements ReleaseDirectoryReader {
  constructor(private readonly credentials: CredentialStore, private readonly createClient: (cookie: string) => Pan115FolderPageClient) {}
  async listDirectEntries(targetSeasonCid: string) {
    const credential = await this.credentials.getPan115Credential();
    if (!credential) throw new Error("Configure and verify a 115 cookie before releasing content.");
    return readAllFolderPages(this.createClient(credential.cookie), targetSeasonCid);
  }
}
