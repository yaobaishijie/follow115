import { AppError } from "@follow115/contracts";
import { buildSeasonFolderName, buildSeriesFolderName } from "../pan115/directory-model.js";
import { parseSeasonFromPath } from "../pan115/file-parser.js";
import { readAllFolderPages, type Pan115FolderPageClient } from "../pan115/list-folder.js";
import type { Pan115FolderWriteClient } from "../pan115/folder-write-client.js";
import type { CredentialStore } from "../settings/settings-service.js";

export interface SubscriptionDirectoryBindingInput {
  mediaType: "series" | "movie";
  title: string;
  year: number | null;
  tmdbId: number | null;
  seasonNumber: number;
  categoryFolderCid: string;
  categoryFolderPath: string;
  existingSeriesCid?: string | null;
  existingSeriesPath?: string | null;
}

export interface SubscriptionDirectoryBinding {
  targetSeriesCid: string;
  targetSeriesPath: string;
  targetSeasonCid: string;
  targetSeasonPath: string;
}

export interface SubscriptionDirectoryBinder {
  bind(input: SubscriptionDirectoryBindingInput): Promise<SubscriptionDirectoryBinding>;
}

/** PRD §8.4 directory reuse/create workflow. It never renames an existing directory. */
export class Pan115SubscriptionDirectoryBinder implements SubscriptionDirectoryBinder {
  constructor(
    private readonly credentials: CredentialStore,
    private readonly createReader: (cookie: string) => Pan115FolderPageClient,
    private readonly createWriter: (cookie: string) => Pan115FolderWriteClient
  ) {}

  async bind(input: SubscriptionDirectoryBindingInput): Promise<SubscriptionDirectoryBinding> {
    const credential = await this.credentials.getPan115Credential();
    if (!credential) throw new AppError("CONFIGURATION_REQUIRED", "Configure and verify a 115 cookie before following.");
    const reader = this.createReader(credential.cookie);
    const writer = this.createWriter(credential.cookie);
    let targetSeriesCid = input.existingSeriesCid ?? null;
    let targetSeriesPath = input.existingSeriesPath ?? null;
    if (!targetSeriesCid) {
      const expected = buildSeriesFolderName({ title: input.title, year: input.year, tmdbId: input.tmdbId });
      const folders = (await readAllFolderPages(reader, input.categoryFolderCid)).filter((item) => item.isDirectory);
      const matched = matchSeriesDirectory(folders.map((item) => ({ cid: item.cid ?? item.id, name: item.name })), input);
      if (matched) targetSeriesCid = matched.cid;
      else targetSeriesCid = (await writer.createFolder(input.categoryFolderCid, expected)).cid;
      targetSeriesPath = joinPath(input.categoryFolderPath, matched?.name ?? expected);
    }
    if (!targetSeriesPath) targetSeriesPath = joinPath(input.categoryFolderPath, buildSeriesFolderName({ title: input.title, year: input.year, tmdbId: input.tmdbId }));
    if (input.mediaType === "movie") {
      return { targetSeriesCid, targetSeriesPath, targetSeasonCid: targetSeriesCid, targetSeasonPath: targetSeriesPath };
    }
    const seasonName = buildSeasonFolderName(input.seasonNumber);
    const seasonFolders = (await readAllFolderPages(reader, targetSeriesCid)).filter((item) => item.isDirectory && parseSeasonFromPath([item.name]) === input.seasonNumber);
    const exact = seasonFolders.find((item) => normalize(item.name) === normalize(seasonName));
    if (!exact && seasonFolders.length > 1) throw new AppError("CONFLICT", "Multiple existing 115 folders match the requested Season.");
    const targetSeasonCid = exact?.cid ?? exact?.id ?? seasonFolders[0]?.cid ?? seasonFolders[0]?.id
      ?? (await writer.createFolder(targetSeriesCid, seasonName)).cid;
    const actualSeasonName = exact?.name ?? seasonFolders[0]?.name ?? seasonName;
    return { targetSeriesCid, targetSeriesPath, targetSeasonCid, targetSeasonPath: joinPath(targetSeriesPath, actualSeasonName) };
  }
}

function matchSeriesDirectory(folders: readonly { cid: string; name: string }[], input: Pick<SubscriptionDirectoryBindingInput, "title" | "year" | "tmdbId">): { cid: string; name: string } | null {
  if (input.tmdbId !== null) {
    const tmdb = folders.filter((folder) => new RegExp(`\\[tmdbid-${input.tmdbId}\\]`, "iu").test(normalize(folder.name)));
    if (tmdb.length === 1) return tmdb[0]!;
    if (tmdb.length > 1) throw new AppError("CONFLICT", "Multiple 115 Series folders use the same TMDB ID.");
  }
  const base = normalize(input.year === null ? input.title : `${input.title} (${input.year})`);
  const exact = folders.filter((folder) => {
    const name = normalize(folder.name);
    return name === base || name.startsWith(`${base} [tmdbid-`);
  });
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) throw new AppError("CONFLICT", "Multiple 115 Series folders match the title and year.");
  if (input.year !== null) return null;
  const weak = folders.filter((folder) => normalize(folder.name).replace(/\s*\(\d{4}\)(?:\s*\[tmdbid-\d+\])?$/iu, "") === normalize(input.title));
  if (weak.length === 1) return weak[0]!;
  if (weak.length > 1) throw new AppError("CONFLICT", "A year is required to choose between multiple matching 115 Series folders.");
  return null;
}

const normalize = (value: string): string => value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
const joinPath = (parent: string, child: string): string => `${parent.replace(/\s*\/\s*$/u, "")} / ${child}`;
