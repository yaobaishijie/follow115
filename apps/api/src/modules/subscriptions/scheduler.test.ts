import assert from "node:assert/strict";
import test from "node:test";
import type { SubscriptionState } from "@follow115/contracts";
import {
  MAX_CANDIDATE_ATTEMPTS_PER_RUN,
  candidateAttemptBudget,
  decideCompletion,
  enqueueSubscriptionJob,
  missingEpisodes,
  recordCandidateAttempt,
  resolveLatestEpisode,
  subscriptionJobKey
} from "./scheduler.js";
import type { PgBossJobClient, PgBossSendOptions } from "./scheduler.js";

class FakePgBoss implements PgBossJobClient {
  readonly sends: Array<{ name: string; data: object; options: PgBossSendOptions }> = [];
  nextResult: string | null = "job-1";

  async send(name: string, data: object, options: PgBossSendOptions): Promise<string | null> {
    this.sends.push({ name, data, options });
    return this.nextResult;
  }
}

test("missingEpisodes includes historical gaps and the newest not-yet-present episode", () => {
  assert.deepEqual(
    missingEpisodes(2, 10, ["S02E01", "S02E02", "S02E03", "S02E05", "S02E06", "S02E07"]),
    ["S02E04", "S02E08", "S02E09", "S02E10"]
  );
});

test("latest episode is monotonic and accepts normal advances", () => {
  assert.deepEqual(resolveLatestEpisode({
    lastResolvedLatestEpisode: 20,
    pendingLatestEpisode: null,
    confirmationTolerance: 1,
    observations: [{ source: "telegram:one", latestEpisode: 19 }]
  }), { resolvedLatestEpisode: 20, pendingLatestEpisode: null, acceptedBecause: "no-new-observation" });
  assert.deepEqual(resolveLatestEpisode({
    lastResolvedLatestEpisode: 20,
    pendingLatestEpisode: null,
    confirmationTolerance: 1,
    observations: [{ source: "telegram:one", latestEpisode: 25 }]
  }), { resolvedLatestEpisode: 25, pendingLatestEpisode: null, acceptedBecause: "normal-advance" });
});

test("large latest-episode jumps require independent or next-run confirmation", () => {
  const held = resolveLatestEpisode({
    lastResolvedLatestEpisode: 10,
    pendingLatestEpisode: null,
    confirmationTolerance: 1,
    observations: [{ source: "telegram:one", latestEpisode: 24 }]
  });
  assert.deepEqual(held, { resolvedLatestEpisode: 10, pendingLatestEpisode: 24, acceptedBecause: "held-for-confirmation" });
  assert.equal(resolveLatestEpisode({
    lastResolvedLatestEpisode: 10,
    pendingLatestEpisode: null,
    confirmationTolerance: 1,
    observations: [{ source: "telegram:one", latestEpisode: 24 }, { source: "btbtla", latestEpisode: 23 }]
  }).acceptedBecause, "independent-confirmation");
  assert.deepEqual(resolveLatestEpisode({
    lastResolvedLatestEpisode: 10,
    pendingLatestEpisode: held.pendingLatestEpisode,
    confirmationTolerance: 1,
    observations: [{ source: "telegram:one", latestEpisode: 24 }]
  }), { resolvedLatestEpisode: 24, pendingLatestEpisode: null, acceptedBecause: "next-run-confirmation" });
});

test("the candidate budget is shared across all sources and requires a re-scan with missing episodes", () => {
  assert.equal(MAX_CANDIDATE_ATTEMPTS_PER_RUN, 2);
  assert.deepEqual(candidateAttemptBudget(0, ["S01E04"]), { attemptsUsed: 0, attemptsRemaining: 2, canAttempt: true });
  assert.deepEqual(recordCandidateAttempt(1), { attemptsUsed: 2, attemptsRemaining: 0, canAttempt: false });
  assert.equal(candidateAttemptBudget(1, []).canAttempt, false);
});

test("completion requires the shared state-machine guards and invalidates active or completed seasons on a later episode", () => {
  const ready: SubscriptionState = {
    mediaType: "series", subscriptionStatus: "following", lifecycleStatus: "active", runStatus: "waiting",
    missingEpisodeKeys: [], completionConfirmed: true, totalEpisodes: 8
  };
  const invalidatedBeforeArchival = decideCompletion(ready, 9);
  assert.equal(invalidatedBeforeArchival.action, "invalidateCompletion");
  assert.equal(invalidatedBeforeArchival.nextState.lifecycleStatus, "active");
  assert.equal(invalidatedBeforeArchival.nextState.completionConfirmed, false);
  assert.equal(decideCompletion(ready, 8).action, "markCompleted");
  const completed = decideCompletion(ready, 8).nextState;
  const reopened = decideCompletion(completed, 9);
  assert.equal(reopened.action, "invalidateCompletion");
  assert.equal(reopened.nextState.lifecycleStatus, "active");
  assert.equal(reopened.nextState.completionConfirmed, false);
});

test("pg-boss job keys are deterministic and scoped to one subscription plus job type", () => {
  assert.equal(subscriptionJobKey("sub-123", "subscription.check"), "subscription:sub-123:subscription.check");
  assert.notEqual(subscriptionJobKey("sub-123", "subscription.check"), subscriptionJobKey("sub-123", "candidate.verify"));
  assert.throws(() => subscriptionJobKey(" ", "cleanup"), RangeError);
});

test("subscription work is sent through pg-boss with a singleton key", async () => {
  const jobs = new FakePgBoss();

  const result = await enqueueSubscriptionJob(jobs, {
    subscriptionId: " sub-123 ",
    jobKind: "subscription.check"
  });

  assert.deepEqual(result, {
    jobId: "job-1",
    jobKey: "subscription:sub-123:subscription.check"
  });
  assert.deepEqual(jobs.sends, [{
    name: "subscription.check",
    data: { subscriptionId: "sub-123" },
    options: { singletonKey: "subscription:sub-123:subscription.check" }
  }]);
});

test("candidate verification uses pg-boss's persistent delayed start rather than a timer", async () => {
  const jobs = new FakePgBoss();
  jobs.nextResult = null;
  const verifyAt = new Date("2026-08-21T00:00:00.000Z");

  const result = await enqueueSubscriptionJob(jobs, {
    subscriptionId: "sub-123",
    jobKind: "candidate.verify",
    startAfter: verifyAt
  });

  assert.deepEqual(result, {
    jobId: null,
    jobKey: "subscription:sub-123:candidate.verify"
  });
  assert.equal(jobs.sends.length, 1);
  assert.deepEqual(jobs.sends[0], {
    name: "candidate.verify",
    data: { subscriptionId: "sub-123" },
    options: { singletonKey: "subscription:sub-123:candidate.verify", startAfter: verifyAt }
  });
});
