import { AppError, type MediaType, type Pan115Share, type SubscriptionState } from "@follow115/contracts";
import { episodeKeys, parseVideoFile } from "../pan115/file-parser.js";
import type { Pan115ShareExpansion } from "../pan115/share-expand-service.js";

export interface Pan115CandidateSubmission {
  subscriptionId: string;
  candidateId: string;
  candidateKey: string;
  mediaType: MediaType;
  seasonNumber: number;
  targetSeasonCid: string;
  missingEpisodeKeys: readonly string[];
  state: SubscriptionState;
  share: Pan115Share;
}

export interface Pan115CandidateSubmissionStore {
  /** Must return null unless the subscription and candidate remain runnable. */
  getRunnable(candidateId: string): Promise<Pan115CandidateSubmission | null>;
  /** Atomic DB idempotency claim; false means this exact submit already ran. */
  claimSubmission(input: Pan115CandidateSubmission, idempotencyKey: string): Promise<boolean>;
  markSubmitted(candidateId: string, idempotencyKey: string, files: readonly SelectedPan115File[]): Promise<void>;
  markSubmissionUncertain(candidateId: string, idempotencyKey: string, files: readonly SelectedPan115File[], errorCode: string): Promise<void>;
  markConfirmedResourceFailure(candidateId: string, candidateKey: string, reason: string, idempotencyKey?: string): Promise<void>;
}

export interface Pan115CandidateShareExpander {
  expand(share: Pan115Share): Promise<Pan115ShareExpansion>;
}

export interface Pan115CandidateSavePort {
  save(input: { shareCode: string; receiveCode?: string; fileIds: readonly string[]; targetCid: string }): Promise<unknown>;
}

export interface CandidateVerificationQueue {
  enqueue(input: { subscriptionId: string; candidateId: string; startAfter: Date }): Promise<void>;
}

export interface Pan115CandidateSubmitResult {
  kind: "skipped" | "submitted" | "verification-pending" | "resource-failed";
  reason?: "not-runnable" | "duplicate" | "no-eligible-files" | "share-rejected" | "uncertain-submit";
  fileIds?: readonly string[];
}

export interface SelectedPan115File {
  sourceFileId: string;
  name: string;
  episodeKeys: readonly string[];
}

export class Pan115CandidateSubmitWorker {
  constructor(
    private readonly store: Pan115CandidateSubmissionStore,
    private readonly shares: Pan115CandidateShareExpander,
    private readonly saves: Pan115CandidateSavePort,
    private readonly verification: CandidateVerificationQueue,
    private readonly verificationDelayMs: number,
    private readonly now: () => number = Date.now
  ) {
    if (!Number.isInteger(verificationDelayMs) || verificationDelayMs < 0) throw new RangeError("verificationDelayMs must be a non-negative integer.");
  }

  async run(candidateId: string): Promise<Pan115CandidateSubmitResult> {
    const input = await this.store.getRunnable(candidateId);
    if (!input || input.state.subscriptionStatus !== "following" || input.state.lifecycleStatus !== "active") {
      return { kind: "skipped", reason: "not-runnable" };
    }
    const expansion = await this.shares.expand(input.share);
    const files = selectExactPan115Files(expansion, input);
    const fileIds = files.map((file) => file.sourceFileId);
    if (files.length === 0) {
      await this.store.markConfirmedResourceFailure(input.candidateId, input.candidateKey, "no eligible current-season feature files");
      return { kind: "resource-failed", reason: "no-eligible-files" };
    }
    const idempotencyKey = `subscription:${input.subscriptionId}:candidate:${input.candidateId}:submit`;
    if (!await this.store.claimSubmission(input, idempotencyKey)) return { kind: "skipped", reason: "duplicate" };
    try {
      await this.saves.save({
        shareCode: input.share.shareCode,
        ...(input.share.receiveCode ? { receiveCode: input.share.receiveCode } : {}),
        fileIds,
        targetCid: input.targetSeasonCid
      });
    } catch (error) {
      if (error instanceof AppError && error.code === "RESOURCE_UNAVAILABLE" && !error.retryable) {
        await this.store.markConfirmedResourceFailure(input.candidateId, input.candidateKey, "115 share rejected the selected files", idempotencyKey);
        return { kind: "resource-failed", reason: "share-rejected" };
      }
      const errorCode = error instanceof AppError ? error.code : "EXTERNAL_UNAVAILABLE";
      // A transport failure can happen after 115 accepted the write. Never
      // blindly resubmit: persist the uncertainty and let the delayed read
      // verification decide whether the file appeared.
      await this.store.markSubmissionUncertain(input.candidateId, idempotencyKey, files, errorCode);
      await this.enqueueVerification(input);
      return { kind: "verification-pending", reason: "uncertain-submit", fileIds };
    }
    await this.store.markSubmitted(input.candidateId, idempotencyKey, files);
    await this.enqueueVerification(input);
    return { kind: "submitted", fileIds };
  }

  private async enqueueVerification(input: Pan115CandidateSubmission): Promise<void> {
    await this.verification.enqueue({
      subscriptionId: input.subscriptionId,
      candidateId: input.candidateId,
      startAfter: new Date(this.now() + this.verificationDelayMs)
    });
  }
}

/** Selects exact file IDs; a folder ID or unrelated season can never cross the save boundary. */
export function selectExactPan115FileIds(expansion: Pan115ShareExpansion, input: Pick<Pan115CandidateSubmission, "mediaType" | "seasonNumber" | "missingEpisodeKeys">): string[] {
  return selectExactPan115Files(expansion, input).map((file) => file.sourceFileId);
}

export function selectExactPan115Files(expansion: Pan115ShareExpansion, input: Pick<Pan115CandidateSubmission, "mediaType" | "seasonNumber" | "missingEpisodeKeys">): SelectedPan115File[] {
  const missing = new Set(input.missingEpisodeKeys);
  return expansion.files.flatMap(({ item, parentPath }) => {
    const parsed = parseVideoFile(item.name, parentPath);
    if (!parsed.isFeature || item.isDirectory) return [];
    if (input.mediaType === "movie") return item.id ? [{ sourceFileId: item.id, name: item.name, episodeKeys: [] }] : [];
    if (!parsed.episode || parsed.episode.season !== input.seasonNumber) return [];
    const keys = episodeKeys(parsed.episode);
    const coversMissing = keys.some((key) => missing.has(key));
    return coversMissing && item.id ? [{ sourceFileId: item.id, name: item.name, episodeKeys: keys }] : [];
  });
}
