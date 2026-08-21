import type { MediaType, SubscriptionState } from "@follow115/contracts";
import type { Pan115OfflineClient } from "../pan115/offline-client.js";
import type { CandidateVerificationQueue } from "./pan115-candidate-submit.js";

export interface MagnetCandidateSubmission {
  subscriptionId: string; candidateId: string; infoHash: string; magnet: string;
  mediaType: MediaType; seasonNumber: number; targetSeasonCid: string;
  missingEpisodeKeys: readonly string[]; expectedEpisodeKeys: readonly string[]; state: SubscriptionState;
}

export interface MagnetCandidateSubmissionStore {
  getRunnable(candidateId: string): Promise<MagnetCandidateSubmission | null>;
  claimSubmission(input: MagnetCandidateSubmission, idempotencyKey: string): Promise<boolean>;
  markSubmitted(input: MagnetCandidateSubmission, idempotencyKey: string, taskId: string | null, uncertain: boolean, errorCode?: string): Promise<void>;
}

export type MagnetCandidateSubmitResult = { kind: "skipped" | "submitted" | "verification-pending"; reason?: "not-runnable" | "duplicate" | "uncertain-submit" };

export class MagnetCandidateSubmitWorker {
  constructor(
    private readonly store: MagnetCandidateSubmissionStore,
    private readonly offline: Pan115OfflineClient,
    private readonly verification: CandidateVerificationQueue,
    private readonly verificationDelayMs: number,
    private readonly now: () => number = Date.now
  ) {
    if (!Number.isInteger(verificationDelayMs) || verificationDelayMs < 0) throw new RangeError("verificationDelayMs must be a non-negative integer.");
  }

  async run(candidateId: string): Promise<MagnetCandidateSubmitResult> {
    const input = await this.store.getRunnable(candidateId);
    if (!input || input.state.subscriptionStatus !== "following" || input.state.lifecycleStatus !== "active") return { kind: "skipped", reason: "not-runnable" };
    const key = `subscription:${input.subscriptionId}:candidate:${input.candidateId}:submit`;
    if (!await this.store.claimSubmission(input, key)) return { kind: "skipped", reason: "duplicate" };
    try {
      const task = await this.offline.submitMagnet(input.magnet, input.targetSeasonCid);
      await this.store.markSubmitted(input, key, task.taskId, false);
    } catch (error) {
      const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "EXTERNAL_UNAVAILABLE";
      await this.store.markSubmitted(input, key, null, true, code);
      await this.enqueue(input);
      return { kind: "verification-pending", reason: "uncertain-submit" };
    }
    await this.enqueue(input);
    return { kind: "submitted" };
  }

  private enqueue(input: MagnetCandidateSubmission): Promise<void> {
    return this.verification.enqueue({ subscriptionId: input.subscriptionId, candidateId: input.candidateId, startAfter: new Date(this.now() + this.verificationDelayMs) });
  }
}
