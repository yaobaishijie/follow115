import {
  AppError,
  type NormalizedResourceCandidate,
  type Pan115Share,
  type ResourceCandidateContext,
  type ResourceCandidateInput,
  type ResourceFailureRecord
} from "@follow115/contracts";
import {
  isPermanentlyBlacklisted,
  normalizeResourceCandidate,
  sortEligibleResourceCandidates,
} from "./resource-candidates.js";
import type {
  TelegramSearchAdapter,
  TelegramChannelSearchResult
} from "./telegram-search-adapter.js";

/**
 * Read-only boundary for a source that has already collected raw candidate
 * data.  Implementations may use Telegram or btbtla, while tests provide an
 * in-memory implementation.  This module never creates a network client.
 */
export interface ResourceCandidateDiscoveryPort {
  discover(context: ResourceCandidateContext): Promise<readonly ResourceCandidateInput[]>;
}

/** Read-only boundary for the resource-level failure/blacklist record. */
export interface ResourceFailureReader {
  find(source: ResourceCandidateInput["source"], candidateKey: string): Promise<ResourceFailureRecord | null>;
}

export interface CandidateDiscoveryResult {
  candidates: readonly NormalizedResourceCandidate[];
  rejectedCount: number;
  blacklistedCount: number;
}

/**
 * Composes discovery with the pure candidate rules.  It deliberately has no
 * persistence or execution method: selecting and attempting a candidate is
 * owned by the scheduler/job module.
 */
export class ResourceCandidateService {
  constructor(
    private readonly discovery: ResourceCandidateDiscoveryPort,
    private readonly failures: ResourceFailureReader,
    private readonly telegram: TelegramSearchPort = new NotImplementedTelegramSearchPort()
  ) {}

  /** Delegates Telegram preview lookup to an explicitly injected adapter. */
  searchTelegram(input: TelegramSearchInput): Promise<TelegramChannelSearchResult> {
    return this.telegram.search(input);
  }

  async discoverEligible(context: ResourceCandidateContext): Promise<CandidateDiscoveryResult> {
    const inputs = await this.discovery.discover(context);
    const normalized = inputs.map((input) => normalizeResourceCandidate(input, context));
    const viable = normalized.filter((candidate) => !candidate.rejectionReason);
    const blacklistStates = await Promise.all(viable.map(async (candidate) => ({
      candidate,
      blacklisted: isPermanentlyBlacklisted(await this.failures.find(candidate.source, candidate.candidateKey))
    })));

    return {
      candidates: sortEligibleResourceCandidates(blacklistStates.filter((state) => !state.blacklisted).map((state) => state.candidate)),
      rejectedCount: normalized.length - viable.length,
      blacklistedCount: blacklistStates.filter((state) => state.blacklisted).length
    };
  }
}

/**
 * The upstream share endpoints have been reverse engineered, but this port is
 * deliberately not composed until the user explicitly authorizes real 115
 * writes. Keeping it explicit prevents an accidental transfer.
 */
export interface Pan115SharePort {
  expandShare(share: Pan115Share): Promise<never>;
  saveFiles(input: { share: Pan115Share; fileIds: readonly string[]; targetFolderId: string }): Promise<never>;
}

export interface TelegramSearchInput {
  channelId: string;
  keyword: string;
}

/** Read-only boundary for querying one public Telegram preview channel. */
export interface TelegramSearchPort {
  search(input: TelegramSearchInput): Promise<TelegramChannelSearchResult>;
}

export class NotImplementedPan115SharePort implements Pan115SharePort {
  async expandShare(_share: Pan115Share): Promise<never> {
    void _share;
    throw notImplemented("115 share expansion is disabled until a production read client is explicitly composed.");
  }

  async saveFiles(_input: { share: Pan115Share; fileIds: readonly string[]; targetFolderId: string }): Promise<never> {
    void _input;
    throw notImplemented("115 share transfer is disabled until the user explicitly authorizes 115 writes.");
  }
}

export class NotImplementedTelegramSearchPort implements TelegramSearchPort {
  async search(_input: TelegramSearchInput): Promise<never> {
    void _input;
    throw notImplemented("Telegram t.me/s search has not been configured with an HTTP adapter.");
  }
}

/** Adapts the injected public-preview adapter to this service's narrow port. */
export class TelegramSearchAdapterPort implements TelegramSearchPort {
  constructor(private readonly adapter: TelegramSearchAdapter) {}

  search(input: TelegramSearchInput): Promise<TelegramChannelSearchResult> {
    return this.adapter.search({ id: input.channelId, channelId: input.channelId, sortOrder: 0 }, input.keyword);
  }
}

function notImplemented(message: string): AppError {
  return new AppError("NOT_IMPLEMENTED", message);
}
