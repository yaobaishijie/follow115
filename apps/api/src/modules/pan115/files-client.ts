import { AppError, type ErrorCode } from "@follow115/contracts";
import type { Pan115FolderListResponse, Pan115FolderPageClient } from "./list-folder.js";

export const PAN115_WEB_API_BASE_URL = "https://webapi.115.com";
export const PAN115_FILES_DEFAULT_TIMEOUT_MS = 15_000;

export interface Pan115FilesHttpResponse {
  status: number;
  /** The unparsed response body. JSON parsing stays inside this boundary. */
  body: string;
}

/** Injectable HTTP boundary; production fetch is wired explicitly by the server. */
export interface Pan115FilesHttpClient {
  get(input: {
    url: string;
    headers: Readonly<Record<string, string>>;
    timeoutMs: number;
  }): Promise<Pan115FilesHttpResponse>;
}

export interface Pan115FetchResponse {
  status: number;
  text(): Promise<string>;
}

/** Kept injectable so transport behaviour can be tested without network access. */
export type Pan115Fetch = (input: string, init: {
  method: "GET";
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
}) => Promise<Pan115FetchResponse>;

/**
 * Production transport for the deliberately read-only client. The controller
 * is owned here, so every request is cancelled at the configured deadline.
 */
export function createFetchPan115FilesHttpClient(fetchImpl: Pan115Fetch = globalThis.fetch): Pan115FilesHttpClient {
  return {
    async get({ url, headers, timeoutMs }): Promise<Pan115FilesHttpResponse> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, { method: "GET", headers, signal: controller.signal });
        return { status: response.status, body: await response.text() };
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

export type Pan115FilesFailureKind = "timeout" | "transport" | "http" | "json" | "business";

/**
 * A single error shape for every upstream failure, while retaining the source
 * category for logging and retry policy. It remains an application error for
 * the existing API error handler.
 */
export class Pan115FilesError extends AppError {
  constructor(
    public readonly kind: Pan115FilesFailureKind,
    code: ErrorCode,
    message: string,
    retryable: boolean,
    details?: Record<string, string | number | boolean>
  ) {
    super(code, message, retryable, details);
    this.name = "Pan115FilesError";
  }
}

export interface Pan115FilesClientOptions {
  /** Required 115 browser cookie, passed through only as the Cookie header. */
  cookie: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Number of additional attempts for retryable upstream failures. Defaults to one. */
  retries?: number;
  userAgent?: string;
}

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord => value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
const number = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer.`);
}

function upstreamError(kind: Pan115FilesFailureKind, message: string, code: ErrorCode, retryable: boolean, details?: Record<string, string | number | boolean>): Pan115FilesError {
  return new Pan115FilesError(kind, code, message, retryable, details);
}

function classifyTransportError(error: unknown): Pan115FilesError {
  if (error instanceof Pan115FilesError) return error;
  const value = asRecord(error);
  const name = typeof value.name === "string" ? value.name : "";
  const code = typeof value.code === "string" ? value.code : "";
  const message = error instanceof Error ? error.message : "115 /files request failed.";
  if (name === "AbortError" || code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
    return upstreamError("timeout", message, "EXTERNAL_TIMEOUT", true);
  }
  return upstreamError("transport", message, "EXTERNAL_UNAVAILABLE", true);
}

function classifyHttpStatus(status: number): Pan115FilesError {
  if (status === 401 || status === 403) return upstreamError("http", `115 /files returned HTTP ${status}.`, "CREDENTIAL_INVALID", false, { status });
  if (status === 429) return upstreamError("http", "115 /files rate limit reached.", "RATE_LIMITED", true, { status });
  return upstreamError("http", `115 /files returned HTTP ${status}.`, "EXTERNAL_UNAVAILABLE", status >= 500, { status });
}

function validateBusinessPayload(payload: unknown): Pan115FolderListResponse {
  const record = asRecord(payload);
  const errno = number(record.errno);
  // Successful 115 responses may still include `errno: 0` and `error: ""`.
  // The verified legacy adapter treats only truthy errno/error values as a
  // business failure.
  const hasBusinessError = record.state === false || Boolean(record.errno) || Boolean(record.error);
  if (hasBusinessError) {
    const details: Record<string, string | number | boolean> = {};
    if (record.state === false) details.state = false;
    if (errno !== undefined) details.errno = errno;
    if (typeof record.error === "string" || typeof record.error === "number" || typeof record.error === "boolean") details.error = record.error;
    // 115 commonly reports an expired browser session as errno 990001 rather
    // than an HTTP 401. Treat it as a credential failure so callers pause
    // writes instead of presenting it as a transient resource outage.
    const errorText = typeof record.error === "string" ? record.error : "";
    const credentialFailure = errno === 401 || errno === 403 || errno === 990001 || /(?:登录|cookie).*(?:超时|失效)|重新登录/i.test(errorText);
    return (() => { throw upstreamError("business", "115 /files rejected the request.", credentialFailure ? "CREDENTIAL_INVALID" : "RESOURCE_UNAVAILABLE", false, details); })();
  }
  return record;
}

/**
 * Builds the verified, read-only GET /files client. It is compatible with the
 * existing directory pager and has no mutating endpoint in its public surface.
 */
export function createPan115FilesClient(http: Pan115FilesHttpClient, options: Pan115FilesClientOptions): Pan115FolderPageClient {
  if (!options.cookie.trim()) throw new RangeError("cookie is required.");
  const baseUrl = options.baseUrl ?? PAN115_WEB_API_BASE_URL;
  const timeoutMs = options.timeoutMs ?? PAN115_FILES_DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? 1;
  assertPositiveInteger(timeoutMs, "timeoutMs");
  if (!Number.isInteger(retries) || retries < 0) throw new RangeError("retries must be a non-negative integer.");
  const headers = Object.freeze({
    Cookie: options.cookie,
    Referer: "https://115.com/",
    Origin: "https://115.com",
    // Matches the browser UA used by the PRD §22.1 reference adapter.
    "User-Agent": options.userAgent ?? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
  });

  return {
    async listFolderPage(input): Promise<Pan115FolderListResponse> {
      if (!input.cid) throw new RangeError("cid is required.");
      if (!Number.isInteger(input.offset) || input.offset < 0) throw new RangeError("offset must be a non-negative integer.");
      assertPositiveInteger(input.limit, "limit");
      const url = new URL("/files", baseUrl);
      for (const [key, value] of Object.entries({ aid: "1", cid: input.cid, o: "user_ptime", asc: "0", offset: String(input.offset), show_dir: "1", limit: String(input.limit), fc_mix: "0" })) url.searchParams.set(key, value);

      let lastError: Pan115FilesError | undefined;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          const response = await http.get({ url: url.toString(), headers, timeoutMs });
          if (response.status < 200 || response.status >= 300) throw classifyHttpStatus(response.status);
          let payload: unknown;
          try {
            payload = JSON.parse(response.body);
          } catch {
            throw upstreamError("json", "115 /files returned invalid JSON.", "EXTERNAL_UNAVAILABLE", false);
          }
          return validateBusinessPayload(payload);
        } catch (error) {
          lastError = classifyTransportError(error);
          if (!lastError.retryable || attempt === retries) throw lastError;
        }
      }
      throw lastError ?? upstreamError("transport", "115 /files request failed.", "EXTERNAL_UNAVAILABLE", true);
    }
  };
}
