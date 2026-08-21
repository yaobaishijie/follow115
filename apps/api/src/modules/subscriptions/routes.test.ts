import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { SubscriptionAction } from "@follow115/contracts";
import { StateTransitionError, transitionSubscription, type SubscriptionState } from "@follow115/contracts";
import { registerSubscriptionRoutes } from "./routes.js";
import type { CreateSubscriptionInput, SubscriptionRepository } from "./repository.js";
import type { PgBossJobClient, PgBossSendOptions } from "./scheduler.js";

const item = {
  id: "sub-1", seriesId: "series-1", title: "Example", seasonNumber: 1,
  subscriptionStatus: "following" as const, lifecycleStatus: "active" as const, runStatus: "waiting" as const,
  resolvedLatestEpisode: 0, missingEpisodeKeys: [], targetQuality: "1080p" as const,
  targetSeasonPath: "/影视库/电视剧/Example/Season 01", lastCheckedAt: null, consecutiveFailRounds: 0
};

class FakeRepository implements SubscriptionRepository {
  readonly creates: CreateSubscriptionInput[] = [];
  readonly transitions: Array<{ id: string; action: SubscriptionAction }> = [];
  upgradeId: string | null = null;
  async create(input: CreateSubscriptionInput) { this.creates.push(input); return item; }
  async transition(id: string, action: SubscriptionAction) { this.transitions.push({ id, action }); return { ...item, id, runStatus: action === "beginCheck" ? "checking" as const : "waiting" as const }; }
  async requestRelease(id: string) { return { subscription: { ...item, id, subscriptionStatus: "paused" as const }, requestId: "release-1", generation: 1 }; }
  async queueQualityUpgrade(id: string) { this.upgradeId = id; return { ...item, id }; }
}
class FakeJobs implements PgBossJobClient {
  readonly sends: Array<{ name: string; data: object; options: PgBossSendOptions }> = [];
  async send(name: string, data: object, options: PgBossSendOptions) { this.sends.push({ name, data, options }); return "job"; }
}
function appWith(repo = new FakeRepository(), jobs = new FakeJobs()) {
  const app = Fastify(); registerSubscriptionRoutes(app, repo, jobs); return { app, repo, jobs };
}

test("follow validates input, persists first, then queues a singleton check", async () => {
  const { app, repo, jobs } = appWith();
  const response = await app.inject({ method: "POST", url: "/api/v1/subscriptions", payload: { mediaMetadataId: "media-1", seasonNumber: 1, targetQuality: "1080p" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(repo.creates, [{ mediaMetadataId: "media-1", seasonNumber: 1, targetQuality: "1080p" }]);
  assert.deepEqual(jobs.sends[0], { name: "subscription.check", data: { subscriptionId: "sub-1" }, options: { singletonKey: "subscription:sub-1:subscription.check" } });
  await app.close();
});

test("check is only queued after the existing state-machine transition", async () => {
  const { app, repo, jobs } = appWith();
  const response = await app.inject({ method: "PATCH", url: "/api/v1/subscriptions/sub-9", payload: { action: "check" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(repo.transitions, [{ id: "sub-9", action: "beginCheck" }]);
  assert.equal(jobs.sends[0]?.name, "subscription.check");
  await app.close();
});

test("manual upgrade queues only the subscription-scoped quality task", async () => {
  const { app, repo, jobs } = appWith();
  const response = await app.inject({ method: "PATCH", url: "/api/v1/subscriptions/sub-9", payload: { action: "upgradeQuality" } });
  assert.equal(response.statusCode, 200);
  assert.equal(repo.upgradeId, "sub-9");
  assert.deepEqual(jobs.sends[0], { name: "quality.upgrade", data: { subscriptionId: "sub-9" }, options: { singletonKey: "subscription:sub-9:quality.upgrade" } });
  await app.close();
});

test("release persists a generation before queueing the destructive cleanup", async () => {
  const { app, jobs } = appWith();
  const response = await app.inject({ method: "PATCH", url: "/api/v1/subscriptions/sub-9", payload: { action: "release" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(jobs.sends[0], {
    name: "cleanup",
    data: { subscriptionId: "sub-9", requestId: "release-1", generation: 1 },
    options: { singletonKey: "subscription:sub-9:cleanup:1", retryLimit: 5, retryDelay: 15 }
  });
  await app.close();
});

test("PRD commands preserve the subscription state-machine guards", () => {
  const following: SubscriptionState = { mediaType: "series", subscriptionStatus: "following", lifecycleStatus: "active", runStatus: "waiting", missingEpisodeKeys: [], completionConfirmed: false, totalEpisodes: null };
  const paused = transitionSubscription(following, "pause");
  assert.equal(paused.subscriptionStatus, "paused");
  assert.equal(transitionSubscription(paused, "resume").subscriptionStatus, "following");
  const stopped = transitionSubscription(following, "stop");
  assert.equal(stopped.subscriptionStatus, "stopped");
  assert.equal(transitionSubscription(stopped, "refollow").subscriptionStatus, "following");
  const releaseRequested = transitionSubscription(following, "release");
  assert.equal(releaseRequested.subscriptionStatus, "paused");
  assert.equal(releaseRequested.runStatus, "waiting");
  assert.equal(transitionSubscription(releaseRequested, "markReleased").runStatus, "released");
  assert.equal(transitionSubscription(following, "beginCheck").runStatus, "checking");
  assert.throws(() => transitionSubscription(paused, "beginCheck"), StateTransitionError);
});
