import assert from "node:assert/strict";
import test from "node:test";
import { PostgresPan115CandidateSubmissionStore, type CandidateSubmitPool } from "./pan115-candidate-submit-repository.js";

test("submission repository reads only an active selected 115 candidate and reconstructs its safe share DTO", async () => {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  const pool: CandidateSubmitPool = { async query<Row>(text: string, values?: readonly unknown[]) {
    calls.push({ text, ...(values === undefined ? {} : { values }) });
    return { rows: [{ subscriptionId: "sub", candidateId: "candidate", shareCode: "abc", receiveCode: "pw", mediaType: "series", seasonNumber: 2, targetSeasonCid: "season", missingEpisodeKeys: ["S02E03"], subscriptionStatus: "following", lifecycleStatus: "active", runStatus: "waiting", completionConfirmed: false, totalEpisodes: null }] as Row[] };
  } };
  const store = new PostgresPan115CandidateSubmissionStore(pool, { async recordConfirmedResourceFailure() { return { failureCount: 1, isBlacklisted: false }; } });
  const item = await store.getRunnable("candidate");
  assert.equal(item?.share.url, "https://115.com/s/abc");
  assert.deepEqual(item?.missingEpisodeKeys, ["S02E03"]);
  assert.match(calls[0]!.text, /subscription_status = 'following'/u);
  assert.match(calls[0]!.text, /target_season_cid IS NOT NULL/u);
});

test("submission claim is one atomic CTE guarded by the run idempotency key", async () => {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  const pool: CandidateSubmitPool = { async query<Row>(text: string, values?: readonly unknown[]) { calls.push({ text, ...(values === undefined ? {} : { values }) }); return { rows: [{ id: "candidate" }] as Row[] }; } };
  const store = new PostgresPan115CandidateSubmissionStore(pool, { async recordConfirmedResourceFailure() { return { failureCount: 1, isBlacklisted: false }; } });
  const claimed = await store.claimSubmission({ subscriptionId: "sub", candidateId: "candidate", candidateKey: "share", mediaType: "series", seasonNumber: 1, targetSeasonCid: "season", missingEpisodeKeys: ["S01E01"], state: { mediaType: "series", subscriptionStatus: "following", lifecycleStatus: "active", runStatus: "waiting", missingEpisodeKeys: ["S01E01"], completionConfirmed: false, totalEpisodes: null }, share: { shareCode: "share", url: "https://115.com/s/share" } }, "subscription:sub:candidate:candidate:submit");
  assert.equal(claimed, true);
  assert.match(calls[0]!.text, /ON CONFLICT \(idempotency_key\) DO NOTHING/u);
  assert.match(calls[0]!.text, /run_status = 'backfilling'/u);
  assert.equal(calls.length, 1);
});
