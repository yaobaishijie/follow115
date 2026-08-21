import type { Pan115Item } from "../pan115/directory-model.js";
import type { Pan115RecycleDeleteClient } from "../pan115/recycle-delete-client.js";

export interface ReleaseCleanupSnapshot {
  requestId: string;
  subscriptionId: string;
  generation: number;
  targetSeasonCid: string;
  requestStatus: "queued" | "running" | "verifying";
  subscriptionStatus: "following" | "paused" | "stopped";
  currentGeneration: number;
}

export interface ReleaseCleanupStore {
  get(requestId: string): Promise<ReleaseCleanupSnapshot | null>;
  claim(snapshot: ReleaseCleanupSnapshot): Promise<boolean>;
  markVerifying(snapshot: ReleaseCleanupSnapshot, targetEntryIds: readonly string[], error?: string): Promise<void>;
  markCompleted(snapshot: ReleaseCleanupSnapshot): Promise<void>;
  markFailed(snapshot: ReleaseCleanupSnapshot, error: string): Promise<void>;
}

export interface ReleaseDirectoryReader {
  listDirectEntries(targetSeasonCid: string): Promise<readonly Pan115Item[]>;
}

export class ReleaseVerificationPendingError extends Error {
  readonly retryable = true;
  constructor() { super("Season directory is not empty yet."); this.name = "ReleaseVerificationPendingError"; }
}

export type ReleaseCleanupResult =
  | { kind: "skipped"; reason: "not-found-or-terminal" | "stale-or-not-paused" | "already-claimed" }
  | { kind: "completed"; removedEntryCount: number }
  | { kind: "failed"; remainingEntryCount: number };

/**
 * Persistent release attempt. Every retry reads the live Season root first;
 * only IDs still present are submitted, so an uncertain response never causes
 * a blind replay and the Season CID itself can never be deleted.
 */
export class ReleaseCleanupWorker {
  constructor(
    private readonly store: ReleaseCleanupStore,
    private readonly reader: ReleaseDirectoryReader,
    private readonly deleter: Pan115RecycleDeleteClient
  ) {}

  async run(requestId: string, finalAttempt: boolean): Promise<ReleaseCleanupResult> {
    const snapshot = await this.store.get(requestId);
    if (!snapshot) return { kind: "skipped", reason: "not-found-or-terminal" };
    if (snapshot.subscriptionStatus !== "paused" || snapshot.currentGeneration !== snapshot.generation) {
      return { kind: "skipped", reason: "stale-or-not-paused" };
    }
    if (!await this.store.claim(snapshot)) return { kind: "skipped", reason: "already-claimed" };
    const entries = await this.reader.listDirectEntries(snapshot.targetSeasonCid);
    if (entries.length === 0) {
      await this.store.markCompleted(snapshot);
      return { kind: "completed", removedEntryCount: 0 };
    }
    if (finalAttempt) {
      await this.store.markFailed(snapshot, "Season directory remained non-empty after persistent verification retries.");
      return { kind: "failed", remainingEntryCount: entries.length };
    }
    const ids = [...new Set(entries.map((entry) => entry.id).filter(Boolean))];
    try {
      await this.deleter.deleteFiles(ids);
      await this.store.markVerifying(snapshot, ids);
    } catch (error) {
      const message = error instanceof Error ? error.message : "115 delete request failed.";
      await this.store.markVerifying(snapshot, ids, message);
    }
    throw new ReleaseVerificationPendingError();
  }
}
