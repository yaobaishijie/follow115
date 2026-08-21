import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";
import { PostgresSearchChannelRepository, type SearchChannelQueryPool } from "./repositories.js";

test("Postgres repository lists by explicit sort order and uses a collision-safe reorder statement", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  const pool: SearchChannelQueryPool = { async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) {
    calls.push({ text, values });
    return { rows: (text.includes("SELECT id::text") ? [{ id: "a", name: "A", channelId: "a", isEnabled: true, sortOrder: 2, lastCheckStatus: "ok" as const, lastCheckedAt: null, lastCheckMessage: null }] : []) as unknown as Row[], rowCount: 1 };
  } };
  const repository = new PostgresSearchChannelRepository(pool);
  const channels = await repository.list();
  assert.equal(channels[0]!.lastCheckStatus, "ok");
  await repository.replaceOrder(["b", "a"]);
  assert.match(calls[0]!.text, /ORDER BY sort_order ASC/);
  assert.match(calls[1]!.text, /parked AS/);
  assert.deepEqual(calls[1]!.values, [["b", "a"]]);
});
