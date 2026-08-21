import { doubanHotCategories, type DoubanHotCategory, type DoubanHotCategoryKey } from "../douban/hot-categories.js";
import { AppError } from "@follow115/contracts";
import type { MediaMetadata } from "../read-api/mock-read-repository.js";
import { InMemoryDiscoverMediaCache, type DiscoverMediaCache } from "./discover-media-cache.js";

/** PRD §3.8 leaves the exact TTL open; five minutes is deliberately short. */
export const DISCOVER_HOT_CACHE_TTL_MS = 5 * 60 * 1_000;

export interface DoubanHotItem {
  id: string;
  title: string;
  pic?: { large?: string; normal?: string };
  rating?: { value?: number | null; count?: number | null };
  card_subtitle?: string;
  episodes_info?: string;
  type?: string;
  is_new?: boolean;
}

export interface DoubanHotPort {
  list(category: DoubanHotCategory): Promise<readonly DoubanHotItem[]>;
}

export interface DiscoverSection {
  category: DoubanHotCategory;
  items: readonly DoubanHotItem[];
}

export interface DiscoverMediaCard extends MediaMetadata {
  cardSubtitle?: string;
  episodesInfo?: string;
  isNew?: boolean;
}

export interface DiscoverHotSection {
  key: DoubanHotCategoryKey;
  title: string;
  items: readonly DiscoverMediaCard[];
}

export function formatRating(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value.toFixed(1) : "--";
}

export function recommendationTag(value: number | null | undefined): "待评分" | "神作" | "推荐" | "可看" | "一般" {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "待评分";
  if (value >= 8.5) return "神作";
  if (value >= 7.5) return "推荐";
  if (value >= 6.5) return "可看";
  return "一般";
}

export function yearFromCardSubtitle(cardSubtitle: string | undefined): number | undefined {
  const match = cardSubtitle?.match(/^\s*(\d{4})(?:\D|$)/);
  const year = match?.[1];
  return year === undefined ? undefined : Number(year);
}

/** Descending year with stable ordering for equal or absent years. */
export function sortBySubtitleYear<T extends { card_subtitle?: string }>(items: readonly T[]): T[] {
  return items.map((item, index) => ({ item, index, year: yearFromCardSubtitle(item.card_subtitle) }))
    .sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity) || a.index - b.index)
    .map(({ item }) => item);
}

export async function loadDiscoverSections(port: DoubanHotPort): Promise<DiscoverSection[]> {
  return Promise.all(doubanHotCategories.map(async (category) => ({
    category,
    items: sortBySubtitleYear(await port.list(category))
  })));
}

/**
 * Read-only orchestration boundary for PRD §3.2–3.3. Cache the complete
 * response as one snapshot so a page cannot mix category generations.
 */
export class DiscoverService {
  private cached: { expiresAt: number; sections: readonly DiscoverHotSection[] } | undefined;

  constructor(
    private readonly port: DoubanHotPort,
    private readonly now: () => number = Date.now,
    private readonly cacheTtlMs = DISCOVER_HOT_CACHE_TTL_MS,
    private readonly mediaCache: DiscoverMediaCache = new InMemoryDiscoverMediaCache()
  ) {
    if (!Number.isFinite(cacheTtlMs) || cacheTtlMs < 0) throw new RangeError("cacheTtlMs must be non-negative.");
  }

  async listHotSections(): Promise<readonly DiscoverHotSection[]> {
    const cached = this.cached;
    if (cached !== undefined && cached.expiresAt > this.now()) return cached.sections;
    try {
      const sections = await loadDiscoverSections(this.port);
      const snapshot = Object.freeze(await Promise.all(sections.map(async ({ category, items }) => Object.freeze({
        key: category.key,
        title: category.title,
        items: Object.freeze(await Promise.all(items.slice(0, 9).map((item) => this.toCard(category, item))))
      }))));
      this.cached = { sections: snapshot, expiresAt: this.now() + this.cacheTtlMs };
      return snapshot;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const name = error !== null && typeof error === "object" && "name" in error && typeof error.name === "string" ? error.name : "";
      if (name === "AbortError") throw new AppError("EXTERNAL_TIMEOUT", "热门影视服务请求超时。", true);
      throw new AppError("EXTERNAL_UNAVAILABLE", "热门影视服务暂不可用。", true);
    }
  }

  private async toCard(category: DoubanHotCategory, item: DoubanHotItem): Promise<DiscoverMediaCard> {
    const rating = typeof item.rating?.value === "number" && Number.isFinite(item.rating.value) ? item.rating.value : null;
    const persisted = await this.mediaCache.upsert({
      sourceId: item.id, source: "douban", title: item.title, aliases: [], year: yearFromCardSubtitle(item.card_subtitle) ?? 0,
      mediaType: category.api === "movie" ? "movie" : "series", region: "", genres: [],
      posterUrl: item.pic?.large ?? item.pic?.normal ?? null, backdropUrl: null, rating,
      recommendation: recommendationTag(rating), latestEpisode: null, totalEpisodes: null, summary: "",
      raw: { id: item.id, title: item.title, pic: item.pic, rating: item.rating, card_subtitle: item.card_subtitle,
        episodes_info: item.episodes_info, type: item.type, is_new: item.is_new }
    });
    return {
      ...persisted,
      ...(item.card_subtitle === undefined ? {} : { cardSubtitle: item.card_subtitle }),
      ...(item.episodes_info === undefined ? {} : { episodesInfo: item.episodes_info }),
      ...(item.is_new === undefined ? {} : { isNew: item.is_new })
    };
  }
}

export { doubanHotCategories, type DoubanHotCategoryKey };
