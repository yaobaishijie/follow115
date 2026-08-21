export type CleanupQuality = "2160p" | "1080p" | "unknown";

export interface ScannedMediaFile {
  fileId: string;
  name: string;
  episodeKeys: readonly string[];
  quality: CleanupQuality;
  addedAt: Date | string | null;
  isVideo: boolean;
  isParseable: boolean;
}

export interface GeneratedCleanupCandidate {
  subscriptionId: string;
  episodeKey: string;
  keepFileId: string;
  removeFileId: string;
  keepQuality: Exclude<CleanupQuality, "unknown">;
  removeQuality: Exclude<CleanupQuality, "unknown">;
  reason: string;
}

type EligibleFile = ScannedMediaFile & { quality: Exclude<CleanupQuality, "unknown">; addedAtMs: number | null };

/**
 * PRD §7.3–7.4: emit only deterministic single-episode video duplicates.
 * Unknown quality and malformed date evidence never become a same-quality
 * cleanup action. Multi-episode packages are intentionally excluded because
 * the schema represents one duplicate episode per removable file.
 */
export function generateDuplicateCleanupCandidates(subscriptionId: string, files: readonly ScannedMediaFile[]): GeneratedCleanupCandidate[] {
  if (!subscriptionId.trim()) throw new RangeError("subscriptionId is required.");
  const byEpisode = new Map<string, ScannedMediaFile[]>();
  for (const file of files) {
    const episodeKeys = [...new Set(file.episodeKeys.filter((key) => key.trim()))];
    if (!file.fileId.trim() || !file.isVideo || !file.isParseable || episodeKeys.length !== 1) continue;
    const episode = episodeKeys[0]!;
    byEpisode.set(episode, [...(byEpisode.get(episode) ?? []), file]);
  }
  const candidates: GeneratedCleanupCandidate[] = [];
  for (const [episodeKey, group] of byEpisode) {
    // An unknown quality makes the comparison unsafe. Do not clean any file
    // from that episode until a later scan has enough evidence.
    if (group.some((file) => file.quality === "unknown")) continue;
    const eligible: EligibleFile[] = group.map((file) => ({
      ...file,
      quality: file.quality as Exclude<CleanupQuality, "unknown">,
      addedAtMs: timestamp(file.addedAt),
    }));
    if (eligible.length < 2) continue;
    const highestRank = Math.max(...eligible.map((file) => qualityRank(file.quality)));
    const highest = eligible.filter((file) => qualityRank(file.quality) === highestRank);
    // To deduplicate same-quality files, every tie must have trusted addedAt.
    const keep = highest.every((file) => file.addedAtMs !== null)
      ? highest.slice().sort(compareOldest)[0]!
      : highest[0]!;
    const lower = eligible.filter((file) => qualityRank(file.quality) < highestRank);
    for (const remove of lower) candidates.push(candidate(subscriptionId, episodeKey, keep, remove, `保留 ${label(keep.quality)}，清理较低画质 ${label(remove.quality)}`));
    // Same highest-quality duplicates can only be cleaned when their addition times are complete.
    if (highest.every((file) => file.addedAtMs !== null)) {
      for (const remove of highest.filter((file) => file.fileId !== keep.fileId)) candidates.push(candidate(subscriptionId, episodeKey, keep, remove, `保留 ${label(keep.quality)} 较早加入版本，清理同画质后加入版本`));
    }
  }
  return candidates;
}

function candidate(subscriptionId: string, episodeKey: string, keep: EligibleFile, remove: EligibleFile, reason: string): GeneratedCleanupCandidate {
  return { subscriptionId, episodeKey, keepFileId: keep.fileId, removeFileId: remove.fileId, keepQuality: keep.quality, removeQuality: remove.quality, reason };
}
function qualityRank(value: Exclude<CleanupQuality, "unknown">): number { return value === "2160p" ? 2 : 1; }
function label(value: Exclude<CleanupQuality, "unknown">): string { return value === "2160p" ? "2160P" : "1080P"; }
function timestamp(value: Date | string | null): number | null { const time = value === null ? Number.NaN : new Date(value).getTime(); return Number.isFinite(time) ? time : null; }
function compareOldest(a: EligibleFile, b: EligibleFile): number { return a.addedAtMs! - b.addedAtMs! || a.fileId.localeCompare(b.fileId); }
