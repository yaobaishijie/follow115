import { AppError } from "@follow115/contracts";

export const PAN115_OFFLINE_SPACE_URL = "https://115.com/?ct=offline&ac=space";
export const PAN115_OFFLINE_ADD_TASK_URL = "https://115.com/web/lixian/?ct=lixian&ac=add_task_url";

type FetchResponse = { status: number; text(): Promise<string> };
export type Pan115OfflineFetch = (url: string, init: {
  method: "GET" | "POST";
  headers: Readonly<Record<string, string>>;
  body?: string;
  signal: AbortSignal;
}) => Promise<FetchResponse>;

export interface Pan115OfflineTask { taskId: string; raw: unknown; }
export interface Pan115OfflineClient {
  /** Mutating operation: it is deliberately not composed until the confirmed worker workflow. */
  submitMagnet(magnet: string, targetCid: string): Promise<Pan115OfflineTask>;
}

type OfflineCredentials = { uid: string; sign: string; time: string };
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const valueString = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value) : "";

function headers(cookie: string, contentType?: string): Readonly<Record<string, string>> {
  return {
    Cookie: cookie, Referer: "https://115.com/", Origin: "https://115.com",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    ...(contentType === undefined ? {} : { "Content-Type": contentType })
  };
}

function parsePayload(body: string, label: "offline credentials" | "offline task"): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(body); }
  catch { throw new AppError("EXTERNAL_UNAVAILABLE", `115 ${label} response was not valid JSON.`, true); }
  const payload = isRecord(parsed) ? parsed : {};
  if (payload.state === false || Boolean(payload.errno) || Boolean(payload.error)) {
    const errno = Number(payload.errno);
    const code = errno === 401 || errno === 403 || errno === 990001 ? "CREDENTIAL_INVALID" : "RESOURCE_UNAVAILABLE";
    throw new AppError(code, `115 rejected the ${label} request.`, false);
  }
  return payload;
}

function uidFromCookie(cookie: string): string {
  return cookie.match(/(?:^|;\s*)UID=([^;_]+)/u)?.[1] ?? "";
}

function credentials(payload: Record<string, unknown>, cookie: string): OfflineCredentials {
  const data = isRecord(payload.data) ? payload.data : {};
  const uid = valueString(data.uid) || valueString(payload.uid) || uidFromCookie(cookie);
  const sign = valueString(data.sign) || valueString(payload.sign);
  const time = valueString(data.time) || valueString(payload.time);
  if (!uid || !sign || !time) throw new AppError("RESOURCE_UNAVAILABLE", "115 offline credentials were incomplete.", false);
  return { uid, sign, time };
}

/**
 * Exact PRD §22.4 two-step offline flow. Its factory is never registered with
 * the server, so this module cannot initiate a real task on import/startup.
 */
export function createFetchPan115OfflineClient(
  cookie: string,
  fetchImpl: Pan115OfflineFetch = globalThis.fetch as Pan115OfflineFetch,
  timeoutMs = 10_000
): Pan115OfflineClient {
  if (!cookie.trim()) throw new RangeError("cookie is required.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new RangeError("timeoutMs must be a positive integer.");
  const request = async (url: string, method: "GET" | "POST", body?: string): Promise<Record<string, unknown>> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method, headers: headers(cookie, method === "POST" ? "application/x-www-form-urlencoded; charset=UTF-8" : undefined),
        ...(body === undefined ? {} : { body }), signal: controller.signal
      });
      if (response.status === 401 || response.status === 403) throw new AppError("CREDENTIAL_INVALID", "115 rejected the saved credential.");
      if (response.status < 200 || response.status >= 300) throw new AppError("EXTERNAL_UNAVAILABLE", `115 offline request returned HTTP ${response.status}.`, response.status >= 500);
      return parsePayload(await response.text(), method === "GET" ? "offline credentials" : "offline task");
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new AppError("EXTERNAL_TIMEOUT", "115 offline request timed out.", true);
      throw new AppError("EXTERNAL_UNAVAILABLE", "115 offline request failed.", true);
    } finally { clearTimeout(timer); }
  };
  return {
    async submitMagnet(magnet, targetCid) {
      if (!magnet.startsWith("magnet:?")) throw new RangeError("magnet must start with magnet:?.");
      if (!targetCid.trim()) throw new RangeError("targetCid is required.");
      const credentialsPayload = await request(PAN115_OFFLINE_SPACE_URL, "GET");
      const auth = credentials(credentialsPayload, cookie);
      const taskPayload = await request(PAN115_OFFLINE_ADD_TASK_URL, "POST", new URLSearchParams({
        url: magnet, wp_path_id: targetCid, uid: auth.uid, sign: auth.sign, time: auth.time
      }).toString());
      const data = isRecord(taskPayload.data) ? taskPayload.data : {};
      const taskId = valueString(data.info_hash) || valueString(taskPayload.info_hash);
      if (!taskId) throw new AppError("RESOURCE_UNAVAILABLE", "115 offline task response did not include info_hash.", false);
      return { taskId, raw: taskPayload };
    }
  };
}
