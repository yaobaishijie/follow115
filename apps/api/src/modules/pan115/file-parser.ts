export const VIDEO_EXTENSIONS = new Set(["mkv", "mp4", "ts", "mov", "m2ts"]);
const NON_FEATURE_TERMS = ["预告", "trailer", "花絮", "behind", "sample", "片段"];

export interface EpisodeRange { season: number; episodeStart: number; episodeEnd: number; }
export interface ParsedVideoFile { extension: string; quality: "2160p" | "1080p" | "720p" | "unknown"; episode: EpisodeRange | null; isFeature: boolean; }

export function sanitizeFileName(value: string): string {
  return value.normalize("NFKC").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

export function extensionOf(fileName: string): string {
  const match = fileName.normalize("NFKC").match(/\.([a-z0-9]{2,6})$/i);
  return match?.[1]?.toLowerCase() ?? "";
}

export function isVideoFile(fileName: string): boolean { return VIDEO_EXTENSIONS.has(extensionOf(fileName)); }
export function isFeatureVideo(fileName: string): boolean { const lower = fileName.normalize("NFKC").toLowerCase(); return isVideoFile(fileName) && !NON_FEATURE_TERMS.some((term) => lower.includes(term)); }

export function detectQuality(fileName: string): ParsedVideoFile["quality"] {
  const text = fileName.normalize("NFKC");
  if (/\b(4k|2160p|uhd)\b/i.test(text)) return "2160p";
  if (/\b(1080p|fhd)\b/i.test(text)) return "1080p";
  if (/\b720p\b/i.test(text)) return "720p";
  return "unknown";
}

export function parseSeasonFromPath(parentPath: readonly string[]): number | null {
  for (const segment of [...parentPath].reverse()) {
    const text = segment.normalize("NFKC");
    const match = text.match(/(?:season\s*|s)(\d{1,2})\b/i) ?? text.match(/第\s*(\d{1,2})\s*[季部]/);
    if (match) return Number(match[1]);
    const chineseMatch = text.match(/第\s*([一二三四五六七八九十])\s*[季部]/);
    if (chineseMatch) {
      const value = ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 } as const)[chineseMatch[1] as "一" | "二" | "三" | "四" | "五" | "六" | "七" | "八" | "九" | "十"];
      return value;
    }
  }
  return null;
}

export function parseEpisodeRange(fileName: string, parentPath: readonly string[] = []): EpisodeRange | null {
  const text = fileName.normalize("NFKC");
  let match = text.match(/\bS(\d{1,2})\s*E(\d{1,3})(?:\s*[-~]\s*E?(\d{1,3}))?\b/i);
  if (match) return { season: Number(match[1]), episodeStart: Number(match[2]), episodeEnd: Number(match[3] ?? match[2]) };
  // Some releases put the season only in the directory and use E01-E02 in
  // the file name.  Retain that authoritative parent-path season instead of
  // dropping a legitimate multi-episode file.
  match = text.match(/\bE(?:P)?\s*(\d{1,3})(?:\s*[-~]\s*E?(?:P)?\s*(\d{1,3}))?\b/i);
  if (match) {
    const season = parseSeasonFromPath(parentPath) ?? 1;
    return { season, episodeStart: Number(match[1]), episodeEnd: Number(match[2] ?? match[1]) };
  }
  match = text.match(/season\s*(\d{1,2}).*?(?:ep?|episode|第)\s*(\d{1,3})/i) ?? text.match(/第\s*(\d{1,2})\s*[季部].*?第\s*(\d{1,3})\s*[集话]/);
  if (match) return { season: Number(match[1]), episodeStart: Number(match[2]), episodeEnd: Number(match[2]) };
  match = text.match(/第\s*(\d{1,3})\s*[集话]/) ?? text.match(/\bEP?\s*(\d{1,3})\b/i);
  if (!match) return null;
  const season = parseSeasonFromPath(parentPath) ?? 1;
  return { season, episodeStart: Number(match[1]), episodeEnd: Number(match[1]) };
}

export function episodeKeys(range: EpisodeRange): string[] {
  if (range.season < 0 || range.episodeStart < 1 || range.episodeEnd < range.episodeStart) return [];
  return Array.from({ length: range.episodeEnd - range.episodeStart + 1 }, (_, index) => `S${String(range.season).padStart(2, "0")}E${String(range.episodeStart + index).padStart(2, "0")}`);
}

export function parseVideoFile(fileName: string, parentPath: readonly string[] = []): ParsedVideoFile {
  return { extension: extensionOf(fileName), quality: detectQuality(fileName), episode: parseEpisodeRange(fileName, parentPath), isFeature: isFeatureVideo(fileName) };
}

export function buildEpisodeFileName(input: { title: string; year: number | null; season: number; episodeStart: number; episodeEnd?: number; extension: string; quality?: ParsedVideoFile["quality"] }): string {
  const title = input.year === null ? input.title : `${input.title} (${input.year})`;
  const episodes = input.episodeEnd !== undefined && input.episodeEnd !== input.episodeStart ? `S${String(input.season).padStart(2, "0")}E${String(input.episodeStart).padStart(2, "0")}-E${String(input.episodeEnd).padStart(2, "0")}` : `S${String(input.season).padStart(2, "0")}E${String(input.episodeStart).padStart(2, "0")}`;
  const quality = input.quality && input.quality !== "unknown" ? ` [${input.quality}]` : "";
  return `${sanitizeFileName(`${title} - ${episodes}${quality}`)}.${input.extension.toLowerCase()}`;
}
