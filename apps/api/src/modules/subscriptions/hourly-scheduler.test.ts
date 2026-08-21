import assert from "node:assert/strict";
import test from "node:test";
import { HourlySubscriptionScheduler, HOURLY_SUBSCRIPTION_CRON, HOURLY_SUBSCRIPTION_QUEUE } from "./hourly-scheduler.js";

test("hourly scheduling uses the PRD hourly cron and subscription singleton check jobs", async () => {
  assert.equal(HOURLY_SUBSCRIPTION_QUEUE, "subscription.hourly");
  assert.equal(HOURLY_SUBSCRIPTION_CRON, "0 * * * *");
  const sends: Array<{ name: string; data: object; options: object }> = [];
  const scheduler = new HourlySubscriptionScheduler(
    { async listActiveFollowingIds() { return ["one", "two"]; } },
    { async send(name, data, options) { sends.push({ name, data, options }); return sends.length === 1 ? "job" : null; } }
  );
  assert.deepEqual(await scheduler.enqueueActiveSubscriptions(), { queued: 1, alreadyQueued: 1 });
  assert.deepEqual(sends, [
    { name: "subscription.check", data: { subscriptionId: "one" }, options: { singletonKey: "subscription:one:subscription.check" } },
    { name: "subscription.check", data: { subscriptionId: "two" }, options: { singletonKey: "subscription:two:subscription.check" } }
  ]);
});
