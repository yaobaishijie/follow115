import { AppError } from "@follow115/contracts";
import type { CredentialStore } from "../settings/settings-service.js";
import { readAllFolderPages, type Pan115FolderPageClient } from "./list-folder.js";

export interface Pan115FolderBrowser { list(input: { cid: unknown; path: unknown }): Promise<Array<{ cid: string; name: string; path: string }>>; }

const hasControlCharacters = (value: string): boolean => [...value].some((character) => character.charCodeAt(0) < 32);

function cid(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,19})$/.test(value)) throw new AppError("VALIDATION_ERROR", "cid must be a 115 folder CID.");
  return value;
}

function path(value: unknown): string {
  if (value === undefined) return "115";
  if (typeof value !== "string" || value.length > 512 || hasControlCharacters(value)) throw new AppError("VALIDATION_ERROR", "path must be a valid folder path.");
  const segments = value.split(/[\\/]/).map((part) => part.trim()).filter(Boolean);
  if (segments.length === 0 || segments.length > 20 || segments.some((part) => part === "." || part === ".." || part.length > 120)) throw new AppError("VALIDATION_ERROR", "path must be a valid folder path.");
  return segments.join(" / ");
}

/** Uses only the saved credential and the read-only `/files` port. */
export class SavedCredentialPan115FolderBrowser implements Pan115FolderBrowser {
  constructor(private readonly credentials: CredentialStore, private readonly createClient: (cookie: string) => Pan115FolderPageClient) {}
  async list(input: { cid: unknown; path: unknown }): Promise<Array<{ cid: string; name: string; path: string }>> {
    const credential = await this.credentials.getPan115Credential();
    if (credential === null) throw new AppError("CONFIGURATION_REQUIRED", "Configure and test a 115 cookie before browsing folders.");
    const parentCid = cid(input.cid);
    const parentPath = path(input.path);
    const items = await readAllFolderPages(this.createClient(credential.cookie), parentCid);
    return items.filter((item) => item.isDirectory && item.cid !== null && item.name.trim() !== "").map((item) => ({ cid: item.cid!, name: item.name, path: `${parentPath} / ${item.name}` }));
  }
}
