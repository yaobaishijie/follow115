import type { Pan115Item } from "./directory-model.js";
import { type Pan115ShareInfoClient } from "./share-info.js";

export interface Pan115ShareExpandRequest {
  shareCode: string;
  receiveCode?: string;
  cid?: string;
  parentPath?: readonly string[];
  pageSize?: number;
  maxPages?: number;
  maxDepth?: number;
  maxDirectories?: number;
  maxFiles?: number;
}

export interface ExpandedPan115ShareFile {
  item: Pan115Item;
  parentCid: string | null;
  parentPath: readonly string[];
}

export interface Pan115ShareExpansion {
  rootCid: string | null;
  directoriesScanned: number;
  filesScanned: number;
  files: readonly ExpandedPan115ShareFile[];
}

export interface Pan115ShareExpandService {
  expand(input: Pan115ShareExpandRequest): Promise<Pan115ShareExpansion>;
}

const positiveInteger = (value: number, name: string): void => {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer.`);
};

const nonNegativeInteger = (value: number, name: string): void => {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer.`);
};

/**
 * Recursively reads a share tree through the read-only share-info client.
 * Parent paths are retained instead of flattening files so callers can infer a
 * season from directory names before deciding whether a file is eligible.
 */
export function createPan115ShareExpandService(client: Pan115ShareInfoClient): Pan115ShareExpandService {
  return {
    async expand(input: Pan115ShareExpandRequest): Promise<Pan115ShareExpansion> {
      if (!input.shareCode) throw new RangeError("shareCode is required.");
      const pageSize = input.pageSize ?? 200;
      const maxPages = input.maxPages ?? 100;
      const maxDepth = input.maxDepth ?? 4;
      const maxDirectories = input.maxDirectories ?? 1_000;
      const maxFiles = input.maxFiles ?? 10_000;
      positiveInteger(pageSize, "pageSize");
      positiveInteger(maxPages, "maxPages");
      nonNegativeInteger(maxDepth, "maxDepth");
      positiveInteger(maxDirectories, "maxDirectories");
      positiveInteger(maxFiles, "maxFiles");

      const files: ExpandedPan115ShareFile[] = [];
      const visitedCids = new Set<string>();
      let directoriesScanned = 0;
      let filesScanned = 0;

      const readDirectory = async (cid: string | undefined): Promise<readonly Pan115Item[]> => {
        const items: Pan115Item[] = [];
        for (let page = 0, offset = 0; page < maxPages; page += 1, offset += pageSize) {
          const result = await client.listShareInfoPage({
            shareCode: input.shareCode,
            ...(input.receiveCode === undefined ? {} : { receiveCode: input.receiveCode }),
            ...(cid === undefined ? {} : { cid }),
            offset,
            limit: pageSize
          });
          items.push(...result.items);
          if (result.items.length < pageSize || (result.total !== null && items.length >= result.total)) return items;
        }
        throw new RangeError("Share-info listing exceeded maxPages; refusing an unbounded scan.");
      };

      const visit = async (cid: string | undefined, parentPath: readonly string[], depth: number): Promise<void> => {
        const visitKey = cid ?? "__share_root__";
        if (visitedCids.has(visitKey)) return;
        if (depth > maxDepth) throw new RangeError("Share expansion exceeded maxDepth.");
        if (directoriesScanned >= maxDirectories) throw new RangeError("Share expansion exceeded maxDirectories.");
        visitedCids.add(visitKey);
        directoriesScanned += 1;

        for (const item of await readDirectory(cid)) {
          if (item.isDirectory) {
            if (item.cid) await visit(item.cid, [...parentPath, item.name], depth + 1);
            continue;
          }
          if (filesScanned >= maxFiles) throw new RangeError("Share expansion exceeded maxFiles.");
          filesScanned += 1;
          files.push({ item, parentCid: cid ?? null, parentPath: [...parentPath] });
        }
      };

      await visit(input.cid, [...(input.parentPath ?? [])], 0);
      return { rootCid: input.cid ?? null, directoriesScanned, filesScanned, files };
    }
  };
}
