import type { ApiError } from "./errors.js";
import type { LifecycleStatus, MediaType, RunStatus, SubscriptionStatus } from "./domain.js";

export interface HealthResponse { status: "ok"; database: "ok" | "unavailable"; jobs: "ok" | "unavailable"; version: string; }
export interface SubscriptionSummary {
  id: string; seriesId: string; title: string; seasonNumber: number; subscriptionStatus: SubscriptionStatus;
  lifecycleStatus: LifecycleStatus; runStatus: RunStatus; resolvedLatestEpisode: number; missingEpisodeKeys: string[];
  targetQuality: "2160p" | "1080p"; targetSeasonPath: string | null; lastCheckedAt: string | null; consecutiveFailRounds: number;
  mediaType?: MediaType; year?: number | null; posterUrl?: string | null; hasStoredFiles?: boolean; updatedAt?: string;
}
/** UI-safe activity projection; no CIDs, candidate keys, URLs, or raw metadata. */
export interface SubscriptionActivity { time: string; level: "info" | "warning" | "error"; type: string; message: string; }
export interface SubscriptionDetail extends SubscriptionSummary { totalEpisodes: number | null; activities: SubscriptionActivity[]; }
export interface Page<T> { items: T[]; nextCursor: string | null; }
export interface CreateSubscriptionRequest { mediaMetadataId: string; seasonNumber: number; targetQuality: "2160p" | "1080p"; }
export interface UpdateSubscriptionRequest { action: "pause" | "resume" | "stop" | "refollow" | "release" | "check" | "upgradeQuality"; }
export interface SearchChannelRequest { name: string; channelId: string; isEnabled?: boolean; }
export interface UpdateSearchChannelRequest { name?: string; channelId?: string; isEnabled?: boolean; }
export interface SearchChannelOrderRequest { ids: string[]; }
export interface ImportSearchChannelsRequest { entries: Array<{ name: string; channelId: string; isEnabled?: boolean }>; }
export interface SearchChannel {
  id: string; name: string; channelId: string; isEnabled: boolean; sortOrder: number;
  lastCheckStatus: "unknown" | "ok" | "failed"; lastCheckedAt: string | null; lastCheckMessage: string | null;
}
export interface SearchChannelCheck { channel: SearchChannel; checked: boolean; }
export interface Pan115Folder { cid: string; name: string; path: string; }
export type DiscoverHotCategoryKey =
  | "hot-movie" | "latest-movie" | "classic-movie" | "hot-tv" | "tv-domestic"
  | "tv-american" | "tv-korean" | "tv-japanese" | "tv-animation" | "tv-documentary" | "hot-show";
/** PRD §3.3 normalized Douban data; image values are remote URLs only. */
export interface DiscoverHotItem {
  /** Local UUID: resolvable via GET /media/:id and valid for subscription creation. */
  id: string; sourceId: string; source: string; title: string; aliases: string[]; year: number;
  mediaType: "series" | "movie"; region: string; genres: string[]; posterUrl: string | null; backdropUrl: string | null;
  rating: number | null; recommendation: string | null; latestEpisode: number | null; totalEpisodes: number | null; summary: string;
  cardSubtitle?: string; episodesInfo?: string; isNew?: boolean;
}
export interface DiscoverHotSection { key: DiscoverHotCategoryKey; title: string; items: DiscoverHotItem[]; }
export interface DiscoverHotResponse { sections: DiscoverHotSection[]; }
export interface SaveStorageCategoryMappingRequest { folderCid: string; folderPath: string; }
export interface SavePan115CredentialRequest { cookie: string; }
export interface SaveDefaultTargetQualityRequest { defaultTargetQuality: "2160p" | "1080p"; }
/** PRD §12.4–12.5: persisted local policy. Network access occurs only through an explicit test endpoint. */
export interface SearchSourceProxySettings {
  btbtlaEnabled: boolean;
  isProxyEnabled: boolean;
  httpProxyHost: string;
  httpProxyPort: number;
}
export type SaveSearchSourceProxySettingsRequest = SearchSourceProxySettings;
export interface ConnectionCheck { ok: boolean; message: string; }
export interface CleanupCandidatePreview {
  id: string; subscriptionId: string; title: string; episodeKey: string;
  keep: { fileId: string; name: string; quality: "2160p" | "1080p" };
  remove: { fileId: string; name: string; quality: "2160p" | "1080p" };
  reason: string;
}

export interface ApiContract {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  success: string;
  errors: readonly ApiError["error"]["code"][];
}

export const apiContracts: readonly ApiContract[] = [
  { method: "GET", path: "/health", success: "HealthResponse", errors: ["INTERNAL_ERROR"] },
  { method: "POST", path: "/api/v1/auth/login", success: "Session", errors: ["VALIDATION_ERROR", "UNAUTHENTICATED"] },
  { method: "POST", path: "/api/v1/auth/logout", success: "Empty", errors: ["UNAUTHENTICATED"] },
  { method: "GET", path: "/api/v1/discover/hot", success: "DiscoverHotResponse", errors: ["EXTERNAL_TIMEOUT", "EXTERNAL_UNAVAILABLE"] },
  { method: "GET", path: "/api/v1/media/discover", success: "Page<MediaMetadata>", errors: ["VALIDATION_ERROR", "EXTERNAL_UNAVAILABLE"] },
  { method: "GET", path: "/api/v1/media/search", success: "Page<MediaMetadata>", errors: ["VALIDATION_ERROR", "EXTERNAL_UNAVAILABLE"] },
  { method: "GET", path: "/api/v1/media/:id", success: "MediaMetadata", errors: ["NOT_FOUND"] },
  { method: "GET", path: "/api/v1/subscriptions", success: "Page<SubscriptionSummary>", errors: ["VALIDATION_ERROR"] },
  { method: "POST", path: "/api/v1/subscriptions", success: "SubscriptionSummary", errors: ["VALIDATION_ERROR", "CONFLICT", "CONFIGURATION_REQUIRED"] },
  { method: "GET", path: "/api/v1/subscriptions/:id", success: "SubscriptionDetail", errors: ["NOT_FOUND"] },
  { method: "GET", path: "/api/v1/cleanup-candidates", success: "Page<CleanupCandidatePreview>", errors: ["UNAUTHENTICATED"] },
  { method: "POST", path: "/api/v1/cleanup-candidates/:id/confirm", success: "Accepted", errors: ["UNAUTHENTICATED", "NOT_FOUND"] },
  { method: "POST", path: "/api/v1/cleanup-candidates/confirm-all", success: "Accepted", errors: ["UNAUTHENTICATED", "VALIDATION_ERROR"] },
  { method: "PATCH", path: "/api/v1/subscriptions/:id", success: "SubscriptionSummary", errors: ["VALIDATION_ERROR", "NOT_FOUND", "INVALID_STATE_TRANSITION"] },
  { method: "GET", path: "/api/v1/settings", success: "Settings", errors: ["UNAUTHENTICATED"] },
  { method: "PUT", path: "/api/v1/settings/default-target-quality", success: "Settings", errors: ["UNAUTHENTICATED", "VALIDATION_ERROR"] },
  { method: "PUT", path: "/api/v1/settings/search-source-proxy", success: "SearchSourceProxySettings", errors: ["UNAUTHENTICATED", "VALIDATION_ERROR"] },
  { method: "POST", path: "/api/v1/settings/search-source-proxy/test", success: "ConnectionCheck", errors: ["UNAUTHENTICATED", "EXTERNAL_TIMEOUT", "EXTERNAL_UNAVAILABLE"] },
  { method: "POST", path: "/api/v1/settings/search-source-proxy/btbtla/test", success: "ConnectionCheck", errors: ["UNAUTHENTICATED", "EXTERNAL_TIMEOUT", "EXTERNAL_UNAVAILABLE"] },
  { method: "POST", path: "/api/v1/settings/pan115/test", success: "Pan115Connection", errors: ["UNAUTHENTICATED", "VALIDATION_ERROR", "CREDENTIAL_INVALID", "EXTERNAL_UNAVAILABLE"] },
  { method: "PUT", path: "/api/v1/settings/pan115", success: "Pan115Connection", errors: ["UNAUTHENTICATED", "VALIDATION_ERROR", "CREDENTIAL_INVALID", "EXTERNAL_UNAVAILABLE"] },
  { method: "GET", path: "/api/v1/pan115/folders", success: "Pan115Folder[]", errors: ["UNAUTHENTICATED", "CONFIGURATION_REQUIRED", "CREDENTIAL_INVALID", "EXTERNAL_TIMEOUT", "EXTERNAL_UNAVAILABLE"] },
  { method: "PUT", path: "/api/v1/settings/storage-categories/:key", success: "StorageCategoryMapping", errors: ["UNAUTHENTICATED", "VALIDATION_ERROR", "NOT_FOUND"] },
  { method: "GET", path: "/api/v1/search-channels", success: "Page<SearchChannel>", errors: ["UNAUTHENTICATED"] },
  { method: "POST", path: "/api/v1/search-channels", success: "SearchChannel", errors: ["UNAUTHENTICATED", "VALIDATION_ERROR", "CONFLICT", "EXTERNAL_TIMEOUT", "EXTERNAL_UNAVAILABLE"] },
  { method: "PATCH", path: "/api/v1/search-channels/:id", success: "SearchChannel", errors: ["UNAUTHENTICATED", "VALIDATION_ERROR", "NOT_FOUND"] },
  { method: "DELETE", path: "/api/v1/search-channels/:id", success: "Empty", errors: ["UNAUTHENTICATED", "NOT_FOUND"] },
  { method: "PUT", path: "/api/v1/search-channels/order", success: "SearchChannel[]", errors: ["UNAUTHENTICATED", "VALIDATION_ERROR", "NOT_FOUND", "CONFLICT"] },
  { method: "POST", path: "/api/v1/search-channels/import", success: "SearchChannel[]", errors: ["UNAUTHENTICATED", "VALIDATION_ERROR", "CONFLICT", "EXTERNAL_TIMEOUT", "EXTERNAL_UNAVAILABLE"] },
  { method: "POST", path: "/api/v1/search-channels/:id/check", success: "SearchChannelCheck", errors: ["UNAUTHENTICATED", "NOT_FOUND", "EXTERNAL_TIMEOUT", "EXTERNAL_UNAVAILABLE"] },
  { method: "POST", path: "/api/v1/search-channels/check-all", success: "SearchChannelCheck[]", errors: ["UNAUTHENTICATED"] }
];
