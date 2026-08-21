import {
  normalizePan115FolderPage,
  type Pan115FolderListResponse,
  type Pan115FolderPage
} from "./list-folder.js";
import type { Pan115Item } from "./directory-model.js";

type UnknownRecord = Record<string, unknown>;

/** The complete and deliberately small query surface for the share-info API. */
export interface Pan115ShareInfoPageRequest {
  shareCode: string;
  receiveCode?: string;
  /** The shared-folder id. Omit it when reading the share root. */
  cid?: string;
  offset: number;
  limit: number;
}

export interface Pan115ShareInfoHttpClient {
  get(input: { path: string; query: Readonly<Record<string, string | number>> }): Promise<unknown>;
}

export interface Pan115ShareInfoPage {
  items: readonly Pan115Item[];
  total: number | null;
  offset: number;
}

export interface Pan115ShareInfoClient {
  listShareInfoPage(input: Pan115ShareInfoPageRequest): Promise<Pan115ShareInfoPage>;
}

export interface Pan115ShareInfoAdapterOptions {
  /** The path remains overridable for tests; production's verified default is `/share/snap`. */
  path?: string;
}

/** Read-only share listing endpoint independently verified from the legacy service. */
export const PAN115_SHARE_SNAP_PATH = "/share/snap";

const asRecord = (value: unknown): UnknownRecord => value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};

/**
 * Normalizes both direct list payloads and the common `{ data: { list, count } }`
 * envelope without coupling domain code to an unverified upstream response shape.
 */
export function normalizePan115ShareInfoPage(response: unknown, offset = 0): Pan115ShareInfoPage {
  const root = asRecord(response);
  const nested = asRecord(root.data);
  const payload: Pan115FolderListResponse = Array.isArray(root.data)
    ? { data: root.data, list: root.list, count: root.count }
    : { data: nested.data, list: nested.list ?? root.list, count: nested.count ?? root.count };
  const page: Pan115FolderPage = normalizePan115FolderPage(payload, offset);
  return page;
}

/**
 * Creates the read-only share-info boundary.  Only the documented five query
 * parameter names can cross this boundary; credentials and mutating operations
 * intentionally do not exist here.
 */
export function createPan115ShareInfoAdapter(
  http: Pan115ShareInfoHttpClient,
  options: Pan115ShareInfoAdapterOptions = {}
): Pan115ShareInfoClient {
  const path = options.path ?? PAN115_SHARE_SNAP_PATH;
  return {
    async listShareInfoPage(input: Pan115ShareInfoPageRequest): Promise<Pan115ShareInfoPage> {
      if (!input.shareCode) throw new RangeError("shareCode is required.");
      if (!Number.isInteger(input.offset) || input.offset < 0) throw new RangeError("offset must be a non-negative integer.");
      if (!Number.isInteger(input.limit) || input.limit < 1) throw new RangeError("limit must be a positive integer.");

      const query: Record<string, string | number> = {
        share_code: input.shareCode,
        offset: input.offset,
        limit: input.limit
      };
      if (input.receiveCode) query.receive_code = input.receiveCode;
      if (input.cid) query.cid = input.cid;
      return normalizePan115ShareInfoPage(await http.get({ path, query }), input.offset);
    }
  };
}
