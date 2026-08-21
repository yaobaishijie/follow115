import type { CandidateSource, MediaType, SubscriptionState } from "@follow115/contracts";
import type { SelectedPan115File } from "./pan115-candidate-submit.js";

export interface CandidateVerificationSnapshot {
  subscriptionId: string;
  candidateId: string;
  candidateKey: string;
  source: CandidateSource;
  mediaType: MediaType;
  seasonNumber: number;
  targetSeasonCid: string;
  targetSeasonPath: string | null;
  missingEpisodeKeysAtSubmission: readonly string[];
  selectedFiles: readonly SelectedPan115File[];
  expectedEpisodeKeys: readonly string[];
  submissionUncertain: boolean;
  checkRoundId: string;
  roundRank: number;
  state: SubscriptionState;
}

export interface CandidateDirectoryScan {
  episodeKeys: readonly string[];
  featureFileNames: readonly string[];
}

export interface CandidateVerificationStore {
  get(candidateId: string): Promise<CandidateVerificationSnapshot | null>;
  markVerified(snapshot: CandidateVerificationSnapshot, scan: CandidateDirectoryScan, missingEpisodeKeys: readonly string[]): Promise<void>;
  markSkipped(candidateId: string, reason: string): Promise<void>;
  markFinalResourceFailure(snapshot: CandidateVerificationSnapshot, reason: string): Promise<void>;
  markFinalInfrastructureFailure(snapshot: CandidateVerificationSnapshot, reason: string): Promise<void>;
  findNextCandidate(snapshot: CandidateVerificationSnapshot): Promise<string | null>;
}

export interface CandidateDirectoryReader {
  scan(snapshot: CandidateVerificationSnapshot): Promise<CandidateDirectoryScan>;
}

export class CandidateVerificationPendingError extends Error {
  readonly retryable = true;
  constructor() { super("Candidate files are not visible in the target directory yet."); this.name = "CandidateVerificationPendingError"; }
}

export type CandidateVerificationResult =
  | { kind: "skipped"; reason: "not-found" | "not-active" }
  | { kind: "verified"; missingEpisodeKeys: readonly string[]; nextCandidateId: string | null }
  | { kind: "resource-failed"; reason: "not-visible"; nextCandidateId: string | null };

/** One pg-boss verification attempt. Retrying is delegated to pg-boss; this worker never sleeps. */
export class CandidateVerificationWorker {
  constructor(private readonly store: CandidateVerificationStore, private readonly reader: CandidateDirectoryReader) {}

  async run(candidateId: string, finalAttempt: boolean): Promise<CandidateVerificationResult> {
    const snapshot = await this.store.get(candidateId);
    if (!snapshot) return { kind: "skipped", reason: "not-found" };
    if (snapshot.state.subscriptionStatus !== "following" || snapshot.state.lifecycleStatus !== "active") {
      await this.store.markSkipped(candidateId, "subscription is no longer active");
      return { kind: "skipped", reason: "not-active" };
    }
    const scan = await this.reader.scan(snapshot);
    const verified = verifiesSelectedContent(snapshot, scan);
    if (verified) {
      const present = new Set(scan.episodeKeys);
      const missingEpisodeKeys = snapshot.missingEpisodeKeysAtSubmission.filter((key) => !present.has(key));
      await this.store.markVerified(snapshot, scan, missingEpisodeKeys);
      const nextCandidateId = missingEpisodeKeys.length === 0 ? null : await this.store.findNextCandidate(snapshot);
      return { kind: "verified", missingEpisodeKeys, nextCandidateId };
    }
    if (!finalAttempt) throw new CandidateVerificationPendingError();
    if (snapshot.submissionUncertain) await this.store.markFinalInfrastructureFailure(snapshot, "submission remained unconfirmed after persistent verification retries");
    else await this.store.markFinalResourceFailure(snapshot, "selected files did not appear after persistent verification retries");
    return { kind: "resource-failed", reason: "not-visible", nextCandidateId: await this.store.findNextCandidate(snapshot) };
  }
}

export function verifiesSelectedContent(snapshot: CandidateVerificationSnapshot, scan: CandidateDirectoryScan): boolean {
  if (snapshot.mediaType === "movie") {
    if (snapshot.source === "magnet") return scan.featureFileNames.length > 0;
    const names = new Set(scan.featureFileNames.map((name) => name.normalize("NFKC")));
    return snapshot.selectedFiles.some((file) => names.has(file.name.normalize("NFKC")));
  }
  const present = new Set(scan.episodeKeys);
  const expected = snapshot.source === "magnet" ? snapshot.expectedEpisodeKeys : snapshot.selectedFiles.flatMap((file) => file.episodeKeys);
  const targeted = new Set(expected.filter((key) => snapshot.missingEpisodeKeysAtSubmission.includes(key)));
  return targeted.size > 0 && [...targeted].some((key) => present.has(key));
}
