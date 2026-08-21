import assert from "node:assert/strict";
import test from "node:test";
import { AppError, type Pan115Share, type SubscriptionState } from "@follow115/contracts";
import type { Pan115ShareExpansion } from "../pan115/share-expand-service.js";
import { Pan115CandidateSubmitWorker, selectExactPan115FileIds, type Pan115CandidateSubmission, type Pan115CandidateSubmissionStore } from "./pan115-candidate-submit.js";

const state: SubscriptionState = { mediaType: "series", subscriptionStatus: "following", lifecycleStatus: "active", runStatus: "waiting", missingEpisodeKeys: ["S01E01"], completionConfirmed: false, totalEpisodes: null };
const share: Pan115Share = { shareCode: "share", receiveCode: "pw", url: "https://115.com/s/share?password=pw" };
const submission: Pan115CandidateSubmission = { subscriptionId: "sub", candidateId: "candidate", candidateKey: "share", mediaType: "series", seasonNumber: 1, targetSeasonCid: "season", missingEpisodeKeys: ["S01E01"], state, share };
const expansion: Pan115ShareExpansion = { rootCid: null, directoriesScanned: 1, filesScanned: 4, files: [
  { item: { id: "video", fid: "video", cid: "", name: "Show.S01E01.2160p.mkv", isDirectory: false, size: 8, pickCode: "", raw: {} }, parentCid: null, parentPath: [] },
  { item: { id: "subtitle", fid: "subtitle", cid: "", name: "Show.S01E01.srt", isDirectory: false, size: 1, pickCode: "", raw: {} }, parentCid: null, parentPath: [] },
  { item: { id: "other", fid: "other", cid: "", name: "Show.S02E01.2160p.mkv", isDirectory: false, size: 8, pickCode: "", raw: {} }, parentCid: null, parentPath: [] },
  { item: { id: "trailer", fid: "trailer", cid: "", name: "Show.S01E01.trailer.2160p.mkv", isDirectory: false, size: 1, pickCode: "", raw: {} }, parentCid: null, parentPath: [] }
] };

class Store implements Pan115CandidateSubmissionStore {
  claimed = true; submitted: readonly string[] = []; failures: string[] = [];
  async getRunnable() { return submission; }
  async claimSubmission() { return this.claimed; }
  async markSubmitted(_id: string, _key: string, files: readonly { sourceFileId: string }[]) { this.submitted = files.map((file) => file.sourceFileId); }
  async markSubmissionUncertain(_id: string, _key: string, files: readonly { sourceFileId: string }[]) { this.submitted = files.map((file) => file.sourceFileId); }
  async markConfirmedResourceFailure(_id: string, _key: string, reason: string) { this.failures.push(reason); }
}

test("exact selection excludes subtitles, trailers, other seasons, and already-present episodes", () => {
  assert.deepEqual(selectExactPan115FileIds(expansion, submission), ["video"]);
  assert.deepEqual(selectExactPan115FileIds(expansion, { ...submission, missingEpisodeKeys: ["S01E02"] }), []);
});

test("submit worker claims once, saves exact files, and persists delayed verification", async () => {
  const store = new Store(); const saves: unknown[] = []; const jobs: unknown[] = [];
  const worker = new Pan115CandidateSubmitWorker(store, { async expand() { return expansion; } }, { async save(input) { saves.push(input); } }, { async enqueue(input) { jobs.push(input); } }, 15_000, () => 1_000);
  assert.deepEqual(await worker.run("candidate"), { kind: "submitted", fileIds: ["video"] });
  assert.deepEqual(saves, [{ shareCode: "share", receiveCode: "pw", fileIds: ["video"], targetCid: "season" }]);
  assert.deepEqual(store.submitted, ["video"]);
  assert.deepEqual(jobs, [{ subscriptionId: "sub", candidateId: "candidate", startAfter: new Date(16_000) }]);
  store.claimed = false;
  assert.deepEqual(await worker.run("candidate"), { kind: "skipped", reason: "duplicate" });
});

test("confirmed share rejection is counted while uncertain transport errors are verified without resubmission", async () => {
  const rejected = new Store();
  const worker = new Pan115CandidateSubmitWorker(rejected, { async expand() { return expansion; } }, { async save() { throw new AppError("RESOURCE_UNAVAILABLE", "rejected", false); } }, { async enqueue() {} }, 0);
  assert.deepEqual(await worker.run("candidate"), { kind: "resource-failed", reason: "share-rejected" });
  assert.equal(rejected.failures.length, 1);
  const uncertainStore = new Store(); const jobs: unknown[] = [];
  const unavailable = new Pan115CandidateSubmitWorker(uncertainStore, { async expand() { return expansion; } }, { async save() { throw new AppError("EXTERNAL_UNAVAILABLE", "down", true); } }, { async enqueue(input) { jobs.push(input); } }, 0, () => 2_000);
  assert.deepEqual(await unavailable.run("candidate"), { kind: "verification-pending", reason: "uncertain-submit", fileIds: ["video"] });
  assert.deepEqual(uncertainStore.submitted, ["video"]);
  assert.equal(jobs.length, 1);
});
