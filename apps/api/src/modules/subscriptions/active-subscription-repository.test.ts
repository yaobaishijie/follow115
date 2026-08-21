import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";
import { PostgresActiveSubscriptionRepository, type ActiveSubscriptionQueryPool } from "./active-subscription-repository.js";

test("hourly source selects only active following subscriptions", async () => {
  let text = "";
  const pool: ActiveSubscriptionQueryPool = { async query<Row extends QueryResultRow>(input: string) { text = input; return { rows: [{ id: "sub-1" }] as unknown as Row[] }; } };
  assert.deepEqual(await new PostgresActiveSubscriptionRepository(pool).listActiveFollowingIds(), ["sub-1"]);
  assert.match(text, /subscription_status = 'following'/u);
  assert.match(text, /lifecycle_status = 'active'/u);
});
