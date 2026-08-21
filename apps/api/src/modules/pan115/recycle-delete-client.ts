import { AppError } from "@follow115/contracts";

/** PRD §8.5 / §22.2: deletes explicitly selected entries to the 115 recycle bin. */
export const PAN115_RECYCLE_DELETE_URL = "https://webapi.115.com/rb/delete";

type FetchResponse = { status: number; text(): Promise<string> };
export type Pan115RecycleDeleteFetch = (url: string, init: {
  method: "POST";
  headers: Readonly<Record<string, string>>;
  body: string;
  signal: AbortSignal;
}) => Promise<FetchResponse>;

export interface Pan115RecycleDeleteClient {
  /** Mutating operation: IDs may be direct child files/folders, but never the preserved Season root CID. */
  deleteFiles(fileIds: readonly string[]): Promise<unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function parseBusinessPayload(body: string): unknown {
  let payload: unknown;
  try { payload = JSON.parse(body); }
  catch { throw new AppError("EXTERNAL_UNAVAILABLE", "115 delete response was not valid JSON.", true); }
  const record = isRecord(payload) ? payload : {};
  if (record.state === false || Boolean(record.errno) || Boolean(record.error)) {
    const errno = Number(record.errno);
    const code = errno === 401 || errno === 403 || errno === 990001 ? "CREDENTIAL_INVALID" : "RESOURCE_UNAVAILABLE";
    throw new AppError(code, "115 rejected the delete request.", false);
  }
  return payload;
}

/**
 * Explicitly composed delete client. It has no server-startup registration,
 * schedule, or release route: calling it remains a confirmed workflow step.
 */
export function createFetchPan115RecycleDeleteClient(
  cookie: string,
  fetchImpl: Pan115RecycleDeleteFetch = globalThis.fetch as Pan115RecycleDeleteFetch,
  timeoutMs = 10_000
): Pan115RecycleDeleteClient {
  if (!cookie.trim()) throw new RangeError("cookie is required.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new RangeError("timeoutMs must be a positive integer.");
  return {
    async deleteFiles(fileIds) {
      if (fileIds.length === 0 || fileIds.some((id) => !id.trim())) throw new RangeError("fileIds must contain at least one non-empty ID.");
      const form = new URLSearchParams();
      fileIds.forEach((fid, index) => form.append(`fid[${index}]`, fid));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(PAN115_RECYCLE_DELETE_URL, {
          method: "POST",
          headers: {
            Cookie: cookie,
            Referer: "https://115.com/",
            Origin: "https://115.com",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
          },
          body: form.toString(),
          signal: controller.signal
        });
        if (response.status === 401 || response.status === 403) throw new AppError("CREDENTIAL_INVALID", "115 rejected the saved credential.");
        if (response.status < 200 || response.status >= 300) throw new AppError("EXTERNAL_UNAVAILABLE", `115 delete request returned HTTP ${response.status}.`, response.status >= 500);
        return parseBusinessPayload(await response.text());
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (error instanceof Error && error.name === "AbortError") throw new AppError("EXTERNAL_TIMEOUT", "115 delete request timed out.", true);
        throw new AppError("EXTERNAL_UNAVAILABLE", "115 delete request failed.", true);
      } finally { clearTimeout(timer); }
    }
  };
}
