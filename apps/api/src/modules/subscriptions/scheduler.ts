import {
  episodeKey,
  transitionSubscription,
  type JobKind,
  type SubscriptionAction,
  type SubscriptionState
} from "@follow115/contracts";

/** The PRD's cross-source, per-round execution limit. */
export const MAX_CANDIDATE_ATTEMPTS_PER_RUN = 2;
export const LATEST_EPISODE_JUMP_CONFIRMATION_THRESHOLD = 10;

export interface LatestEpisodeObservation {
  /** A stable source identity, for example `telegram:channel-id` or `btbtla`. */
  source: string;
  latestEpisode: number;
}

export interface LatestEpisodeInput {
  lastResolvedLatestEpisode: number;
  pendingLatestEpisode: number | null;
  observations: readonly LatestEpisodeObservation[];
  /**
   * PRD calls for confirmation by a "same/near" independent observation but
   * does not define a numerical range.  The caller must choose that policy.
   */
  confirmationTolerance: number;
}

export interface LatestEpisodeResolution {
  resolvedLatestEpisode: number;
  pendingLatestEpisode: number | null;
  acceptedBecause: "no-new-observation" | "normal-advance" | "independent-confirmation" | "next-run-confirmation" | "held-for-confirmation";
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!isNonNegativeInteger(value)) throw new RangeError(`${field} must be a non-negative integer.`);
}

/**
 * Advances the latest episode monotonically.  A jump of more than ten
 * episodes is persisted as pending until it has independent or next-run
 * confirmation; it never enlarges the backfill range prematurely.
 */
export function resolveLatestEpisode(input: LatestEpisodeInput): LatestEpisodeResolution {
  const { lastResolvedLatestEpisode: lastResolved, pendingLatestEpisode: pending, observations, confirmationTolerance } = input;
  assertNonNegativeInteger(lastResolved, "lastResolvedLatestEpisode");
  if (pending !== null) assertNonNegativeInteger(pending, "pendingLatestEpisode");
  assertNonNegativeInteger(confirmationTolerance, "confirmationTolerance");

  const validObservations = observations.filter(({ source, latestEpisode }) => source.trim().length > 0 && isNonNegativeInteger(latestEpisode));
  const observedLatest = validObservations.reduce<number | null>(
    (highest, observation) => highest === null || observation.latestEpisode > highest ? observation.latestEpisode : highest,
    null
  );
  if (observedLatest === null || observedLatest <= lastResolved) {
    return { resolvedLatestEpisode: lastResolved, pendingLatestEpisode: pending, acceptedBecause: "no-new-observation" };
  }

  if (observedLatest - lastResolved <= LATEST_EPISODE_JUMP_CONFIRMATION_THRESHOLD) {
    return { resolvedLatestEpisode: observedLatest, pendingLatestEpisode: null, acceptedBecause: "normal-advance" };
  }

  const independentlyConfirmed = new Set(
    validObservations
      .filter(({ latestEpisode }) => Math.abs(latestEpisode - observedLatest) <= confirmationTolerance)
      .map(({ source }) => source)
  ).size >= 2;
  if (independentlyConfirmed) {
    return { resolvedLatestEpisode: observedLatest, pendingLatestEpisode: null, acceptedBecause: "independent-confirmation" };
  }

  if (pending !== null && Math.abs(observedLatest - pending) <= confirmationTolerance) {
    return {
      resolvedLatestEpisode: Math.max(observedLatest, pending),
      pendingLatestEpisode: null,
      acceptedBecause: "next-run-confirmation"
    };
  }

  return {
    resolvedLatestEpisode: lastResolved,
    pendingLatestEpisode: Math.max(pending ?? 0, observedLatest),
    acceptedBecause: "held-for-confirmation"
  };
}

/** Returns the PRD-defined target range minus episodes physically present in the Season directory. */
export function missingEpisodes(
  seasonNumber: number,
  resolvedLatestEpisode: number,
  existingEpisodeKeys: readonly string[]
): string[] {
  assertNonNegativeInteger(seasonNumber, "seasonNumber");
  assertNonNegativeInteger(resolvedLatestEpisode, "resolvedLatestEpisode");
  const existing = new Set(existingEpisodeKeys);
  const missing: string[] = [];
  for (let episodeNumber = 1; episodeNumber <= resolvedLatestEpisode; episodeNumber += 1) {
    const key = episodeKey(seasonNumber, episodeNumber);
    if (!existing.has(key)) missing.push(key);
  }
  return missing;
}

export interface CandidateAttemptBudget {
  attemptsUsed: number;
  attemptsRemaining: number;
  canAttempt: boolean;
}

/**
 * Calculates the shared Telegram/direct-save and magnet execution budget.
 * Call this only after a candidate has passed filtering: invalid search
 * results do not consume the two real execution attempts.
 */
export function candidateAttemptBudget(attemptsUsed: number, missingEpisodeKeys: readonly string[]): CandidateAttemptBudget {
  assertNonNegativeInteger(attemptsUsed, "attemptsUsed");
  const attemptsRemaining = Math.max(0, MAX_CANDIDATE_ATTEMPTS_PER_RUN - attemptsUsed);
  return { attemptsUsed, attemptsRemaining, canAttempt: missingEpisodeKeys.length > 0 && attemptsRemaining > 0 };
}

export function recordCandidateAttempt(attemptsUsed: number): CandidateAttemptBudget {
  return candidateAttemptBudget(attemptsUsed + 1, ["still-missing"]);
}

export type CompletionDecision =
  | { action: "markCompleted"; nextState: SubscriptionState }
  | { action: "invalidateCompletion"; nextState: SubscriptionState }
  | { action: null; nextState: SubscriptionState };

/**
 * Applies only actions from the shared contracts state machine.  The caller
 * supplies the already-resolved latest episode because that field is stored
 * on Subscription rather than the minimal shared SubscriptionState contract.
 */
export function decideCompletion(
  state: SubscriptionState,
  resolvedLatestEpisode: number
): CompletionDecision {
  assertNonNegativeInteger(resolvedLatestEpisode, "resolvedLatestEpisode");
  if (state.completionConfirmed && state.totalEpisodes !== null && resolvedLatestEpisode > state.totalEpisodes) {
    return { action: "invalidateCompletion", nextState: transitionSubscription(state, "invalidateCompletion") };
  }
  if (
    state.mediaType === "series" &&
    state.lifecycleStatus === "active" &&
    state.completionConfirmed &&
    state.totalEpisodes !== null &&
    state.missingEpisodeKeys.length === 0
  ) {
    return { action: "markCompleted", nextState: transitionSubscription(state, "markCompleted") };
  }
  return { action: null, nextState: state };
}

/**
 * A stable singleton key prevents two jobs of the same kind from operating
 * on the same Subscription concurrently, including after pg-boss recovery.
 */
export function subscriptionJobKey(subscriptionId: string, jobKind: JobKind): string {
  const normalizedId = subscriptionId.trim();
  if (!normalizedId) throw new RangeError("subscriptionId must not be empty.");
  return `subscription:${normalizedId}:${jobKind}`;
}

/** Narrows scheduled job actions to the shared contracts action union. */
export function isSchedulableAction(action: SubscriptionAction): boolean {
  return action === "beginCheck" || action === "beginBackfill";
}

/**
 * The small portion of pg-boss used by this module. Keeping this port narrow
 * makes enqueueing unit-testable without constructing a boss instance (which
 * would otherwise create schemas and connect to PostgreSQL).
 */
export interface PgBossJobClient {
  send(name: string, data: object, options: PgBossSendOptions): Promise<string | null>;
}

export interface PgBossSendOptions {
  singletonKey: string;
  startAfter?: Date;
  retryLimit?: number;
  retryDelay?: number;
}

export interface SubscriptionJobData {
  subscriptionId: string;
}

export interface SubscriptionJobRequest {
  subscriptionId: string;
  jobKind: JobKind;
  /** Persist the task until this time instead of waiting in a worker. */
  startAfter?: Date;
}

export interface SubscriptionJobEnqueueResult {
  /** `null` means pg-boss already has the equivalent singleton task. */
  jobId: string | null;
  jobKey: string;
}

/**
 * Enqueues a subscription-scoped pg-boss job with a deterministic singleton
 * key. pg-boss persists `startAfter`, so delayed candidate verification never
 * relies on a process-local timer or sleep.
 */
export async function enqueueSubscriptionJob(
  jobs: PgBossJobClient,
  request: SubscriptionJobRequest
): Promise<SubscriptionJobEnqueueResult> {
  const subscriptionId = request.subscriptionId.trim();
  const jobKey = subscriptionJobKey(subscriptionId, request.jobKind);
  const options: PgBossSendOptions = { singletonKey: jobKey };
  if (request.startAfter !== undefined) options.startAfter = request.startAfter;

  const jobId = await jobs.send(request.jobKind, { subscriptionId } satisfies SubscriptionJobData, options);
  return { jobId, jobKey };
}
