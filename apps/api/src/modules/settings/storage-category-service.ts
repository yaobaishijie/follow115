import { AppError } from "@follow115/contracts";
import { storageCategories, type StorageCategory } from "../pan115/directory-model.js";

export interface StorageCategoryMapping {
  key: StorageCategory;
  label: string;
  folderCid: string;
  folderPath: string;
  configured: boolean;
}

export interface StorageCategoryMappingStore {
  saveStorageCategoryMapping(mapping: StorageCategoryMapping): Promise<void>;
}

const labels: Record<StorageCategory, string> = {
  cn_drama: "国产剧", us_drama: "美剧", jp_kr_drama: "日韩剧", tv: "电视剧",
  variety: "综艺", animation: "动漫", documentary: "纪录片", movie: "电影"
};

const hasControlCharacters = (value: string): boolean => [...value].some((character) => character.charCodeAt(0) < 32);

export function storageCategoryKey(value: string): StorageCategory {
  if (!(storageCategories as readonly string[]).includes(value)) {
    throw new AppError("NOT_FOUND", "Storage category was not found.");
  }
  return value as StorageCategory;
}

function validCid(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,19}$|^0$/.test(value);
}

/** Validates a display-only path while keeping it independent of local filesystem syntax. */
export function normalizedFolderPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 512 || hasControlCharacters(value)) {
    throw new AppError("VALIDATION_ERROR", "folderPath must be a valid 115 folder path.");
  }
  const segments = value.split(/[\\/]/).map((segment) => segment.trim()).filter(Boolean);
  if (segments.length < 2 || segments.length > 20 || segments[0] !== "影视库" || segments.some((segment) => segment === "." || segment === ".." || segment.length > 120)) {
    throw new AppError("VALIDATION_ERROR", "folderPath must be a path under 影视库.");
  }
  return segments.join(" / ");
}

export class StorageCategoryService {
  constructor(private readonly store: StorageCategoryMappingStore) {}

  async save(keyValue: string, input: { folderCid?: unknown; folderPath?: unknown }): Promise<StorageCategoryMapping> {
    const key = storageCategoryKey(keyValue);
    if (!validCid(input.folderCid)) throw new AppError("VALIDATION_ERROR", "folderCid must be a 115 folder CID.");
    const mapping: StorageCategoryMapping = {
      key, label: labels[key], folderCid: input.folderCid, folderPath: normalizedFolderPath(input.folderPath), configured: true
    };
    await this.store.saveStorageCategoryMapping(mapping);
    return mapping;
  }
}

export class InMemoryStorageCategoryMappingStore implements StorageCategoryMappingStore {
  readonly mappings = new Map<StorageCategory, StorageCategoryMapping>();
  async saveStorageCategoryMapping(mapping: StorageCategoryMapping): Promise<void> { this.mappings.set(mapping.key, mapping); }
}
