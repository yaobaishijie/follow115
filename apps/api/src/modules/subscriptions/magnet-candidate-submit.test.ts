import assert from "node:assert/strict";
import test from "node:test";
import { MagnetCandidateSubmitWorker, type MagnetCandidateSubmission, type MagnetCandidateSubmissionStore } from "./magnet-candidate-submit.js";
const input: MagnetCandidateSubmission = { subscriptionId: "sub", candidateId: "candidate", infoHash: "abc", magnet: "magnet:?xt=urn:btih:abc", mediaType: "series", seasonNumber: 1, targetSeasonCid: "cid", missingEpisodeKeys: ["S01E02"], expectedEpisodeKeys: ["S01E02"], state: { mediaType: "series", subscriptionStatus: "following", lifecycleStatus: "active", runStatus: "waiting", missingEpisodeKeys: ["S01E02"], completionConfirmed: false, totalEpisodes: null } };
class Store implements MagnetCandidateSubmissionStore { submitted: unknown[] = []; async getRunnable() { return input; } async claimSubmission() { return true; } async markSubmitted(...args: unknown[]) { this.submitted = args; } }
test("magnet submission is claimed once and verified later instead of being treated as completed", async () => {
  const store = new Store(); const queued: Date[] = [];
  const worker = new MagnetCandidateSubmitWorker(store, { async submitMagnet() { return { taskId: "task", raw: {} }; } }, { async enqueue(value) { queued.push(value.startAfter); } }, 60_000, () => 1_000);
  assert.deepEqual(await worker.run("candidate"), { kind: "submitted" });
  assert.equal(store.submitted[2], "task"); assert.equal(queued[0]?.getTime(), 61_000);
});
test("uncertain offline transport is never blindly resubmitted and still enters verification", async () => {
  const store = new Store(); let queued = 0;
  const worker = new MagnetCandidateSubmitWorker(store, { async submitMagnet() { throw new Error("timeout"); } }, { async enqueue() { queued += 1; } }, 0);
  assert.deepEqual(await worker.run("candidate"), { kind: "verification-pending", reason: "uncertain-submit" });
  assert.equal(store.submitted[3], true); assert.equal(queued, 1);
});
