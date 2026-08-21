import type {
  MediaType,
  NormalizedResourceCandidate,
  ResourceCandidateContext,
  ResourceCandidateInput,
  ResourceFailureRecord,
  SubscriptionState
} from "@follow115/contracts";
import { randomUUID } from "node:crypto";
import { isPermanentlyBlacklisted, normalizeResourceCandidate, sortEligibleResourceCandidates } from "../resources/resource-candidates.js";
import type { DiscoveredTelegramShare } from "../resources/telegram-share-discovery.js";
import { missingEpisodes, resolveLatestEpisode } from "./scheduler.js";

/**
 * A deliberately read-only slice of PRD §9.2.  It scans the Season through
 * an injected reader, searches public Telegram previews, expands 115 shares,
 * ranks candidates and records them.  There is intentionally no save, mkdir,
 * move, delete, or offline-task port in this module.
 */
export interface ReadOnlySubscriptionSnapshot {
  id: string;
  title: string;
  aliases: readonly string[];
  year: number | null;
  mediaType: MediaType;
  seasonNumber: number;
  preferredGroupKey: string | null;
  state: SubscriptionState;
  resolvedLatestEpisode: number;
  pendingLatestEpisode: number | null;
  lastBtbtlaCalibratedAt: Date | null;
  targetSeasonCid?: string | null;
  targetSeasonPath?: string | null;
}

export interface ReadOnlySubscriptionCheckStore {
  get(id: string): Promise<ReadOnlySubscriptionSnapshot | null>;
  finishRound(input: {
    subscriptionId: string;
    existingEpisodeKeys: readonly string[];
    resolvedLatestEpisode: number;
    pendingLatestEpisode: number | null;
    missingEpisodeKeys: readonly string[];
    /** Written only after a successful btbtla discovery, including a successful zero-result calibration. */
    btbtlaCalibratedAt?: Date;
  }): Promise<void>;
  recordCandidate(subscriptionId: string, candidate: NormalizedResourceCandidate, round: { id: string; rank: number }): Promise<string>;
}

export interface SeasonEpisodeReader {
  /** Reads only the target Season directory; it must never mutate 115 state. */
  listExistingEpisodeKeys(snapshot: ReadOnlySubscriptionSnapshot): Promise<readonly string[]>;
}

export interface TelegramShareDiscoverer {
  discover(context: Pick<ResourceCandidateContext, "title">): Promise<readonly DiscoveredTelegramShare[]>;
}

export interface ExpandedShareCandidateBuilder {
  build(
    share: { share: { shareCode: string; receiveCode?: string; url: string }; messageText: string; channelSortOrder: number },
    context: Pick<ResourceCandidateContext, "mediaType" | "seasonNumber">
  ): Promise<ResourceCandidateInput | null>;
}

export interface ResourceFailureReader {
  find(source: ResourceCandidateInput["source"], candidateKey: string): Promise<ResourceFailureRecord | null>;
}

/** Injected read-only source. Its implementation owns btbtla traversal and never submits an offline task. */
export interface BtbtlaDiscoverer {
  discover(context: ResourceCandidateContext): Promise<readonly ResourceCandidateInput[]>;
}

export interface ReadOnlySubscriptionCheckResult {
  kind: "skipped" | "checked";
  reason?: "not-found" | "not-active";
  existingEpisodeKeys?: readonly string[];
  resolvedLatestEpisode?: number;
  pendingLatestEpisode?: number | null;
  missingEpisodeKeys?: readonly string[];
  candidates?: readonly NormalizedResourceCandidate[];
  candidateIds?: readonly string[];
}

/** The PRD says “same/near” without a number; one episode is the explicit, narrow policy. */
export const LATEST_EPISODE_CONFIRMATION_TOLERANCE = 1;
export const BTBTLA_CALIBRATION_INTERVAL_MS = 12 * 60 * 60 * 1000;

export class ReadOnlySubscriptionCheckWorker {
  constructor(
    private readonly store: ReadOnlySubscriptionCheckStore,
    private readonly seasonReader: SeasonEpisodeReader,
    private readonly telegram: TelegramShareDiscoverer,
    private readonly shareBuilder: ExpandedShareCandidateBuilder,
    private readonly failures: ResourceFailureReader,
    private readonly newRoundId: () => string = randomUUID,
    private readonly btbtla?: BtbtlaDiscoverer,
    private readonly now: () => Date = () => new Date()
  ) {}

  async run(subscriptionId: string): Promise<ReadOnlySubscriptionCheckResult> {
    const snapshot = await this.store.get(subscriptionId);
    if (snapshot === null) return { kind: "skipped", reason: "not-found" };
    if (snapshot.state.subscriptionStatus !== "following" || snapshot.state.lifecycleStatus !== "active") {
      return { kind: "skipped", reason: "not-active" };
    }

    const existingEpisodeKeys = await this.seasonReader.listExistingEpisodeKeys(snapshot);
    const baseContext: ResourceCandidateContext = {
      mediaType: snapshot.mediaType,
      title: snapshot.title,
      aliases: snapshot.aliases,
      ...(snapshot.year === null ? {} : { year: snapshot.year }),
      ...(snapshot.mediaType === "series" ? { seasonNumber: snapshot.seasonNumber } : {}),
      ...(snapshot.preferredGroupKey === null ? {} : { preferredGroupKey: snapshot.preferredGroupKey })
    };
    const discovered = await this.telegram.discover({ title: snapshot.title });
    const built = (await Promise.all(discovered.map(async (item) => {
      const input = await this.shareBuilder.build({
      share: { shareCode: item.shareCode, ...(item.receiveCode ? { receiveCode: item.receiveCode } : {}), url: item.shareUrl },
      messageText: item.messageText,
      channelSortOrder: item.channelSortOrder
      }, baseContext).catch(() => null);
      return input === null ? null : { input, channelId: item.channelId };
    }))).filter((item): item is { input: ResourceCandidateInput; channelId: string } => item !== null);
    const telegramInputs = built.map(({ input }) => input);
    const telegramResolution = resolveLatestEpisode({
      lastResolvedLatestEpisode: snapshot.resolvedLatestEpisode,
      pendingLatestEpisode: snapshot.pendingLatestEpisode,
      observations: telegramObservations(built),
      confirmationTolerance: LATEST_EPISODE_CONFIRMATION_TOLERANCE
    });
    const telegramMissing = snapshot.mediaType === "movie" ? [] : missingEpisodes(snapshot.seasonNumber, telegramResolution.resolvedLatestEpisode, existingEpisodeKeys);
    const telegramContext = withMissingEpisodes(baseContext, snapshot.mediaType, telegramMissing);
    const telegramCandidates = sortEligibleResourceCandidates(await eligibleCandidates(telegramInputs, telegramContext, this.failures));
    const shouldSearchBtbtla = this.btbtla !== undefined && shouldDiscoverBtbtla({
      lastBtbtlaCalibratedAt: snapshot.lastBtbtlaCalibratedAt,
      now: this.now(),
      telegramCandidates,
      telegramMissingEpisodeKeys: telegramMissing,
      telegramObservations: telegramObservations(built)
    });
    let btbtlaInputs: readonly ResourceCandidateInput[] = [];
    let btbtlaCalibratedAt: Date | undefined;
    if (shouldSearchBtbtla) {
      try {
        btbtlaInputs = await this.btbtla!.discover(telegramContext);
        btbtlaCalibratedAt = this.now();
      } catch {
        // An unavailable search source must not discard the Telegram result or
        // advance the successful-calibration timestamp.
      }
    }
    const resolution = resolveLatestEpisode({
      lastResolvedLatestEpisode: snapshot.resolvedLatestEpisode,
      pendingLatestEpisode: snapshot.pendingLatestEpisode,
      observations: [...telegramObservations(built), ...btbtlaObservations(btbtlaInputs)],
      confirmationTolerance: LATEST_EPISODE_CONFIRMATION_TOLERANCE
    });
    const missingEpisodeKeys = snapshot.mediaType === "movie" ? [] : missingEpisodes(snapshot.seasonNumber, resolution.resolvedLatestEpisode, existingEpisodeKeys);
    const context = withMissingEpisodes(baseContext, snapshot.mediaType, missingEpisodeKeys);
    const candidates = sortEligibleResourceCandidates(await eligibleCandidates([...telegramInputs, ...btbtlaInputs], context, this.failures));
    const roundId = this.newRoundId();
    const candidateIds = await Promise.all(candidates.slice(0, 2).map((candidate, rank) => this.store.recordCandidate(snapshot.id, candidate, { id: roundId, rank })));
    await this.store.finishRound({
      subscriptionId: snapshot.id,
      existingEpisodeKeys,
      resolvedLatestEpisode: resolution.resolvedLatestEpisode,
      pendingLatestEpisode: resolution.pendingLatestEpisode,
      missingEpisodeKeys,
      ...(btbtlaCalibratedAt === undefined ? {} : { btbtlaCalibratedAt })
    });
    return { kind: "checked", existingEpisodeKeys, resolvedLatestEpisode: resolution.resolvedLatestEpisode, pendingLatestEpisode: resolution.pendingLatestEpisode, missingEpisodeKeys, candidates: candidates.slice(0, 2), candidateIds };
  }
}

interface BtbtlaDiscoveryDecision {
  lastBtbtlaCalibratedAt: Date | null;
  now: Date;
  telegramCandidates: readonly NormalizedResourceCandidate[];
  telegramMissingEpisodeKeys: readonly string[];
  telegramObservations: readonly { source: string; latestEpisode: number }[];
}

/** PRD §9.5: 12-hour success calibration, or fallback when Telegram is insufficient. */
export function shouldDiscoverBtbtla(input: BtbtlaDiscoveryDecision): boolean {
  const due = input.lastBtbtlaCalibratedAt === null
    || input.now.getTime() - input.lastBtbtlaCalibratedAt.getTime() >= BTBTLA_CALIBRATION_INTERVAL_MS;
  const noTelegramCandidate = input.telegramCandidates.length === 0;
  const missingNotCovered = input.telegramMissingEpisodeKeys.length > 0
    && !input.telegramCandidates.some((candidate) => candidate.coversAllMissing);
  const noReliableLatest = input.telegramObservations.length === 0;
  return due || noTelegramCandidate || missingNotCovered || noReliableLatest;
}

function withMissingEpisodes(base: ResourceCandidateContext, mediaType: MediaType, missingEpisodeKeys: readonly string[]): ResourceCandidateContext {
  return {
    ...base,
    ...(mediaType === "movie" ? {} : { missingEpisodes: missingEpisodeKeys.map(episodeFromKey).filter((episode) => episode > 0) })
  };
}

async function eligibleCandidates(inputs: readonly ResourceCandidateInput[], context: ResourceCandidateContext, failures: ResourceFailureReader): Promise<NormalizedResourceCandidate[]> {
  const normalized = inputs.map((input) => normalizeResourceCandidate(input, context)).filter((candidate) => !candidate.rejectionReason);
  const states = await Promise.all(normalized.map(async (candidate) => ({ candidate, failure: await failures.find(candidate.source, candidate.candidateKey) })));
  return states.filter(({ failure }) => !isPermanentlyBlacklisted(failure)).map(({ candidate }) => candidate);
}

function telegramObservations(built: readonly { input: ResourceCandidateInput; channelId: string }[]): Array<{ source: string; latestEpisode: number }> {
  const maxByChannel = new Map<string, number>();
  for (const { input, channelId } of built) {
    const highest = Math.max(...(input.availableEpisodes ?? []));
    if (!Number.isFinite(highest)) continue;
    maxByChannel.set(channelId, Math.max(maxByChannel.get(channelId) ?? 0, highest));
  }
  return [...maxByChannel].map(([source, latestEpisode]) => ({ source: `telegram:${source}`, latestEpisode }));
}

function btbtlaObservations(inputs: readonly ResourceCandidateInput[]): Array<{ source: string; latestEpisode: number }> {
  const latestEpisode = Math.max(...inputs.flatMap((input) => input.availableEpisodes ?? []));
  return Number.isFinite(latestEpisode) ? [{ source: "btbtla", latestEpisode }] : [];
}

function episodeFromKey(key: string): number {
  const value = /E(\d+)$/iu.exec(key)?.[1];
  return value === undefined ? 0 : Number(value);
}
