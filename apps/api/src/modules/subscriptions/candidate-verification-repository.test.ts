import assert from "node:assert/strict";
import test from "node:test";
import { PostgresCandidateVerificationStore, type CandidateVerificationPool } from "./candidate-verification-repository.js";

test("verification store restores selected file names and submission-time missing episodes", async () => {
  const calls: string[] = [];
  const pool: CandidateVerificationPool = { async query<Row>(text: string) { calls.push(text); return { rows: [{ subscriptionId: "sub", candidateId: "candidate", candidateKey: "share", source: "pan115", mediaType: "series", seasonNumber: 1, targetSeasonCid: "season", targetSeasonPath: "Show/Season 01", raw: { missingEpisodeKeysAtSubmission: ["S01E01"], submittedFiles: [{ sourceFileId: "f", name: "Show.S01E01.mkv", episodeKeys: ["S01E01"] }] }, missingEpisodeKeys: ["S01E01"], subscriptionStatus: "following", lifecycleStatus: "active", runStatus: "backfilling", completionConfirmed: false, totalEpisodes: null }] as Row[] }; } };
  const store = new PostgresCandidateVerificationStore(pool, { async recordConfirmedResourceFailure() { return { failureCount: 1, isBlacklisted: false }; } });
  const snapshot = await store.get("candidate");
  assert.deepEqual(snapshot?.selectedFiles, [{ sourceFileId: "f", name: "Show.S01E01.mkv", episodeKeys: ["S01E01"] }]);
  assert.deepEqual(snapshot?.missingEpisodeKeysAtSubmission, ["S01E01"]);
  assert.match(calls[0]!, /rc.status = 'submitted'/u);
});
