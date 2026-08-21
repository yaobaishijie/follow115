import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";
import { PostgresResourceCandidateRepository, PostgresResourceFailureRepository, type ResourceQueryPool } from "./resource-repositories.js";

test("resource failures only expose a confirmed-resource upsert and permanently blacklist the second failure", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  const pool: ResourceQueryPool = { async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
    calls.push({ text, values });
    return { rows: [{ failureCount: calls.length === 1 ? 1 : 2, isBlacklisted: calls.length !== 1 }] as unknown as Row[] };
  } };
  const repository = new PostgresResourceFailureRepository(pool);
  assert.deepEqual(await repository.recordConfirmedResourceFailure("pan115", "share-code", "share expired"), { failureCount: 1, isBlacklisted: false });
  assert.deepEqual(await repository.recordConfirmedResourceFailure("pan115", "share-code", "share expired again"), { failureCount: 2, isBlacklisted: true });
  assert.match(calls[0]!.text, /ON CONFLICT/u);
  assert.match(calls[0]!.text, /failure_count \+ 1 >= 2/u);
  assert.deepEqual(calls[1]!.values, ["pan115", "share-code", "share expired again"]);
});

test("discovered candidates persist only normalized source keys and do not execute them", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  const pool: ResourceQueryPool = { async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) { calls.push({ text, values }); return { rows: [{ id: "candidate-id" }] as unknown as Row[] }; } };
  const repository = new PostgresResourceCandidateRepository(pool);
  assert.equal(await repository.recordDiscovered("00000000-0000-0000-0000-000000000001", {
    source: "pan115", candidateKey: "share", title: "Show S01E01 2160p", share: { shareCode: "share", url: "https://115.com/s/share" },
    quality: "2160p", parsedSeason: 1, episodes: [1], isSeasonPackage: false, coversAllMissing: true,
    missingCoverageCount: 1, channelSortOrder: 0, preferredGroupMatched: false
  }, { id: "round", rank: 0 }), "candidate-id");
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.text, /'expanded'::candidate_status/u);
  assert.deepEqual(calls[0]!.values?.slice(1, 7), ["pan115", "share", "share", null, null, "Show S01E01 2160p"]);
  assert.match(String(calls[0]!.values?.at(-1)), /"checkRoundId":"round"/u);
});
