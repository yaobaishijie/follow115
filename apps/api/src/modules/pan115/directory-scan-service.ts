import type { Pan115Item } from "./directory-model.js";
import { episodeKeys, parseVideoFile, type ParsedVideoFile } from "./file-parser.js";
import { readAllFolderPages, type Pan115FolderPageClient, type ReadAllFolderOptions } from "./list-folder.js";

/**
 * Read-only application service for scanning a 115 directory tree.  The
 * caller supplies the boundary client, so this module has no credentials,
 * network implementation, or file-mutating operations of its own.
 */
export interface Pan115DirectoryScanService {
  scan(input: Pan115DirectoryScanRequest): Promise<Pan115DirectoryScan>;
}

export interface Pan115DirectoryScanRequest extends ReadAllFolderOptions {
  cid: string;
  /** Path components above `cid`; retained for episode parsing and display. */
  parentPath?: readonly string[];
  maxDepth?: number;
  maxDirectories?: number;
  maxFiles?: number;
}

export interface ScannedPan115Video {
  item: Pan115Item;
  parentCid: string;
  parentPath: readonly string[];
  parsed: ParsedVideoFile;
  episodeKeys: readonly string[];
}

export interface Pan115DirectoryScan {
  rootCid: string;
  directoriesScanned: number;
  filesScanned: number;
  videos: readonly ScannedPan115Video[];
}

const positiveInteger = (value: number, name: string): void => {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer.`);
};

const nonNegativeInteger = (value: number, name: string): void => {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer.`);
};

/**
 * Creates a directory scanner around a read-only page client.  Limits make
 * scans deterministic even if a malformed remote tree contains a cycle.
 */
export function createPan115DirectoryScanService(client: Pan115FolderPageClient): Pan115DirectoryScanService {
  return {
    async scan(input: Pan115DirectoryScanRequest): Promise<Pan115DirectoryScan> {
      if (!input.cid) throw new RangeError("cid is required.");
      const maxDepth = input.maxDepth ?? 8;
      const maxDirectories = input.maxDirectories ?? 1_000;
      const maxFiles = input.maxFiles ?? 10_000;
      nonNegativeInteger(maxDepth, "maxDepth");
      positiveInteger(maxDirectories, "maxDirectories");
      positiveInteger(maxFiles, "maxFiles");

      const videos: ScannedPan115Video[] = [];
      const visitedCids = new Set<string>();
      let directoriesScanned = 0;
      let filesScanned = 0;

      const visit = async (cid: string, parentPath: readonly string[], depth: number): Promise<void> => {
        if (visitedCids.has(cid)) return;
        if (depth > maxDepth) throw new RangeError("Directory scan exceeded maxDepth.");
        if (directoriesScanned >= maxDirectories) throw new RangeError("Directory scan exceeded maxDirectories.");
        visitedCids.add(cid);
        directoriesScanned += 1;

        const items = await readAllFolderPages(client, cid, {
          ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
          ...(input.maxPages === undefined ? {} : { maxPages: input.maxPages })
        });
        for (const item of items) {
          if (item.isDirectory) {
            if (item.cid) await visit(item.cid, [...parentPath, item.name], depth + 1);
            continue;
          }

          if (filesScanned >= maxFiles) throw new RangeError("Directory scan exceeded maxFiles.");
          filesScanned += 1;
          const parsed = parseVideoFile(item.name, parentPath);
          if (!parsed.isFeature) continue;
          videos.push({ item, parentCid: cid, parentPath: [...parentPath], parsed, episodeKeys: parsed.episode ? episodeKeys(parsed.episode) : [] });
        }
      };

      await visit(input.cid, [...(input.parentPath ?? [])], 0);
      return { rootCid: input.cid, directoriesScanned, filesScanned, videos };
    }
  };
}
