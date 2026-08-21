import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";
import type { SearchSourceProxySettings } from "@follow115/contracts";

/**
 * Shared, read-only transport for external catalog and resource sources.
 * The persisted proxy setting is evaluated for every request, so changing it
 * never requires restarting the API process.  No request is made at startup.
 */
export interface ConfiguredFetchSettingsProvider {
  getSearchSourceProxySettings(): Promise<SearchSourceProxySettings>;
}

export interface ConfiguredFetchOptions {
  timeoutMs: number;
  headers?: Readonly<Record<string, string>>;
}

export interface ConfiguredFetchResponse {
  body: string;
  status: number;
}

export type ConfiguredFetch = (url: string, init: {
  method: "GET";
  headers?: Readonly<Record<string, string>>;
  signal: AbortSignal;
  dispatcher?: Dispatcher;
}) => Promise<{ status: number; text(): Promise<string> }>;

export class ConfiguredExternalFetchClient {
  constructor(
    private readonly settings: ConfiguredFetchSettingsProvider,
    private readonly fetchImpl: ConfiguredFetch = undiciFetch
  ) {}

  async get(url: string, options: ConfiguredFetchOptions): Promise<ConfiguredFetchResponse> {
    const configured = await this.settings.getSearchSourceProxySettings();
    const dispatcher = configured.isProxyEnabled ? new ProxyAgent(proxyUrl(configured)) : undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const request: Parameters<ConfiguredFetch>[1] = {
        method: "GET",
        signal: controller.signal
      };
      if (options.headers) request.headers = options.headers;
      if (dispatcher) request.dispatcher = dispatcher;
      const response = await this.fetchImpl(url, request);
      return { body: await response.text(), status: response.status };
    } finally {
      clearTimeout(timer);
      await closeDispatcher(dispatcher);
    }
  }
}

function proxyUrl(settings: SearchSourceProxySettings): string {
  // The settings service validates host and port before they can be persisted.
  // Brackets make the configured address unambiguous if it is an IPv6 literal.
  const host = settings.httpProxyHost.includes(":") && !settings.httpProxyHost.startsWith("[")
    ? `[${settings.httpProxyHost}]`
    : settings.httpProxyHost;
  return `http://${host}:${settings.httpProxyPort}`;
}

async function closeDispatcher(dispatcher: Dispatcher | undefined): Promise<void> {
  if (dispatcher instanceof ProxyAgent) await dispatcher.close();
}
