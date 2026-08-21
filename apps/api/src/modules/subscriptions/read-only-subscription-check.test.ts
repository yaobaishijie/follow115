import assert from "node:assert/strict";
import test from "node:test";
import type { ResourceCandidateInput, SubscriptionState } from "@follow115/contracts";
import { ReadOnlySubscriptionCheckWorker, type ReadOnlySubscriptionSnapshot } from "./read-only-subscription-check.js";

const state: SubscriptionState = { mediaType: "series", subscriptionStatus: "following", lifecycleStatus: "active", runStatus: "checking", missingEpisodeKeys: [], completionConfirmed: false, totalEpisodes: null };
const snapshot: ReadOnlySubscriptionSnapshot = { id: "sub", title: "示例剧", aliases: [], year: 2026, mediaType: "series", seasonNumber: 1, preferredGroupKey: null, state, resolvedLatestEpisode: 3, pendingLatestEpisode: null, lastBtbtlaCalibratedAt: null };

test("read-only check scans, expands, ranks and records candidates without any execution port", async () => {
  const finished: unknown[] = [];
  const recorded: string[] = [];
  const worker = new ReadOnlySubscriptionCheckWorker(
    {
      async get() { return snapshot; },
      async finishRound(input) { finished.push(input); },
      async recordCandidate(_id, candidate, round) { recorded.push(`${candidate.candidateKey}:${round.rank}`); return `candidate-${round.rank}`; }
    },
    { async listExistingEpisodeKeys() { return ["S01E01", "S01E03"]; } },
    { async discover() { return [{ shareUrl: "https://115.com/s/share", shareCode: "share", messageId: "1", messageText: "示例剧", channelId: "primary", channelSortOrder: 0 }]; } },
    { async build(): Promise<ResourceCandidateInput> { return { source: "pan115", title: "示例剧 S01E02-E04 2160p", shareUrl: "https://115.com/s/share", availableEpisodes: [2, 3, 4], parsedSeason: 1, channelSortOrder: 0 }; } },
    { async find() { return null; } },
    () => "round"
  );

  const result = await worker.run("sub");
  assert.equal(result.kind, "checked");
  assert.deepEqual(result.missingEpisodeKeys, ["S01E02", "S01E04"]);
  assert.equal(result.resolvedLatestEpisode, 4);
  assert.deepEqual(recorded, ["share:0"]);
  assert.deepEqual(result.candidateIds, ["candidate-0"]);
  assert.deepEqual(finished, [{ subscriptionId: "sub", existingEpisodeKeys: ["S01E01", "S01E03"], resolvedLatestEpisode: 4, pendingLatestEpisode: null, missingEpisodeKeys: ["S01E02", "S01E04"] }]);
});

test("read-only check does not read external sources for inactive subscriptions", async () => {
  let scanned = false;
  const worker = new ReadOnlySubscriptionCheckWorker(
    { async get() { return { ...snapshot, state: { ...state, subscriptionStatus: "paused" as const } }; }, async finishRound() { throw new Error("must not finish"); }, async recordCandidate() { throw new Error("must not record"); } },
    { async listExistingEpisodeKeys() { scanned = true; return []; } },
    { async discover() { throw new Error("must not discover"); } },
    { async build() { throw new Error("must not build"); } },
    { async find() { throw new Error("must not query failures"); } }
  );
  assert.deepEqual(await worker.run("sub"), { kind: "skipped", reason: "not-active" });
  assert.equal(scanned, false);
});

test("due btbtla calibration merges fallback candidates and advances the shared latest episode", async () => {
  const finished: Array<{ btbtlaCalibratedAt?: Date; resolvedLatestEpisode: number; missingEpisodeKeys: readonly string[] }> = [];
  const recorded: string[] = [];
  const now = new Date("2026-08-21T00:00:00.000Z");
  const worker = new ReadOnlySubscriptionCheckWorker(
    {
      async get() { return { ...snapshot, resolvedLatestEpisode: 3, lastBtbtlaCalibratedAt: new Date(now.getTime() - 12 * 60 * 60 * 1000) }; },
      async finishRound(input) { finished.push(input); },
      async recordCandidate(_id, candidate, round) { recorded.push(`${candidate.source}:${candidate.candidateKey}:${round.rank}`); return `candidate-${round.rank}`; }
    },
    { async listExistingEpisodeKeys() { return ["S01E01", "S01E03"]; } },
    { async discover() { return [{ shareUrl: "https://115.com/s/partial", shareCode: "partial", messageId: "1", messageText: "示例剧", channelId: "primary", channelSortOrder: 0 }]; } },
    { async build(): Promise<ResourceCandidateInput> { return { source: "pan115", title: "示例剧 S01E04 2160p", shareUrl: "https://115.com/s/partial", availableEpisodes: [4], parsedSeason: 1, channelSortOrder: 0 }; } },
    { async find() { return null; } },
    () => "round",
    { async discover() { return [{ source: "magnet", title: "示例剧 S01E04-E06 1080p", magnet: "ABCDEF0123456789ABCDEF0123456789ABCDEF01", availableEpisodes: [4, 5, 6], parsedSeason: 1 }]; } },
    () => now
  );
  const result = await worker.run("sub");
  assert.equal(result.resolvedLatestEpisode, 6);
  assert.deepEqual(result.missingEpisodeKeys, ["S01E02", "S01E04", "S01E05", "S01E06"]);
  assert.deepEqual(recorded, ["magnet:abcdef0123456789abcdef0123456789abcdef01:0", "pan115:partial:1"]);
  assert.equal(finished[0]?.btbtlaCalibratedAt?.toISOString(), now.toISOString());
});

test("btbtla failures retain Telegram results and never mark a successful calibration", async () => {
  const finished: Array<{ btbtlaCalibratedAt?: Date }> = [];
  let calls = 0;
  const worker = new ReadOnlySubscriptionCheckWorker(
    {
      async get() { return snapshot; }, async finishRound(input) { finished.push(input); }, async recordCandidate() { return "candidate"; }
    },
    { async listExistingEpisodeKeys() { return ["S01E01", "S01E03"]; } },
    { async discover() { return [{ shareUrl: "https://115.com/s/share", shareCode: "share", messageId: "1", messageText: "示例剧", channelId: "primary", channelSortOrder: 0 }]; } },
    { async build(): Promise<ResourceCandidateInput> { return { source: "pan115", title: "示例剧 S01E02-E04 2160p", shareUrl: "https://115.com/s/share", availableEpisodes: [2, 3, 4], parsedSeason: 1 }; } },
    { async find() { return null; } },
    () => "round",
    { async discover() { calls += 1; throw new Error("transient"); } },
    () => new Date("2026-08-21T00:00:00.000Z")
  );
  assert.equal((await worker.run("sub")).kind, "checked");
  assert.equal(calls, 1);
  assert.equal(finished[0]?.btbtlaCalibratedAt, undefined);
});
