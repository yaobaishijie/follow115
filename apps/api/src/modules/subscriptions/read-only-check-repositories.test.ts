import assert from "node:assert/strict";
import test from "node:test";
import { PostgresReadOnlySubscriptionCheckStore, type ReadOnlyCheckPool } from "./read-only-check-repositories.js";

test("read-only check store persists the successful btbtla calibration timestamp only when supplied", async () => {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  const calibratedAt = new Date("2026-08-21T00:00:00.000Z");
  const pool: ReadOnlyCheckPool = {
    async query<Row>(text: string, values?: readonly unknown[]) {
      calls.push({ text, ...(values === undefined ? {} : { values }) });
      return { rows: [] as Row[] };
    }
  };
  const store = new PostgresReadOnlySubscriptionCheckStore(pool, { async recordDiscovered() { return "candidate"; } });
  await store.finishRound({ subscriptionId: "sub", existingEpisodeKeys: ["S01E01"], resolvedLatestEpisode: 1, pendingLatestEpisode: null, missingEpisodeKeys: [], btbtlaCalibratedAt: calibratedAt });
  assert.match(calls[0]!.text, /last_btbtla_calibrated_at = COALESCE/u);
  assert.deepEqual(calls[0]!.values?.at(-1), calibratedAt);
  await store.finishRound({ subscriptionId: "sub", existingEpisodeKeys: [], resolvedLatestEpisode: 1, pendingLatestEpisode: null, missingEpisodeKeys: [] });
  assert.equal(calls[1]!.values?.at(-1), undefined);
});
