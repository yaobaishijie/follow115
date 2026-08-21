import type {
  CandidateRejectionReason,
  NormalizedResourceCandidate,
  Pan115Share,
  QualityTier,
  ResourceCandidateContext,
  ResourceCandidateInput,
  ResourceFailureRecord
} from "@follow115/contracts";

export type {
  CandidateRejectionReason,
  NormalizedResourceCandidate,
  Pan115Share,
  ResourceCandidateContext as CandidateContext,
  ResourceCandidateInput,
  ResourceFailureRecord
} from "@follow115/contracts";

/**
 * Pure resource-candidate utilities.  They deliberately know nothing about
 * HTTP, 115 credentials, persistence, or job execution.
 */

const pan115Host = /^(?:www\.)?(?:115\.com|anxia\.com|115cdn\.com)$/i;
const trailingUrlPunctuation = /[),.!;:，。；：）]+$/u;
const infoHashPattern = /(?:xt=urn:btih:|btih:)([a-f0-9]{40})(?:&|$)/i;
const bareInfoHashPattern = /^[a-f0-9]{40}$/i;

/** Parses only the PRD-approved 115 share URL form. */
export function parsePan115ShareUrl(value: string): Pan115Share | null {
  const urlText = value.trim().replace(trailingUrlPunctuation, "");
  let parsed: URL;
  try {
    parsed = new URL(urlText);
  } catch {
    return null;
  }
  if (!pan115Host.test(parsed.hostname)) return null;
  const match = /^\/s\/([A-Za-z0-9_-]+)\/?$/u.exec(parsed.pathname);
  if (!match?.[1]) return null;
  const password = parsed.searchParams.get("password")?.trim();
  return {
    shareCode: match[1],
    ...(password ? { receiveCode: password } : {}),
    url: parsed.toString()
  };
}

/** Returns de-duplicated PRD-approved 115 shares in first-seen order. */
export function extractPan115Shares(text: string): Pan115Share[] {
  const urls = text.match(/https?:\/\/[^\s<>"']+/giu) ?? [];
  const seen = new Set<string>();
  const shares: Pan115Share[] = [];
  for (const url of urls) {
    const share = parsePan115ShareUrl(url);
    if (share && !seen.has(share.shareCode)) {
      seen.add(share.shareCode);
      shares.push(share);
    }
  }
  return shares;
}

export function normalizeInfoHash(value: string): string | null {
  const trimmed = value.trim();
  if (bareInfoHashPattern.test(trimmed)) return trimmed.toLowerCase();
  const match = infoHashPattern.exec(trimmed);
  return match?.[1]?.toLowerCase() ?? null;
}

export function detectResourceQuality(title: string): QualityTier | "below_1080p" {
  const normalized = title.toLowerCase();
  if (/\b(?:2160p|4k|uhd)\b|3840\s*[x×]\s*2160/u.test(normalized)) return "2160p";
  if (/\b(?:1080p|fhd)\b|1920\s*[x×]\s*1080/u.test(normalized)) return "1080p";
  if (/\b(?:720p|576p|480p|360p)\b|(?:1280\s*[x×]\s*720|854\s*[x×]\s*480)/u.test(normalized)) return "below_1080p";
  return "unknown";
}

/**
 * Extracts only btbtla's internal detail paths.  Network fetching and page
 * traversal belong to an adapter, not this helper.
 */
export function extractBtbtlaDetailPaths(html: string): string[] {
  return extractBtbtlaPaths(html, /\/detail\/[^"'?#\s<>]+\.html(?:\?[^"'#\s<>]*)?/giu);
}

/** Extracts only btbtla's internal torrent-download paths. */
export function extractBtbtlaDownloadPaths(html: string): string[] {
  return extractBtbtlaPaths(html, /\/tdown\/[^"'?#\s<>]+(?:\?[^"'#\s<>]*)?/giu);
}

/** Extracts unique magnet links from HTML in first-seen order. */
export function extractBtbtlaMagnets(html: string): string[] {
  const matches = html.match(/magnet:\?[^"'\s<>]+/giu) ?? [];
  return unique(matches.map((entry) => entry.replace(/&amp;/giu, "&")));
}

function extractBtbtlaPaths(html: string, expression: RegExp): string[] {
  return unique(html.match(expression) ?? []);
}

export function normalizeResourceCandidate(
  input: ResourceCandidateInput,
  context: ResourceCandidateContext
): NormalizedResourceCandidate {
  const quality = detectResourceQuality(input.title);
  const share = input.shareUrl ? parsePan115ShareUrl(input.shareUrl) : null;
  const candidateKey = input.source === "pan115"
    ? (share?.shareCode ?? "")
    : (input.magnet ? normalizeInfoHash(input.magnet) ?? "" : "");
  const parsed = parseEpisodesAndSeason(input.title);
  const parsedSeason = input.parsedSeason ?? parsed.season;
  const episodes = uniqueNumbers(input.availableEpisodes ?? parsed.episodes);
  const missing = uniqueNumbers(context.missingEpisodes ?? []);
  const covered = new Set(episodes);
  const missingCoverageCount = missing.filter((episode) => covered.has(episode)).length;
  const rejectionReason = candidateRejectionReason({ input, context, candidateKey, share, parsedSeason, episodes, quality });

  return {
    source: input.source,
    candidateKey,
    title: input.title,
    ...(share ? { share } : {}),
    ...(input.source === "magnet" && input.magnet ? { magnet: input.magnet } : {}),
    quality: quality === "below_1080p" ? "unknown" : quality,
    parsedSeason,
    episodes,
    isSeasonPackage: /(?:\bcomplete\b|\bcomplete\s+season\b|全集|全\s*\d+\s*集|完结)/iu.test(input.title),
    coversAllMissing: missing.length > 0 && missingCoverageCount === missing.length,
    missingCoverageCount,
    channelSortOrder: input.channelSortOrder ?? Number.MAX_SAFE_INTEGER,
    preferredGroupMatched: Boolean(context.preferredGroupKey && input.groupKey === context.preferredGroupKey),
    ...(rejectionReason ? { rejectionReason } : {})
  };
}

/** PRD 9.8 comparator: complete coverage takes precedence over quality. */
export function compareResourceCandidates(a: NormalizedResourceCandidate, b: NormalizedResourceCandidate): number {
  return Number(b.coversAllMissing) - Number(a.coversAllMissing)
    || b.missingCoverageCount - a.missingCoverageCount
    || Number(b.isSeasonPackage) - Number(a.isSeasonPackage)
    || qualityRank(b.quality) - qualityRank(a.quality)
    || a.channelSortOrder - b.channelSortOrder
    || Number(b.preferredGroupMatched) - Number(a.preferredGroupMatched)
    || a.candidateKey.localeCompare(b.candidateKey);
}

export function sortEligibleResourceCandidates(candidates: readonly NormalizedResourceCandidate[]): NormalizedResourceCandidate[] {
  return candidates.filter((candidate) => !candidate.rejectionReason).slice().sort(compareResourceCandidates);
}

/** Only confirmed resource failures count; two consecutive failures are permanent. */
export function isPermanentlyBlacklisted(record: ResourceFailureRecord | null | undefined): boolean {
  return Boolean(record && (record.isBlacklisted || record.failureCount >= 2));
}

function candidateRejectionReason(args: {
  input: ResourceCandidateInput;
  context: ResourceCandidateContext;
  candidateKey: string;
  share: Pan115Share | null;
  parsedSeason: number | null;
  episodes: readonly number[];
  quality: QualityTier | "below_1080p";
}): CandidateRejectionReason | undefined {
  if (!args.candidateKey) return "missing_candidate_key";
  if (args.input.source === "pan115" && !args.share) return "not_115_share";
  if (args.quality === "below_1080p") return "below_1080p";
  if (!matchesTitle(args.input.title, args.context.title, args.context.aliases ?? [])) return "title_mismatch";
  if (args.context.mediaType === "series") {
    if (args.context.seasonNumber === undefined || args.parsedSeason !== args.context.seasonNumber) return "season_mismatch";
    if (args.episodes.length === 0) return "episode_missing";
  }
  return undefined;
}

function parseEpisodesAndSeason(title: string): { season: number | null; episodes: number[] } {
  const seasonMatch = /(?:\bS(\d{1,2})(?=\s*E|\b|[_ .-])|\bseason\s*(\d{1,2})|第\s*(\d{1,2})\s*季)/iu.exec(title);
  const seasonText = seasonMatch?.[1] ?? seasonMatch?.[2] ?? seasonMatch?.[3];
  const season = seasonText ? Number.parseInt(seasonText, 10) : null;
  const episodes: number[] = [];
  const expressions = [
    /\bS\d{1,2}\s*E(?:P)?\s*(\d{1,3})(?:\s*-\s*E?(\d{1,3}))?/giu,
    /第\s*(\d{1,3})(?:\s*[-~至]\s*(\d{1,3}))?\s*集/giu
  ];
  for (const expression of expressions) {
    for (const match of title.matchAll(expression)) addEpisodeRange(episodes, match[1], match[2]);
  }
  return { season, episodes: uniqueNumbers(episodes) };
}

function addEpisodeRange(target: number[], startText: string | undefined, endText: string | undefined): void {
  if (!startText) return;
  const start = Number.parseInt(startText, 10);
  const end = endText ? Number.parseInt(endText, 10) : start;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start > 500) return;
  for (let episode = start; episode <= end; episode += 1) target.push(episode);
}

function matchesTitle(candidateTitle: string, title: string, aliases: readonly string[]): boolean {
  const normalizedCandidate = normalizeTitle(candidateTitle);
  return [title, ...aliases]
    .map(normalizeTitle)
    .filter((value) => value.length > 0)
    .some((value) => normalizedCandidate.includes(value));
}

function normalizeTitle(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function qualityRank(quality: QualityTier): number {
  return quality === "2160p" ? 3 : quality === "1080p" ? 2 : 1;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function uniqueNumbers(values: readonly number[]): number[] {
  return unique(values.filter((value) => Number.isSafeInteger(value) && value > 0)).sort((a, b) => a - b);
}
