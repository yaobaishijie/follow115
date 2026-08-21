export const subscriptionStatuses = ["following", "paused", "stopped"] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

export const lifecycleStatuses = ["active", "completed"] as const;
export type LifecycleStatus = (typeof lifecycleStatuses)[number];

export const runStatuses = ["waiting", "checking", "backfilling", "exception", "released"] as const;
export type RunStatus = (typeof runStatuses)[number];

export const mediaTypes = ["series", "movie"] as const;
export type MediaType = (typeof mediaTypes)[number];

export const qualityTiers = ["2160p", "1080p", "unknown"] as const;
export type QualityTier = (typeof qualityTiers)[number];

export const candidateSources = ["pan115", "magnet"] as const;
export type CandidateSource = (typeof candidateSources)[number];

/** PRD 9.8 candidate rejection reasons; rejected candidates never consume an attempt. */
export const candidateRejectionReasons = [
  "missing_candidate_key", "not_115_share", "title_mismatch", "season_mismatch", "episode_missing", "below_1080p"
] as const;
export type CandidateRejectionReason = (typeof candidateRejectionReasons)[number];

/** A PRD-approved 115 share reference. This is an internal worker DTO, not an API response. */
export interface Pan115Share {
  shareCode: string;
  receiveCode?: string;
  url: string;
}

/** Inputs available before an individual resource candidate is normalized. */
export interface ResourceCandidateContext {
  mediaType: MediaType;
  title: string;
  aliases?: readonly string[];
  year?: number;
  seasonNumber?: number;
  missingEpisodes?: readonly number[];
  preferredGroupKey?: string;
}

/** Source-neutral candidate input collected by a resource-discovery adapter. */
export interface ResourceCandidateInput {
  source: CandidateSource;
  title: string;
  shareUrl?: string;
  magnet?: string;
  /** Authoritative episodes from expanded 115 files when available. */
  availableEpisodes?: readonly number[];
  /** Season derived from authoritative 115 parent paths, when available. */
  parsedSeason?: number;
  channelSortOrder?: number;
  groupKey?: string;
}

/** Candidate form consumed by ranking, blacklist, and attempt-budget logic. */
export interface NormalizedResourceCandidate {
  source: CandidateSource;
  candidateKey: string;
  title: string;
  share?: Pan115Share;
  /** Retained only for an eligible magnet candidate; never exposed by public read APIs. */
  magnet?: string;
  quality: QualityTier;
  parsedSeason: number | null;
  episodes: readonly number[];
  isSeasonPackage: boolean;
  coversAllMissing: boolean;
  missingCoverageCount: number;
  channelSortOrder: number;
  preferredGroupMatched: boolean;
  rejectionReason?: CandidateRejectionReason;
}

/** Persisted resource-level failure state. Infrastructure failures must not increment it. */
export interface ResourceFailureRecord {
  failureCount: number;
  isBlacklisted: boolean;
}

export const jobKinds = [
  "subscription.check", "candidate.verify", "quality.upgrade", "cleanup", "metadata.enrich", "channel.check"
] as const;
export type JobKind = (typeof jobKinds)[number];

export interface SubscriptionState {
  mediaType: MediaType;
  subscriptionStatus: SubscriptionStatus;
  lifecycleStatus: LifecycleStatus;
  runStatus: RunStatus;
  missingEpisodeKeys: readonly string[];
  completionConfirmed: boolean;
  totalEpisodes: number | null;
}

export type SubscriptionAction =
  | "pause" | "resume" | "stop" | "refollow" | "release" | "beginCheck" | "beginBackfill"
  | "markReleased" | "markException" | "markWaiting" | "markCompleted" | "invalidateCompletion";

export class StateTransitionError extends Error {
  readonly code = "INVALID_STATE_TRANSITION";
  constructor(message: string) { super(message); this.name = "StateTransitionError"; }
}

export function transitionSubscription(state: SubscriptionState, action: SubscriptionAction): SubscriptionState {
  const next = { ...state, missingEpisodeKeys: [...state.missingEpisodeKeys] };
  switch (action) {
    case "pause":
      if (state.subscriptionStatus !== "following") throw new StateTransitionError("Only following subscriptions can be paused.");
      return { ...next, subscriptionStatus: "paused", runStatus: "waiting" };
    case "resume":
      if (state.subscriptionStatus !== "paused") throw new StateTransitionError("Only paused subscriptions can be resumed.");
      return { ...next, subscriptionStatus: "following", lifecycleStatus: "active", runStatus: "waiting" };
    case "stop":
      if (state.subscriptionStatus === "stopped") throw new StateTransitionError("Subscription is already stopped.");
      return { ...next, subscriptionStatus: "stopped", runStatus: "waiting" };
    case "refollow":
      if (state.subscriptionStatus !== "stopped" && state.lifecycleStatus !== "completed") throw new StateTransitionError("Only stopped or completed subscriptions can be followed again.");
      return { ...next, subscriptionStatus: "following", lifecycleStatus: "active", completionConfirmed: false, runStatus: "waiting" };
    case "release":
      if (state.subscriptionStatus === "stopped") throw new StateTransitionError("Stopped subscriptions cannot be released from the active workflow.");
      return { ...next, subscriptionStatus: "paused", lifecycleStatus: "active", runStatus: "waiting" };
    case "markReleased":
      if (state.subscriptionStatus !== "paused") throw new StateTransitionError("Release can only complete for a paused subscription.");
      return { ...next, lifecycleStatus: "active", runStatus: "released" };
    case "beginCheck":
      if (state.subscriptionStatus !== "following" || state.lifecycleStatus !== "active") throw new StateTransitionError("Only active following subscriptions can be checked.");
      return { ...next, runStatus: "checking" };
    case "beginBackfill":
      if (state.subscriptionStatus !== "following" || state.lifecycleStatus !== "active") throw new StateTransitionError("Only active following subscriptions can backfill.");
      return { ...next, runStatus: "backfilling" };
    case "markException": return { ...next, runStatus: "exception" };
    case "markWaiting": return { ...next, runStatus: "waiting" };
    case "markCompleted":
      if (state.mediaType !== "series" || !state.completionConfirmed || state.totalEpisodes === null || state.missingEpisodeKeys.length > 0) {
        throw new StateTransitionError("Completion requires a confirmed total and no missing episodes.");
      }
      return { ...next, lifecycleStatus: "completed", runStatus: "waiting" };
    case "invalidateCompletion":
      if (!state.completionConfirmed) throw new StateTransitionError("Only a confirmed completion can be invalidated.");
      return { ...next, lifecycleStatus: "active", completionConfirmed: false, runStatus: "waiting" };
  }
}

export function episodeKey(seasonNumber: number, episodeNumber: number): string {
  return `S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
}
