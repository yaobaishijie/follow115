import type { QualityTier, ResourceCandidateInput } from "@follow115/contracts";
import { detectResourceQuality, extractBtbtlaMagnets, normalizeInfoHash } from "./resource-candidates.js";

/** PRD 22.7 requires a fifteen-second timeout for btbtla requests. */
export const BTBTLA_TIMEOUT_MS = 15_000;

/** Kept at the adapter boundary so a composition root may replace it if needed. */
export const BTBTLA_BROWSER_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface BtbtlaHttpClient {
  get(url: string, options: { timeoutMs: number; headers: Readonly<Record<string, string>> }): Promise<{ body: string; status?: number }>;
}

export interface BtbtlaSearchAdapterOptions {
  /** The site origin is configurable for deployments that route it through a proxy or mirror. */
  baseUrl?: string;
  userAgent?: string;
}

export interface BtbtlaMagnetCandidate {
  detailPath: string;
  downloadPath: string;
  magnet: string;
  infoHash: string;
  /** Search anchor text is retained rather than discarded with the URL. */
  searchTitle: string;
  /** Detail-page body metadata is evidence only; completion remains a later combined decision. */
  detail: BtbtlaDetailMetadata;
  resourceName: string;
  quality: QualityTier | "below_1080p";
  /** Ready for ResourceCandidateService / normalizeResourceCandidate without another parse pass. */
  resourceCandidate: ResourceCandidateInput;
}

export interface BtbtlaDetailMetadata {
  title: string;
  releaseYear?: number;
  latestEpisode?: number;
  totalEpisodes?: number;
  completionSignaled: boolean;
}

type PathAnchor = { path: string; title: string };

export type BtbtlaRequestErrorCode = "BTBTLA_TIMEOUT" | "BTBTLA_HTTP_ERROR" | "BTBTLA_NETWORK_ERROR";

/**
 * Stable, source-scoped request failure used by scheduling code to distinguish
 * transient site failures from resource-level magnet failures.
 */
export class BtbtlaRequestError extends Error {
  constructor(
    readonly code: BtbtlaRequestErrorCode,
    message: string,
    readonly status?: number,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "BtbtlaRequestError";
  }
}

/**
 * Read-only PRD 22.7 traversal. This class intentionally accepts an HTTP port
 * and has no default client, so it cannot make a real request by itself.
 */
export class BtbtlaSearchAdapter {
  private readonly baseUrl: string;
  private readonly headers: Readonly<Record<string, string>>;

  constructor(private readonly http: BtbtlaHttpClient, options: BtbtlaSearchAdapterOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? "https://www.btbtla.com");
    this.headers = { "user-agent": options.userAgent ?? BTBTLA_BROWSER_USER_AGENT };
  }

  async search(title: string): Promise<readonly BtbtlaMagnetCandidate[]> {
    const query = title.trim();
    if (!query) throw new TypeError("btbtla search title must not be empty.");

    const searchHtml = await this.get(`/search/${encodeURIComponent(query)}`);
    const candidates: BtbtlaMagnetCandidate[] = [];
    const seen = new Set<string>();

    for (const detailAnchor of extractPathAnchors(searchHtml, /\/detail\/[^"'?#\s<>]+\.html(?:\?[^"'#\s<>]*)?/iu)) {
      const detailHtml = await this.get(detailAnchor.path);
      const detail = parseDetailMetadata(detailHtml, detailAnchor.title);
      for (const downloadAnchor of extractPathAnchors(detailHtml, /\/tdown\/[^"'?#\s<>]+(?:\?[^"'#\s<>]*)?/iu)) {
        const downloadHtml = await this.get(downloadAnchor.path);
        for (const magnet of extractBtbtlaMagnets(downloadHtml)) {
          const infoHash = normalizeInfoHash(magnet);
          if (infoHash && !seen.has(infoHash)) {
            seen.add(infoHash);
            const resourceName = downloadAnchor.title || detail.title || detailAnchor.title;
            const title = [detail.title || detailAnchor.title, resourceName].filter((value, index, values) => value && values.indexOf(value) === index).join(" ");
            const parsed = parseSeasonEpisodes(resourceName || title);
            candidates.push({
              detailPath: detailAnchor.path, downloadPath: downloadAnchor.path, magnet, infoHash,
              searchTitle: detailAnchor.title, detail, resourceName, quality: detectResourceQuality(resourceName || title),
              resourceCandidate: {
                source: "magnet", title, magnet, ...(parsed.season === null ? {} : { parsedSeason: parsed.season }),
                ...(parsed.episodes.length === 0 ? {} : { availableEpisodes: parsed.episodes })
              }
            });
          }
        }
      }
    }
    return candidates;
  }

  private async get(path: string): Promise<string> {
    const url = new URL(path, this.baseUrl).toString();
    try {
      const response = await this.http.get(url, { timeoutMs: BTBTLA_TIMEOUT_MS, headers: this.headers });
      if (response.status !== undefined && (response.status < 200 || response.status >= 300)) {
        throw new BtbtlaRequestError("BTBTLA_HTTP_ERROR", `btbtla request failed with HTTP ${response.status}.`, response.status);
      }
      return response.body;
    } catch (error) {
      if (error instanceof BtbtlaRequestError) throw error;
      if (isTimeoutError(error)) throw new BtbtlaRequestError("BTBTLA_TIMEOUT", "btbtla request timed out.", undefined, error);
      throw new BtbtlaRequestError("BTBTLA_NETWORK_ERROR", "btbtla request failed.", undefined, error);
    }
  }
}

function extractPathAnchors(html: string, pathPattern: RegExp): PathAnchor[] {
  const anchors: PathAnchor[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a\b(?<attributes>[^>]*)>(?<body>[\s\S]*?)<\/a>/giu;
  for (const match of html.matchAll(anchorPattern)) {
    const attributes = match.groups?.attributes ?? "";
    const href = /\bhref\s*=\s*["'](?<href>[^"']+)["']/iu.exec(attributes)?.groups?.href;
    if (!href) continue;
    pathPattern.lastIndex = 0;
    const path = pathPattern.exec(href)?.[0];
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const title = cleanText(attribute(attributes, "title") || match.groups?.body || "");
    anchors.push({ path, title });
  }
  return anchors;
}

function attribute(attributes: string, name: string): string {
  return new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "iu").exec(attributes)?.[1] ?? "";
}

function cleanText(value: string): string {
  return value.replace(/<[^>]*>/gu, " ").replace(/&nbsp;/giu, " ").replace(/&amp;/giu, "&").replace(/\s+/gu, " ").trim();
}

function parseDetailMetadata(html: string, fallbackTitle: string): BtbtlaDetailMetadata {
  const text = cleanText(html);
  const title = cleanText(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu.exec(html)?.[1] ?? fallbackTitle);
  const releaseYear = parseNumber(/上映\s*[:：]\s*(\d{4})/iu.exec(text)?.[1], 1888, 3000);
  const episodeCount = parseNumber(/集数\s*[:：]\s*(\d{1,3})/iu.exec(text)?.[1], 1, 999);
  const explicitTotal = parseNumber(/全\s*(\d{1,3})\s*集/iu.exec(text)?.[1], 1, 999);
  const completionSignaled = /(?:全\s*\d{1,3}\s*集|全集|完结)/iu.test(text);
  return {
    title,
    ...(releaseYear === undefined ? {} : { releaseYear }),
    ...(episodeCount === undefined ? {} : { latestEpisode: episodeCount }),
    ...(explicitTotal === undefined ? {} : { totalEpisodes: explicitTotal }),
    completionSignaled
  };
}

function parseSeasonEpisodes(value: string): { season: number | null; episodes: number[] } {
  const seasonText = /(?:\bS(\d{1,2})(?=\s*E|\b|[_ .-])|\bseason\s*(\d{1,2})|第\s*(\d{1,2})\s*季)/iu.exec(value)?.slice(1).find(Boolean);
  const season = seasonText ? Number.parseInt(seasonText, 10) : null;
  const episodes: number[] = [];
  for (const expression of [/\bS\d{1,2}\s*E(?:P)?\s*(\d{1,3})(?:\s*-\s*E?(\d{1,3}))?/giu, /第\s*(\d{1,3})(?:\s*[-~至]\s*(\d{1,3}))?\s*集/giu]) {
    for (const match of value.matchAll(expression)) addRange(episodes, match[1], match[2]);
  }
  return { season, episodes: [...new Set(episodes)].sort((a, b) => a - b) };
}

function addRange(target: number[], startText: string | undefined, endText: string | undefined): void {
  if (!startText) return;
  const start = Number.parseInt(startText, 10);
  const end = endText ? Number.parseInt(endText, 10) : start;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start > 500) return;
  for (let value = start; value <= end; value += 1) target.push(value);
}

function parseNumber(value: string | undefined, min: number, max: number): number | undefined {
  const result = value === undefined ? Number.NaN : Number.parseInt(value, 10);
  return Number.isSafeInteger(result) && result >= min && result <= max ? result : undefined;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("btbtla baseUrl must use HTTP(S).");
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  return code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || /timeout|timed out|abort/iu.test(error.name + error.message);
}
