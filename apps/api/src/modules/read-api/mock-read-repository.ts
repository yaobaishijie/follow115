import type { LifecycleStatus, MediaType, RunStatus, SearchSourceProxySettings, SubscriptionActivity, SubscriptionStatus } from "@follow115/contracts";

export interface MediaMetadata {
  id: string;
  sourceId: string;
  source: string;
  title: string;
  aliases: string[];
  year: number;
  mediaType: MediaType;
  region: string;
  genres: string[];
  posterUrl: string | null;
  backdropUrl: string | null;
  rating: number | null;
  recommendation: string | null;
  latestEpisode: number | null;
  totalEpisodes: number | null;
  summary: string;
}

export interface SubscriptionSummary {
  id: string;
  seriesId: string;
  title: string;
  seasonNumber: number;
  subscriptionStatus: SubscriptionStatus;
  lifecycleStatus: LifecycleStatus;
  runStatus: RunStatus;
  resolvedLatestEpisode: number;
  missingEpisodeKeys: string[];
  targetQuality: "2160p" | "1080p";
  targetSeasonPath: string | null;
  lastCheckedAt: string | null;
  consecutiveFailRounds: number;
  mediaType?: MediaType;
  year?: number | null;
  posterUrl?: string | null;
  hasStoredFiles?: boolean;
  updatedAt?: string;
}

export interface SubscriptionDetail extends SubscriptionSummary {
  media: MediaMetadata;
  totalEpisodes: number | null;
  activities: SubscriptionActivity[];
}

export interface Settings {
  pan115: { connected: boolean; configured: boolean };
  defaultTargetQuality: "2160p" | "1080p";
  searchSourceProxy: SearchSourceProxySettings;
  storageCategories: Array<{ key: string; label: string; configured: boolean; folderCid: string | null; folderPath: string | null }>;
}

export interface Page<T> { items: T[]; nextCursor: string | null; }

export interface ReadRepository {
  discoverMedia(cursor: string | undefined, limit: number): Promise<Page<MediaMetadata>>;
  searchMedia(query: string, cursor: string | undefined, limit: number): Promise<Page<MediaMetadata>>;
  getMedia(id: string): Promise<MediaMetadata | null>;
  listSubscriptions(cursor: string | undefined, limit: number): Promise<Page<SubscriptionSummary>>;
  getSubscription(id: string): Promise<SubscriptionDetail | null>;
  getSettings(): Promise<Settings>;
}

const media: MediaMetadata[] = [
  {
    id: "media-the-last-of-us", sourceId: "mock-1399", source: "mock", title: "最后生还者", aliases: ["The Last of Us"], year: 2025,
    mediaType: "series", region: "美国", genres: ["剧情", "科幻"], posterUrl: null, backdropUrl: null, rating: 8.8,
    recommendation: "热门续作", latestEpisode: 7, totalEpisodes: 7, summary: "在人类文明崩坏后，两名幸存者踏上横跨美国的旅程。"
  },
  {
    id: "media-ordinary-hero", sourceId: "mock-1400", source: "mock", title: "不说话的爱", aliases: ["Mumu"], year: 2025,
    mediaType: "movie", region: "中国大陆", genres: ["剧情"], posterUrl: null, backdropUrl: null, rating: 7.2,
    recommendation: "院线热映", latestEpisode: null, totalEpisodes: null, summary: "一个父亲为守护女儿而做出的选择。"
  }
];

const subscriptions: SubscriptionDetail[] = [{
  id: "sub-last-of-us-s02", seriesId: "series-the-last-of-us", title: "最后生还者", seasonNumber: 2,
  subscriptionStatus: "following", lifecycleStatus: "completed", runStatus: "waiting", resolvedLatestEpisode: 7,
  missingEpisodeKeys: [], targetQuality: "1080p", targetSeasonPath: "/影视库/欧美剧/最后生还者/Season 02", lastCheckedAt: "2026-08-20T08:00:00.000Z", consecutiveFailRounds: 0,
  mediaType: "series", year: 2025, posterUrl: null, hasStoredFiles: true, updatedAt: "2026-08-20T08:00:00.000Z",
  media: media[0]!, totalEpisodes: 7, activities: [{ time: "2026-08-20T08:00:00.000Z", level: "info", type: "candidate.verified", message: "已补齐第 7 集" }]
}];

function page<T extends { id: string }>(items: T[], cursor: string | undefined, limit: number): Page<T> {
  const start = cursor === undefined ? 0 : items.findIndex((item) => item.id === cursor) + 1;
  if (start < 0) return { items: [], nextCursor: null };
  const result = items.slice(start, start + limit);
  const last = result.at(-1);
  return { items: result, nextCursor: last !== undefined && start + limit < items.length ? last.id : null };
}

export class MockReadRepository implements ReadRepository {
  async discoverMedia(cursor: string | undefined, limit: number): Promise<Page<MediaMetadata>> { return page(media, cursor, limit); }
  async searchMedia(query: string, cursor: string | undefined, limit: number): Promise<Page<MediaMetadata>> {
    const normalized = query.normalize("NFKC").toLocaleLowerCase();
    const matches = media.filter((item) => [item.title, ...item.aliases].some((value) => value.normalize("NFKC").toLocaleLowerCase().includes(normalized)));
    return page(matches, cursor, limit);
  }
  async getMedia(id: string): Promise<MediaMetadata | null> { return media.find((item) => item.id === id) ?? null; }
  async listSubscriptions(cursor: string | undefined, limit: number): Promise<Page<SubscriptionSummary>> {
    const result = page(subscriptions, cursor, limit);
    return {
      items: result.items.map((subscription) => ({
        id: subscription.id, seriesId: subscription.seriesId, title: subscription.title, seasonNumber: subscription.seasonNumber,
        subscriptionStatus: subscription.subscriptionStatus, lifecycleStatus: subscription.lifecycleStatus, runStatus: subscription.runStatus,
        resolvedLatestEpisode: subscription.resolvedLatestEpisode, missingEpisodeKeys: subscription.missingEpisodeKeys,
        targetQuality: subscription.targetQuality, targetSeasonPath: subscription.targetSeasonPath,
        lastCheckedAt: subscription.lastCheckedAt, consecutiveFailRounds: subscription.consecutiveFailRounds,
        mediaType: subscription.mediaType, year: subscription.year, posterUrl: subscription.posterUrl,
        hasStoredFiles: subscription.hasStoredFiles, updatedAt: subscription.updatedAt
      })),
      nextCursor: result.nextCursor
    };
  }
  async getSubscription(id: string): Promise<SubscriptionDetail | null> { return subscriptions.find((subscription) => subscription.id === id) ?? null; }
  async getSettings(): Promise<Settings> {
    return {
      pan115: { connected: false, configured: false }, defaultTargetQuality: "1080p",
      searchSourceProxy: { btbtlaEnabled: true, isProxyEnabled: true, httpProxyHost: "clash", httpProxyPort: 7890 },
      storageCategories: [
        { key: "cn_drama", label: "国产剧", configured: false, folderCid: null, folderPath: null }, { key: "us_drama", label: "美剧", configured: false, folderCid: null, folderPath: null },
        { key: "jp_kr_drama", label: "日韩剧", configured: false, folderCid: null, folderPath: null }, { key: "tv", label: "电视剧", configured: false, folderCid: null, folderPath: null },
        { key: "variety", label: "综艺", configured: false, folderCid: null, folderPath: null }, { key: "animation", label: "动漫", configured: false, folderCid: null, folderPath: null },
        { key: "documentary", label: "纪录片", configured: false, folderCid: null, folderPath: null }, { key: "movie", label: "电影", configured: false, folderCid: null, folderPath: null }
      ]
    };
  }
}
