import type { Pan115Item } from "./directory-model.js";

type UnknownRecord = Record<string, unknown>;

export interface Pan115FolderPage {
  items: readonly Pan115Item[];
  /** The number reported by 115, when supplied. */
  total: number | null;
  offset: number;
}

export interface Pan115FolderListResponse {
  data?: unknown;
  list?: unknown;
  count?: unknown;
}

const asRecord = (value: unknown): UnknownRecord => value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
const stringValue = (...values: unknown[]): string => {
  const value = values.find((candidate) => typeof candidate === "string" || typeof candidate === "number");
  return value === undefined ? "" : String(value);
};
const numberValue = (...values: unknown[]): number => {
  const value = values.find((candidate) => typeof candidate === "number" || typeof candidate === "string");
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

export function normalizePan115Item(raw: unknown): Pan115Item {
  const item = asRecord(raw);
  const cid = stringValue(item.cid, item.id);
  const fid = stringValue(item.fid, item.file_id, item.fileId, item.id);
  const isDirectory = item.is_dir === 1 || item.is_dir === "1" || item.isFolder === true || item.fc === 0 || item.fc === "0" || item.ico === "folder" || (cid !== "" && stringValue(item.fid, item.file_id, item.fileId) === "");
  return {
    id: isDirectory ? cid : fid,
    cid: isDirectory ? cid || null : stringValue(item.cid) || null,
    fid: isDirectory ? null : fid || null,
    name: stringValue(item.n, item.name, item.file_name, item.fileName, item.cname),
    isDirectory,
    size: isDirectory ? 0 : numberValue(item.s, item.size, item.file_size),
    pickCode: stringValue(item.pc, item.pick_code, item.pickCode) || null,
    raw
  };
}

export function normalizePan115FolderPage(response: Pan115FolderListResponse, offset = 0): Pan115FolderPage {
  const source = Array.isArray(response.data) ? response.data : Array.isArray(response.list) ? response.list : [];
  const reportedTotal = Number(response.count);
  return { items: source.map(normalizePan115Item), total: Number.isFinite(reportedTotal) && reportedTotal >= 0 ? reportedTotal : null, offset };
}

/** Read-only boundary. Its implementation is deliberately separate from the pure domain module. */
export interface Pan115FolderPageClient {
  listFolderPage(input: { cid: string; offset: number; limit: number }): Promise<Pan115FolderListResponse>;
}

export interface ReadAllFolderOptions { pageSize?: number; maxPages?: number; }

/** Paginates the 115 `/files` listing without assuming the historic 1150-item response is complete. */
export async function readAllFolderPages(client: Pan115FolderPageClient, cid: string, options: ReadAllFolderOptions = {}): Promise<readonly Pan115Item[]> {
  const pageSize = options.pageSize ?? 200;
  const maxPages = options.maxPages ?? 100;
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError("pageSize must be a positive integer.");
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new RangeError("maxPages must be a positive integer.");
  const items: Pan115Item[] = [];
  for (let page = 0, offset = 0; page < maxPages; page += 1, offset += pageSize) {
    const normalized = normalizePan115FolderPage(await client.listFolderPage({ cid, offset, limit: pageSize }), offset);
    items.push(...normalized.items);
    if (normalized.items.length < pageSize || (normalized.total !== null && items.length >= normalized.total)) return items;
  }
  throw new RangeError("Folder listing exceeded maxPages; refusing an unbounded scan.");
}
