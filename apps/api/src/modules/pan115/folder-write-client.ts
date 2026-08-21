import { AppError } from "@follow115/contracts";

export const PAN115_FOLDER_ADD_URL = "https://webapi.115.com/files/add";

type FetchResponse = { status: number; text(): Promise<string> };
export type Pan115FolderWriteFetch = (url: string, init: {
  method: "POST";
  headers: Readonly<Record<string, string>>;
  body: string;
  signal: AbortSignal;
}) => Promise<FetchResponse>;

export interface Pan115CreatedFolder {
  cid: string;
  name: string;
  raw: unknown;
}

export interface Pan115FolderWriteClient {
  createFolder(parentCid: string, folderName: string): Promise<Pan115CreatedFolder>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function parsePayload(body: string, folderName: string): Pan115CreatedFolder {
  let payload: unknown;
  try { payload = JSON.parse(body); }
  catch { throw new AppError("EXTERNAL_UNAVAILABLE", "115 folder response was not valid JSON.", true); }
  const record = isRecord(payload) ? payload : {};
  if (record.state === false || Boolean(record.errno) || Boolean(record.error)) {
    const errno = Number(record.errno);
    const code = errno === 401 || errno === 403 || errno === 990001 ? "CREDENTIAL_INVALID" : "RESOURCE_UNAVAILABLE";
    throw new AppError(code, "115 rejected the folder creation request.", false);
  }
  const data = isRecord(record.data) ? record.data : {};
  const cid = String(data.cid ?? data.id ?? record.cid ?? record.id ?? "");
  if (!cid) throw new AppError("EXTERNAL_UNAVAILABLE", "115 folder response did not include a CID.", false);
  return { cid, name: folderName, raw: payload };
}

/** Explicit write-only adapter recovered from PRD §22.2 reference code. It is never composed during server startup. */
export function createFetchPan115FolderWriteClient(cookie: string, fetchImpl: Pan115FolderWriteFetch = globalThis.fetch as Pan115FolderWriteFetch, timeoutMs = 10_000): Pan115FolderWriteClient {
  if (!cookie.trim()) throw new RangeError("cookie is required.");
  return {
    async createFolder(parentCid, folderName) {
      if (!parentCid.trim() || !folderName.trim()) throw new RangeError("parentCid and folderName are required.");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(PAN115_FOLDER_ADD_URL, {
          method: "POST",
          headers: {
            Cookie: cookie,
            Referer: "https://115.com/",
            Origin: "https://115.com",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
          },
          body: new URLSearchParams({ pid: parentCid, cname: folderName }).toString(),
          signal: controller.signal
        });
        if (response.status === 401 || response.status === 403) throw new AppError("CREDENTIAL_INVALID", "115 rejected the saved credential.");
        if (response.status < 200 || response.status >= 300) throw new AppError("EXTERNAL_UNAVAILABLE", `115 folder request returned HTTP ${response.status}.`, response.status >= 500);
        return parsePayload(await response.text(), folderName);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError("EXTERNAL_UNAVAILABLE", "115 folder request failed.", true);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
