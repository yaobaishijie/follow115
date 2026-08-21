import assert from "node:assert/strict";
import test from "node:test";
import type { CandidateVerificationSnapshot, CandidateVerificationStore } from "./candidate-verification.js";
import { CandidateVerificationPendingError, CandidateVerificationWorker, verifiesSelectedContent } from "./candidate-verification.js";

const snapshot: CandidateVerificationSnapshot = {
  subscriptionId: "sub", candidateId: "candidate", candidateKey: "share", source: "pan115", mediaType: "series", seasonNumber: 1,
  targetSeasonCid: "season", targetSeasonPath: "测试/Show/Season 01", missingEpisodeKeysAtSubmission: ["S01E01", "S01E02"],
  selectedFiles: [{ sourceFileId: "f1", name: "Show.S01E01.mkv", episodeKeys: ["S01E01"] }],
  expectedEpisodeKeys: [], submissionUncertain: false,
  checkRoundId: "round", roundRank: 0,
  state: { mediaType: "series", subscriptionStatus: "following", lifecycleStatus: "active", runStatus: "backfilling", missingEpisodeKeys: ["S01E01", "S01E02"], completionConfirmed: false, totalEpisodes: null }
};

class Store implements CandidateVerificationStore {
  verified: readonly string[] | null = null; skipped = false; failed = false; infrastructureFailed = false;
  async get() { return snapshot; }
  async markVerified(_snapshot: CandidateVerificationSnapshot, _scan: unknown, missing: readonly string[]) { this.verified = missing; }
  async markSkipped() { this.skipped = true; }
  async markFinalResourceFailure() { this.failed = true; }
  async markFinalInfrastructureFailure() { this.infrastructureFailed = true; }
  async findNextCandidate() { return "candidate-2"; }
}

test("verification uses Season episode coverage for series and exact feature names for movies", () => {
  assert.equal(verifiesSelectedContent(snapshot, { episodeKeys: ["S01E01"], featureFileNames: ["renamed.mkv"] }), true);
  assert.equal(verifiesSelectedContent(snapshot, { episodeKeys: ["S02E01"], featureFileNames: ["Show.S01E01.mkv"] }), false);
  assert.equal(verifiesSelectedContent({ ...snapshot, mediaType: "movie", selectedFiles: [{ sourceFileId: "f", name: "Movie.mkv", episodeKeys: [] }] }, { episodeKeys: [], featureFileNames: ["Movie.mkv"] }), true);
});

test("an uncertain submission that stays invisible is not counted as a resource failure", async () => {
  const store = new Store();
  store.get = async () => ({ ...snapshot, submissionUncertain: true });
  const worker = new CandidateVerificationWorker(store, { async scan() { return { episodeKeys: [], featureFileNames: [] }; } });
  await worker.run("candidate", true);
  assert.equal(store.failed, false);
  assert.equal(store.infrastructureFailed, true);
});

test("verification updates missing episodes only after a real directory scan", async () => {
  const store = new Store();
  const worker = new CandidateVerificationWorker(store, { async scan() { return { episodeKeys: ["S01E01"], featureFileNames: ["Show.S01E01.mkv"] }; } });
  assert.deepEqual(await worker.run("candidate", false), { kind: "verified", missingEpisodeKeys: ["S01E02"], nextCandidateId: "candidate-2" });
  assert.deepEqual(store.verified, ["S01E02"]);
});

test("not-yet-visible files use pg-boss retry and become a resource failure only on the final attempt", async () => {
  const store = new Store();
  const worker = new CandidateVerificationWorker(store, { async scan() { return { episodeKeys: [], featureFileNames: [] }; } });
  await assert.rejects(() => worker.run("candidate", false), (error: unknown) => error instanceof CandidateVerificationPendingError);
  assert.equal(store.failed, false);
  assert.deepEqual(await worker.run("candidate", true), { kind: "resource-failed", reason: "not-visible", nextCandidateId: "candidate-2" });
  assert.equal(store.failed, true);
});
