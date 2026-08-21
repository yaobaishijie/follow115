import { AppError } from "@follow115/contracts";
import type { Pan115ShareInfoHttpClient } from "./share-info.js";

export const PAN115_SHARE_PRIMARY_BASE_URL = "https://115cdn.com/webapi/";
export const PAN115_SHARE_FALLBACK_BASE_URL = "https://webapi.115.com";
export const PAN115_SHARE_RECEIVE_PATH = "/share/receive";

type FetchResponse = { status: number; text(): Promise<string> };
export type Pan115ShareFetch = (url: string, init: {
  method: "GET" | "POST";
  headers: Readonly<Record<string, string>>;
  body?: string;
  signal: AbortSignal;
}) => Promise<FetchResponse>;

export interface Pan115ShareSaveInput {
  shareCode: string;
  receiveCode?: string;
  fileIds: readonly string[];
  targetCid: string;
}

export interface Pan115ShareSaveClient {
  save(input: Pan115ShareSaveInput): Promise<unknown>;
}

const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 MicroMessenger/6.8.0(0x16080000) NetType/WIFI MiniProgramEnv/Mac MacWechat/WMPF MacWechat/3.8.9(0x13080910) XWEB/1227";

function headers(cookie: string): Readonly<Record<string, string>> {
  return {
    Accept: "*/*",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    Cookie: cookie,
    Referer: "https://servicewechat.com/wx2c744c010a61b0fa/94/page-frame.html",
    "User-Agent": userAgent,
    xweb_xhr: "1"
  };
}

function businessPayload(body: string): unknown {
  let payload: unknown;
  try { payload = JSON.parse(body); }
  catch { throw new AppError("EXTERNAL_UNAVAILABLE", "115 share response was not valid JSON.", true); }
  const record = payload !== null && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  if (record.state === false || Boolean(record.errno) || Boolean(record.error)) {
    const errno = Number(record.errno);
    const code = errno === 401 || errno === 403 || errno === 990001 ? "CREDENTIAL_INVALID" : "RESOURCE_UNAVAILABLE";
    throw new AppError(code, "115 rejected the share request.", false);
  }
  return payload;
}

async function request(fetchImpl: Pan115ShareFetch, url: URL, init: Omit<Parameters<Pan115ShareFetch>[1], "signal">, timeoutMs: number): Promise<FetchResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetchImpl(url.toString(), { ...init, signal: controller.signal }); }
  catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("EXTERNAL_UNAVAILABLE", "115 share request failed.", true);
  } finally { clearTimeout(timer); }
}

/** Exact read-only share adapter recovered from CloudSaver per PRD §22.3. */
export function createFetchPan115ShareInfoHttpClient(cookie: string, fetchImpl: Pan115ShareFetch = globalThis.fetch as Pan115ShareFetch, timeoutMs = 10_000): Pan115ShareInfoHttpClient {
  if (!cookie.trim()) throw new RangeError("cookie is required.");
  return { async get(input) {
    const makeUrl = (base: string) => {
      const relativePath = base === PAN115_SHARE_PRIMARY_BASE_URL ? input.path.replace(/^\/+/, "") : input.path;
      const url = new URL(relativePath, base);
      for (const [key, value] of Object.entries(input.query)) url.searchParams.set(key, String(value));
      return url;
    };
    let response = await request(fetchImpl, makeUrl(PAN115_SHARE_PRIMARY_BASE_URL), { method: "GET", headers: headers(cookie) }, timeoutMs);
    if (response.status === 405) response = await request(fetchImpl, makeUrl(PAN115_SHARE_FALLBACK_BASE_URL), { method: "GET", headers: headers(cookie) }, timeoutMs);
    if (response.status === 401 || response.status === 403) throw new AppError("CREDENTIAL_INVALID", "115 rejected the saved credential.");
    if (response.status < 200 || response.status >= 300) throw new AppError("EXTERNAL_UNAVAILABLE", `115 share request returned HTTP ${response.status}.`, response.status >= 500);
    return businessPayload(await response.text());
  } };
}

/** Mutating adapter is exported for explicit write workflows only; server startup never calls it. */
export function createFetchPan115ShareSaveClient(cookie: string, fetchImpl: Pan115ShareFetch = globalThis.fetch as Pan115ShareFetch, timeoutMs = 10_000): Pan115ShareSaveClient {
  if (!cookie.trim()) throw new RangeError("cookie is required.");
  return { async save(input) {
    if (!input.shareCode.trim() || !input.targetCid.trim() || input.fileIds.length === 0 || input.fileIds.some((id) => !id.trim())) throw new RangeError("shareCode, targetCid and fileIds are required.");
    const form = new URLSearchParams({
      cid: input.targetCid,
      share_code: input.shareCode,
      receive_code: input.receiveCode ?? "",
      file_id: input.fileIds.join(",")
    }).toString();
    const response = await request(fetchImpl, new URL(PAN115_SHARE_RECEIVE_PATH.replace(/^\/+/, ""), PAN115_SHARE_PRIMARY_BASE_URL), { method: "POST", headers: headers(cookie), body: form }, timeoutMs);
    if (response.status === 401 || response.status === 403) throw new AppError("CREDENTIAL_INVALID", "115 rejected the saved credential.");
    if (response.status < 200 || response.status >= 300) throw new AppError("EXTERNAL_UNAVAILABLE", `115 save request returned HTTP ${response.status}.`, response.status >= 500);
    return businessPayload(await response.text());
  } };
}
