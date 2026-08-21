import { detectQuality, episodeKeys, parseVideoFile } from "../pan115/file-parser.js";
import type { Pan115Item } from "../pan115/directory-model.js";
import type { Pan115RecycleDeleteClient } from "../pan115/recycle-delete-client.js";

export interface DuplicateCleanupSnapshot {
  candidateId: string;
  subscriptionId: string;
  episodeKey: string;
  targetSeasonCid: string;
  keepFileId: string;
  removeFileId: string;
  keepQuality: "2160p" | "1080p";
  removeQuality: "2160p" | "1080p";
  status: "pending" | "running";
  releaseInProgress: boolean;
}

export interface DuplicateCleanupStore {
  get(candidateId: string): Promise<DuplicateCleanupSnapshot | null>;
  claim(snapshot: DuplicateCleanupSnapshot): Promise<boolean>;
  markCompleted(snapshot: DuplicateCleanupSnapshot): Promise<void>;
  markSkipped(snapshot: DuplicateCleanupSnapshot, reason: string): Promise<void>;
  markFailed(snapshot: DuplicateCleanupSnapshot, reason: string): Promise<void>;
}

export interface DuplicateCleanupDirectoryReader { listDirectEntries(cid: string): Promise<readonly Pan115Item[]>; }

export class DuplicateCleanupVerificationPendingError extends Error {
  readonly retryable = true;
  constructor() { super("Duplicate file deletion is awaiting live directory verification."); this.name = "DuplicateCleanupVerificationPendingError"; }
}

function isExpectedEpisode(item: Pan115Item, episodeKey: string, expectedQuality: "2160p" | "1080p"): boolean {
  if (item.isDirectory || detectQuality(item.name) !== expectedQuality) return false;
  const parsed = parseVideoFile(item.name);
  return parsed.isFeature && parsed.episode !== null && episodeKeys(parsed.episode).length === 1 && episodeKeys(parsed.episode)[0] === episodeKey;
}

/** Deletes only the precomputed remove file after a fresh, exact live revalidation. */
export class DuplicateCleanupWorker {
  constructor(private readonly store: DuplicateCleanupStore, private readonly reader: DuplicateCleanupDirectoryReader, private readonly deleter: Pan115RecycleDeleteClient) {}

  async run(candidateId: string, finalAttempt: boolean): Promise<"completed" | "skipped" | "failed"> {
    const snapshot = await this.store.get(candidateId);
    if (!snapshot) return "skipped";
    if (snapshot.releaseInProgress || !await this.store.claim(snapshot)) return "skipped";
    const entries = await this.reader.listDirectEntries(snapshot.targetSeasonCid);
    const keep = entries.find((entry) => entry.id === snapshot.keepFileId);
    const remove = entries.find((entry) => entry.id === snapshot.removeFileId);
    if (!remove && keep && isExpectedEpisode(keep, snapshot.episodeKey, snapshot.keepQuality)) {
      await this.store.markCompleted(snapshot);
      return "completed";
    }
    if (!keep || !remove || !isExpectedEpisode(keep, snapshot.episodeKey, snapshot.keepQuality) || !isExpectedEpisode(remove, snapshot.episodeKey, snapshot.removeQuality)) {
      await this.store.markSkipped(snapshot, "Live Season contents no longer match the confirmed duplicate recommendation.");
      return "skipped";
    }
    if (finalAttempt) {
      await this.store.markFailed(snapshot, "The duplicate file remained present after verification retries.");
      return "failed";
    }
    await this.deleter.deleteFiles([snapshot.removeFileId]);
    throw new DuplicateCleanupVerificationPendingError();
  }
}
