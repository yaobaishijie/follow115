import type { Pan115Share, ResourceCandidateContext, ResourceCandidateInput } from "@follow115/contracts";
import { parseVideoFile, type ParsedVideoFile } from "../pan115/file-parser.js";
import type { Pan115ShareExpandService } from "../pan115/share-expand-service.js";

export interface ExpandedTelegramShare {
  share: Pan115Share;
  messageText: string;
  channelSortOrder: number;
}

/**
 * PRD §9.9 read-only bridge: only a share whose expanded files contain
 * feature videos for the current season becomes a candidate input.  It has no
 * save endpoint and therefore cannot transfer a file to the user's 115 disk.
 */
export class Pan115ShareCandidateBuilder {
  constructor(private readonly shares: Pick<Pan115ShareExpandService, "expand">) {}

  async build(
    discovered: ExpandedTelegramShare,
    context: Pick<ResourceCandidateContext, "mediaType" | "seasonNumber">
  ): Promise<ResourceCandidateInput | null> {
    const expansion = await this.shares.expand({
      shareCode: discovered.share.shareCode,
      ...(discovered.share.receiveCode ? { receiveCode: discovered.share.receiveCode } : {})
    });

    const videos = expansion.files
      .map((file) => ({ file, parsed: parseVideoFile(file.item.name, file.parentPath) }))
      .filter(({ parsed }) => isEligibleSeasonVideo(parsed, context));
    if (videos.length === 0) return null;

    const episodes = unique(videos.flatMap(({ parsed }) => rangeEpisodes(parsed)));
    if (context.mediaType === "series" && episodes.length === 0) return null;
    const quality = bestQuality(videos.map(({ parsed }) => parsed.quality));
    // Retain source text for title/group matching, but derive season/episodes
    // strictly from the expanded 115 files and their parent paths.
    const title = `${discovered.messageText} ${videos.map(({ file }) => file.item.name).join(" ")} [${quality}]`.trim();
    return {
      source: "pan115",
      title,
      shareUrl: discovered.share.url,
      availableEpisodes: episodes,
      ...(context.seasonNumber === undefined ? {} : { parsedSeason: context.seasonNumber }),
      channelSortOrder: discovered.channelSortOrder
    };
  }
}

function isEligibleSeasonVideo(parsed: ParsedVideoFile, context: Pick<ResourceCandidateContext, "mediaType" | "seasonNumber">): boolean {
  if (!parsed.isFeature) return false;
  if (context.mediaType === "movie") return true;
  return parsed.episode !== null && context.seasonNumber !== undefined && parsed.episode.season === context.seasonNumber;
}

function rangeEpisodes(parsed: ParsedVideoFile): number[] {
  if (!parsed.episode) return [];
  const { episodeStart, episodeEnd } = parsed.episode;
  if (episodeStart < 1 || episodeEnd < episodeStart || episodeEnd - episodeStart > 500) return [];
  return Array.from({ length: episodeEnd - episodeStart + 1 }, (_, index) => episodeStart + index);
}

function bestQuality(qualities: readonly ParsedVideoFile["quality"][]): ParsedVideoFile["quality"] {
  if (qualities.includes("2160p")) return "2160p";
  if (qualities.includes("1080p")) return "1080p";
  if (qualities.includes("720p")) return "720p";
  return "unknown";
}

function unique(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}
