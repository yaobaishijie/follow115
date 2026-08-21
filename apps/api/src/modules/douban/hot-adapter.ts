import type { DoubanHotCategory } from "./hot-categories.js";
import type { DoubanHotItem, DoubanHotPort } from "../discover/discover-service.js";

/** Verified legacy upstream. The adapter itself never owns a live transport. */
export const DOUBAN_REXXAR_BASE_URL = "https://m.douban.com/rexxar/api/v2";
export const DOUBAN_HOT_TIMEOUT_MS = 15_000;

export interface DoubanHotHttpClient {
  get(input: {
    url: string;
    query: Readonly<Record<string, string | number>>;
    timeoutMs: number;
  }): Promise<{ status?: number; body: unknown }>;
}

export interface DoubanFetchResponse { status: number; json(): Promise<unknown>; }
export type DoubanFetch = (input: string, init: { method: "GET"; headers: Readonly<Record<string, string>>; signal: AbortSignal }) => Promise<DoubanFetchResponse>;

/** Production transport has a GET-only surface and an owned cancellation deadline. */
export function createFetchDoubanHotHttpClient(fetchImpl: DoubanFetch = globalThis.fetch): DoubanHotHttpClient {
  return {
    async get({ url, query, timeoutMs }) {
      const target = new URL(url);
      for (const [key, value] of Object.entries(query)) target.searchParams.set(key, String(value));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(target.toString(), {
          method: "GET", signal: controller.signal,
          headers: { Accept: "application/json", Referer: "https://m.douban.com/", "User-Agent": "Mozilla/5.0 (compatible; Follow115/1.0)" }
        });
        return { status: response.status, body: await response.json() };
      } finally { clearTimeout(timeout); }
    }
  };
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

/**
 * Implements CloudSaver's confirmed read-only hot-list call. Keeping the HTTP
 * client injected makes production composition explicit and tests network-free.
 */
export class DoubanHotAdapter implements DoubanHotPort {
  constructor(private readonly http: DoubanHotHttpClient, private readonly baseUrl = DOUBAN_REXXAR_BASE_URL) {}

  async list(category: DoubanHotCategory): Promise<readonly DoubanHotItem[]> {
    const url = `${this.baseUrl.replace(/\/+$/u, "")}/subject/recent_hot/${category.api}`;
    const response = await this.http.get({
      url,
      query: { type: category.type, category: category.category, api: category.api, start: 0, count: 9 },
      timeoutMs: DOUBAN_HOT_TIMEOUT_MS
    });
    if (response.status !== undefined && (response.status < 200 || response.status >= 300)) {
      throw new Error(`Douban hot request failed with HTTP ${response.status}.`);
    }
    const items = asRecord(response.body).items;
    return Array.isArray(items) ? items.map(normalizeItem).filter((item): item is DoubanHotItem => item !== null) : [];
  }
}

function normalizeItem(value: unknown): DoubanHotItem | null {
  const item = asRecord(value);
  const id = typeof item.id === "string" || typeof item.id === "number" ? String(item.id) : "";
  const title = typeof item.title === "string" ? item.title : "";
  if (!id || !title) return null;
  return {
    id,
    title,
    ...optional("pic", asPic(item.pic)),
    ...optional("rating", asRating(item.rating)),
    ...optional("card_subtitle", stringOrUndefined(item.card_subtitle)),
    ...optional("episodes_info", stringOrUndefined(item.episodes_info)),
    ...optional("type", stringOrUndefined(item.type)),
    ...optional("is_new", typeof item.is_new === "boolean" ? item.is_new : undefined)
  };
}

function asPic(value: unknown): DoubanHotItem["pic"] | undefined {
  const pic = asRecord(value);
  const large = stringOrUndefined(pic.large);
  const normal = stringOrUndefined(pic.normal);
  return large || normal ? { ...optional("large", large), ...optional("normal", normal) } : undefined;
}

function asRating(value: unknown): DoubanHotItem["rating"] | undefined {
  const rating = asRecord(value);
  const rawValue = numberOrUndefined(rating.value);
  const count = numberOrUndefined(rating.count);
  return rawValue === undefined && count === undefined ? undefined : { ...optional("value", rawValue), ...optional("count", count) };
}

function stringOrUndefined(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function optional<T>(key: string, value: T | undefined): Record<string, T> { return value === undefined ? {} : { [key]: value }; }
function numberOrUndefined(value: unknown): number | undefined {
  const number = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}
