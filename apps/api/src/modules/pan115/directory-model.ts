/** Pure domain models for the 115 media-library adapter. */

export const storageCategories = ["cn_drama", "us_drama", "jp_kr_drama", "tv", "variety", "animation", "documentary", "movie"] as const;
export type StorageCategory = (typeof storageCategories)[number];

export interface Pan115FolderMapping {
  category: StorageCategory;
  folderName: string;
  /** Display-only path, e.g. `影视库 / 国产剧`. */
  folderPath: string;
  /** The CID used by all adapter operations. */
  folderCid: string;
}

export interface Pan115Item {
  id: string;
  cid: string | null;
  fid: string | null;
  name: string;
  isDirectory: boolean;
  size: number;
  pickCode: string | null;
  raw: unknown;
}

export interface SeriesDirectoryIdentity {
  title: string;
  year: number | null;
  tmdbId: number | null;
}

export interface SeasonDirectoryIdentity extends SeriesDirectoryIdentity {
  seasonNumber: number;
  seasonYear: number | null;
}

const folderNames: Record<StorageCategory, string> = {
  cn_drama: "国产剧",
  us_drama: "美剧",
  jp_kr_drama: "日韩剧",
  tv: "电视剧",
  variety: "综艺",
  animation: "动漫",
  documentary: "纪录片",
  movie: "电影"
};

export function folderNameForCategory(category: StorageCategory): string {
  return folderNames[category];
}

export function buildSeriesFolderName(identity: SeriesDirectoryIdentity): string {
  const base = identity.year === null ? identity.title : `${identity.title} (${identity.year})`;
  return identity.tmdbId === null ? base : `${base} [tmdbid-${identity.tmdbId}]`;
}

export function buildSeasonFolderName(seasonNumber: number): string {
  if (!Number.isInteger(seasonNumber) || seasonNumber < 0 || seasonNumber > 99) throw new RangeError("seasonNumber must be an integer between 0 and 99.");
  return `Season ${String(seasonNumber).padStart(2, "0")}`;
}

export interface MediaClassificationInput {
  mediaType?: "series" | "movie" | string | null;
  /** A hot-list source category may be trusted as a stronger classification signal. */
  sourceCategory?: string | null;
  regions?: readonly string[] | null;
  genres?: readonly string[] | null;
  title?: string | null;
}

const includesOne = (values: readonly string[], terms: readonly string[]): boolean => values.some((value) => terms.some((term) => value.includes(term)));

/** Implements PRD 8.2's ordered category rules. The result is persisted on first subscription. */
export function inferStorageCategory(input: MediaClassificationInput): StorageCategory {
  const values = [input.sourceCategory, ...(input.regions ?? []), ...(input.genres ?? []), input.title]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.normalize("NFKC").toLowerCase());
  const type = input.mediaType?.toLowerCase();
  if (type === "movie" || includesOne(values, ["电影", "movie", "film"])) return "movie";
  if (includesOne(values, ["纪录片", "documentary", "docu"])) return "documentary";
  if (includesOne(values, ["动画", "动漫", "animation", "anime"])) return "animation";
  if (includesOne(values, ["综艺", "真人秀", "variety", "reality"])) return "variety";
  if (includesOne(values, ["中国大陆", "中国", "大陆", "国产", "china", "chinese"])) return "cn_drama";
  if (includesOne(values, ["美国", "美剧", "united states", "usa", "american"])) return "us_drama";
  if (includesOne(values, ["日本", "韩国", "日韩", "日剧", "韩剧", "japan", "korea", "japanese", "korean"])) return "jp_kr_drama";
  return "tv";
}
