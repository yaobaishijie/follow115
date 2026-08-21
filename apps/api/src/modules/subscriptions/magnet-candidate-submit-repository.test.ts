import assert from "node:assert/strict";
import test from "node:test";
import { PostgresMagnetCandidateSubmissionStore, type MagnetSubmitPool } from "./magnet-candidate-submit-repository.js";

test("magnet submission repository requires an active candidate with persisted magnet and release fence", async () => {
  const calls: string[] = [];
  const pool: MagnetSubmitPool = { async query<Row>(text: string) { calls.push(text); return { rows: [{ subscriptionId: "sub", candidateId: "candidate", infoHash: "hash", magnet: "magnet:?xt=urn:btih:hash", mediaType: "series", seasonNumber: 1, targetSeasonCid: "cid", missingEpisodeKeys: ["S01E02"], expectedEpisodeKeys: ["S01E02"], subscriptionStatus: "following", lifecycleStatus: "active", runStatus: "waiting", completionConfirmed: false, totalEpisodes: null }] as Row[] }; } };
  const result = await new PostgresMagnetCandidateSubmissionStore(pool).getRunnable("candidate");
  assert.equal(result?.magnet, "magnet:?xt=urn:btih:hash");
  assert.deepEqual(result?.expectedEpisodeKeys, ["S01E02"]);
  assert.match(calls[0]!, /rc\.source = 'magnet'/u);
  assert.match(calls[0]!, /release_requests/u);
});
