import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateRejectionReasons,
  candidateSources,
  qualityTiers,
  StateTransitionError,
  episodeKey,
  transitionSubscription,
  type NormalizedResourceCandidate,
  type ResourceCandidateContext,
  type SubscriptionState
} from "./domain.js";

const active: SubscriptionState = { mediaType: "series", subscriptionStatus: "following", lifecycleStatus: "active", runStatus: "waiting", missingEpisodeKeys: [], completionConfirmed: true, totalEpisodes: 8 };
test("subscription lifecycle preserves user and lifecycle state separation", () => {
  assert.equal(transitionSubscription(active, "pause").subscriptionStatus, "paused");
  assert.equal(transitionSubscription({ ...active, subscriptionStatus: "paused" }, "resume").subscriptionStatus, "following");
  assert.equal(transitionSubscription(active, "markCompleted").lifecycleStatus, "completed");
});
test("completion requires reliable completion signal and zero missing episodes", () => {
  assert.throws(() => transitionSubscription({ ...active, missingEpisodeKeys: ["S01E07"] }, "markCompleted"), StateTransitionError);
  assert.equal(episodeKey(2, 1), "S02E01");
});
test("a later reliable episode can invalidate completion before or after archival", () => {
  assert.equal(transitionSubscription(active, "invalidateCompletion").completionConfirmed, false);
  assert.equal(transitionSubscription({ ...active, lifecycleStatus: "completed" }, "invalidateCompletion").lifecycleStatus, "active");
});

test("completed history entries can be followed again and clear stale completion confirmation", () => {
  const completed = { mediaType: "series", subscriptionStatus: "following", lifecycleStatus: "completed", runStatus: "waiting", missingEpisodeKeys: [], completionConfirmed: true, totalEpisodes: 12 } as const;
  const reopened = transitionSubscription(completed, "refollow");
  assert.equal(reopened.lifecycleStatus, "active");
  assert.equal(reopened.subscriptionStatus, "following");
  assert.equal(reopened.completionConfirmed, false);
});
test("resource candidate DTO preserves PRD sources, tiers, and ranking fields", () => {
  const context: ResourceCandidateContext = { mediaType: "series", title: "Show", seasonNumber: 1, missingEpisodes: [4, 5] };
  const candidate: NormalizedResourceCandidate = {
    source: "pan115", candidateKey: "share-code", title: "Show S01E04-E05", quality: "1080p", parsedSeason: 1,
    episodes: [4, 5], isSeasonPackage: false, coversAllMissing: true, missingCoverageCount: 2,
    channelSortOrder: 0, preferredGroupMatched: false
  };
  assert.equal(context.mediaType, "series");
  assert.equal(candidate.coversAllMissing, true);
  assert.deepEqual(candidateSources, ["pan115", "magnet"]);
  assert.deepEqual(qualityTiers, ["2160p", "1080p", "unknown"]);
  assert.deepEqual(candidateRejectionReasons, ["missing_candidate_key", "not_115_share", "title_mismatch", "season_mismatch", "episode_missing", "below_1080p"]);
});
