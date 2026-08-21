type ApiErrorBody = { error?: { message?: unknown } };

export type StorageCategorySettings = { key: string; label: string; configured: boolean; folderCid: string | null; folderPath: string | null };
export type Settings = {
  pan115: { connected: boolean; configured: boolean };
  defaultTargetQuality: "2160p" | "1080p";
  searchSourceProxy: SearchSourceProxySettings;
  storageCategories: StorageCategorySettings[];
};
export type Pan115Folder = { cid: string; name: string; path: string };
export type Pan115Connection = { connected: boolean; configured: boolean; verifiedAt?: string | null };
export type SearchChannel = { id: string; name: string; channelId: string; isEnabled: boolean; sortOrder: number; lastCheckStatus: "unknown" | "ok" | "failed"; lastCheckedAt: string | null; lastCheckMessage: string | null };
export type ResourceSourceSettings = { btbtlaEnabled: boolean };
export type ProxySettings = { isProxyEnabled: boolean; httpProxyHost: string; httpProxyPort: string };
export type SearchSourceProxySettings = { btbtlaEnabled: boolean; isProxyEnabled: boolean; httpProxyHost: string; httpProxyPort: number };
export type ConnectionCheck = { ok: boolean; message?: string };
export type MediaMetadata = { id: string; sourceId: string; source: string; title: string; aliases: string[]; year: number; mediaType: "series" | "movie"; region: string; genres: string[]; posterUrl: string | null; backdropUrl: string | null; rating: number | null; recommendation: string | null; latestEpisode: number | null; totalEpisodes: number | null; summary: string };
/** A compact, normalized card returned by the PRD §3 discover endpoint. */
export type DiscoverCard = MediaMetadata & { cardSubtitle?: string; episodesInfo?: string; isNew?: boolean };
export type DiscoverSection = { key: string; title: string; items: DiscoverCard[] };
export type DiscoverSectionsResponse = { sections: DiscoverSection[] };
export type SubscriptionSummary = { id: string; seriesId: string; title: string; seasonNumber: number; subscriptionStatus: "following" | "paused" | "stopped"; lifecycleStatus: "active" | "completed"; runStatus: "waiting" | "checking" | "backfilling" | "exception" | "released"; resolvedLatestEpisode: number; missingEpisodeKeys: string[]; targetQuality: "2160p" | "1080p"; targetSeasonPath: string | null; lastCheckedAt: string | null; consecutiveFailRounds: number; latestEpisode?: number | null; existingEpisodeCount?: number | null; mediaType?: "series" | "movie"; year?: number | null; posterUrl?: string | null; hasStoredFiles?: boolean; updatedAt?: string };
export type SubscriptionActivity = { time: string; level: "info" | "warning" | "error"; type: string; message: string };
export type SubscriptionDetail = SubscriptionSummary & { media: MediaMetadata; totalEpisodes: number | null; activities: SubscriptionActivity[] };
export type CleanupCandidatePreview = { id: string; subscriptionId: string; title: string; episodeKey: string; keep: { fileId: string; name: string; quality: "2160p" | "1080p" }; remove: { fileId: string; name: string; quality: "2160p" | "1080p" }; reason: string };
export type SubscriptionAction = "pause" | "resume" | "stop" | "refollow" | "release" | "check" | "upgradeQuality";
type Page<T> = { items: T[]; nextCursor: string | null };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, credentials: "include" });
  } catch {
    throw new ApiError("网络连接失败，请稍后重试。", 0);
  }
  if (response.ok) return response;

  let message = "请求未完成，请稍后重试。";
  try {
    const body = await response.json() as ApiErrorBody;
    if (typeof body.error?.message === "string") message = body.error.message;
  } catch { /* Use the concise fallback for non-JSON responses. */ }
  throw new ApiError(message, response.status);
}

export async function login(username: string, password: string): Promise<void> {
  await request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
}

export async function logout(): Promise<void> {
  await request("/api/v1/auth/logout", { method: "POST" });
}

// The server-owned HttpOnly cookie determines whether an existing session is valid.
export async function hasSession(): Promise<boolean> {
  try {
    await request("/api/v1/settings");
    return true;
  } catch {
    return false;
  }
}

export async function getSettings(): Promise<Settings> {
  return (await request("/api/v1/settings")).json() as Promise<Settings>;
}

/** Reads only the service's local metadata cache. */
export async function searchMedia(query: string): Promise<Page<MediaMetadata>> {
  return (await request(`/api/v1/media/search?${new URLSearchParams({ q: query }).toString()}`)).json() as Promise<Page<MediaMetadata>>;
}

export async function getMedia(id: string): Promise<MediaMetadata> {
  return (await request(`/api/v1/media/${encodeURIComponent(id)}`)).json() as Promise<MediaMetadata>;
}

/** Reads the eleven independently-normalized Douban hot sections. */
export async function getDiscoverSections(): Promise<DiscoverSectionsResponse> {
  return (await request("/api/v1/discover/hot")).json() as Promise<DiscoverSectionsResponse>;
}

export async function createSubscription(input: { mediaMetadataId: string; seasonNumber: number; targetQuality: "2160p" | "1080p" }): Promise<SubscriptionSummary> {
  return (await request("/api/v1/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })).json() as Promise<SubscriptionSummary>;
}

export async function updateSubscription(id: string, action: SubscriptionAction): Promise<SubscriptionSummary> {
  return (await request(`/api/v1/subscriptions/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) })).json() as Promise<SubscriptionSummary>;
}

/** Reads the locally persisted subscription summary; it never triggers a scan. */
export async function listSubscriptions(): Promise<Page<SubscriptionSummary>> {
  return (await request("/api/v1/subscriptions?limit=50")).json() as Promise<Page<SubscriptionSummary>>;
}

/** Reads an existing subscription and its local media metadata without a 115 request. */
export async function getSubscription(id: string): Promise<SubscriptionDetail> {
  return (await request(`/api/v1/subscriptions/${encodeURIComponent(id)}`)).json() as Promise<SubscriptionDetail>;
}

/** Returns local duplicate-file recommendations only; this endpoint never deletes files. */
export async function listCleanupCandidates(): Promise<Page<CleanupCandidatePreview>> {
  return (await request("/api/v1/cleanup-candidates")).json() as Promise<Page<CleanupCandidatePreview>>;
}
export async function confirmCleanupCandidate(id: string): Promise<{ accepted: number }> {
  return (await request(`/api/v1/cleanup-candidates/${encodeURIComponent(id)}/confirm`, { method: "POST" })).json() as Promise<{ accepted: number }>;
}
export async function confirmAllCleanupCandidates(candidateIds: readonly string[]): Promise<{ accepted: number }> {
  return (await request("/api/v1/cleanup-candidates/confirm-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateIds }) })).json() as Promise<{ accepted: number }>;
}

export async function saveDefaultTargetQuality(defaultTargetQuality: "2160p" | "1080p"): Promise<void> {
  await request("/api/v1/settings/default-target-quality", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ defaultTargetQuality }) });
}

export async function testPan115Credential(cookie: string): Promise<Pan115Connection> {
  return (await request("/api/v1/settings/pan115/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cookie }) })).json() as Promise<Pan115Connection>;
}

export async function savePan115Credential(cookie: string): Promise<Pan115Connection> {
  return (await request("/api/v1/settings/pan115", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cookie }) })).json() as Promise<Pan115Connection>;
}

export async function listPan115Folders(cid = "0", path?: string): Promise<Pan115Folder[]> {
  const query = new URLSearchParams({ cid });
  if (path) query.set("path", path);
  return (await request(`/api/v1/pan115/folders?${query.toString()}`)).json() as Promise<Pan115Folder[]>;
}

export async function saveStorageCategoryMapping(key: string, folderCid: string, folderPath: string): Promise<void> {
  await request(`/api/v1/settings/storage-categories/${encodeURIComponent(key)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderCid, folderPath }) });
}

export async function listSearchChannels(): Promise<SearchChannel[]> {
  return (await request("/api/v1/search-channels")).json().then((body: { items: SearchChannel[] }) => body.items);
}

export async function createSearchChannel(input: Pick<SearchChannel, "name" | "channelId">): Promise<SearchChannel> {
  return (await request("/api/v1/search-channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })).json() as Promise<SearchChannel>;
}

export async function updateSearchChannel(id: string, input: Partial<Pick<SearchChannel, "name" | "channelId" | "isEnabled">>): Promise<SearchChannel> {
  return (await request(`/api/v1/search-channels/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })).json() as Promise<SearchChannel>;
}

export async function deleteSearchChannel(id: string): Promise<void> { await request(`/api/v1/search-channels/${encodeURIComponent(id)}`, { method: "DELETE" }); }
export async function reorderSearchChannels(ids: string[]): Promise<SearchChannel[]> { return (await request("/api/v1/search-channels/order", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) })).json() as Promise<SearchChannel[]>; }
export async function importSearchChannels(entries: Array<Pick<SearchChannel, "name" | "channelId">>): Promise<SearchChannel[]> {
  return (await request("/api/v1/search-channels/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries }) })).json() as Promise<SearchChannel[]>;
}
export async function checkSearchChannel(id: string): Promise<SearchChannel> { return ((await request(`/api/v1/search-channels/${encodeURIComponent(id)}/check`, { method: "POST" })).json() as Promise<{ channel: SearchChannel }>).then(result => result.channel); }
export async function checkAllSearchChannels(): Promise<SearchChannel[]> {
  return ((await request("/api/v1/search-channels/check-all", { method: "POST" })).json() as Promise<Array<{ channel: SearchChannel }>>).then(results => results.map(result => result.channel));
}

function validPort(value: string): number | null {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

async function saveSearchSourceProxySettings(input: SearchSourceProxySettings): Promise<SearchSourceProxySettings> {
  return (await request("/api/v1/settings/search-source-proxy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })).json() as Promise<SearchSourceProxySettings>;
}

// PRD §12.4–12.5 intentionally persist one policy while keeping two UI panels.
export async function saveResourceSourceSettings(input: ResourceSourceSettings): Promise<ResourceSourceSettings> {
  const current = (await getSettings()).searchSourceProxy;
  const saved = await saveSearchSourceProxySettings({ ...current, btbtlaEnabled: input.btbtlaEnabled });
  return { btbtlaEnabled: saved.btbtlaEnabled };
}
export async function testBtbtlaConnection(): Promise<ConnectionCheck> {
  return (await request("/api/v1/settings/search-source-proxy/btbtla/test", { method: "POST" })).json() as Promise<ConnectionCheck>;
}
export async function saveProxySettings(input: ProxySettings): Promise<ProxySettings> {
  const current = (await getSettings()).searchSourceProxy;
  const port = validPort(input.httpProxyPort);
  if (port === null) throw new ApiError("HTTP Proxy Port 必须是 1 到 65535 的整数。", 400);
  const saved = await saveSearchSourceProxySettings({ ...current, isProxyEnabled: input.isProxyEnabled, httpProxyHost: input.httpProxyHost.trim() || current.httpProxyHost, httpProxyPort: port });
  return { isProxyEnabled: saved.isProxyEnabled, httpProxyHost: saved.httpProxyHost, httpProxyPort: String(saved.httpProxyPort) };
}
export async function testProxyConnection(input: ProxySettings): Promise<ConnectionCheck> {
  void input;
  return (await request("/api/v1/settings/search-source-proxy/test", { method: "POST" })).json() as Promise<ConnectionCheck>;
}
