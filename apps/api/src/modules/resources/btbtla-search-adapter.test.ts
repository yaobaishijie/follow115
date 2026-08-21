import assert from "node:assert/strict";
import test from "node:test";
import {
  BTBTLA_BROWSER_USER_AGENT,
  BTBTLA_TIMEOUT_MS,
  BtbtlaRequestError,
  BtbtlaSearchAdapter,
  type BtbtlaHttpClient
} from "./btbtla-search-adapter.js";

test("traverses mock search, detail, and tdown HTML and normalizes magnets by infoHash", async () => {
  const calls: Array<{ url: string; timeoutMs: number; userAgent: string }> = [];
  const pages = new Map<string, string>([
    ["https://btbtla.example/search/Show%20%26%20Tell", '<a href="/detail/one.html">one</a><a href="/detail/two.html">two</a>'],
    ["https://btbtla.example/detail/one.html", '<a href="/tdown/one">download</a>'],
    ["https://btbtla.example/detail/two.html", '<a href="/tdown/two">download</a>'],
    ["https://btbtla.example/tdown/one", 'magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&amp;dn=one'],
    ["https://btbtla.example/tdown/two", 'magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&dn=duplicate magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567']
  ]);
  const http: BtbtlaHttpClient = {
    get: async (url, options) => {
      calls.push({ url, timeoutMs: options.timeoutMs, userAgent: options.headers["user-agent"] ?? "" });
      return { status: 200, body: pages.get(url) ?? "" };
    }
  };

  const candidates = await new BtbtlaSearchAdapter(http, { baseUrl: "https://btbtla.example" }).search("Show & Tell");

  assert.deepEqual(calls.map((call) => call.url), [
    "https://btbtla.example/search/Show%20%26%20Tell",
    "https://btbtla.example/detail/one.html",
    "https://btbtla.example/tdown/one",
    "https://btbtla.example/detail/two.html",
    "https://btbtla.example/tdown/two"
  ]);
  assert.ok(calls.every((call) => call.timeoutMs === BTBTLA_TIMEOUT_MS && call.userAgent === BTBTLA_BROWSER_USER_AGENT));
  assert.deepEqual(candidates.map(({ detailPath, downloadPath, magnet, infoHash }) => ({ detailPath, downloadPath, magnet, infoHash })), [
    { detailPath: "/detail/one.html", downloadPath: "/tdown/one", magnet: "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=one", infoHash: "abcdef0123456789abcdef0123456789abcdef01" },
    { detailPath: "/detail/two.html", downloadPath: "/tdown/two", magnet: "magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567", infoHash: "0123456789abcdef0123456789abcdef01234567" }
  ]);
  assert.deepEqual(candidates[0]?.resourceCandidate, { source: "magnet", title: "one download", magnet: candidates[0]?.magnet });
});

test("preserves search/resource anchors and parses detail evidence into a direct candidate input", async () => {
  const pages = new Map<string, string>([
    ["https://btbtla.example/search/%E8%97%8F%E6%B5%B7%E4%BC%A0", '<a href="/detail/zanghai.html" title="藏海传">藏海传 2025</a>'],
    ["https://btbtla.example/detail/zanghai.html", '<h1>藏海传</h1><p>上映：2025</p><p>集数：40</p><p>全40集 完结</p><a href="/tdown/zanghai" title="藏海传 S01E01-E40 2160p">下载</a>'],
    ["https://btbtla.example/tdown/zanghai", '磁力：magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567&dn=zanghai']
  ]);
  const adapter = new BtbtlaSearchAdapter({ get: async (url) => ({ status: 200, body: pages.get(url) ?? "" }) }, { baseUrl: "https://btbtla.example" });
  const [candidate] = await adapter.search("藏海传");
  assert.deepEqual(candidate?.detail, { title: "藏海传", releaseYear: 2025, latestEpisode: 40, totalEpisodes: 40, completionSignaled: true });
  assert.equal(candidate?.searchTitle, "藏海传");
  assert.equal(candidate?.resourceName, "藏海传 S01E01-E40 2160p");
  assert.equal(candidate?.quality, "2160p");
  assert.deepEqual(candidate?.resourceCandidate, {
    source: "magnet", title: "藏海传 藏海传 S01E01-E40 2160p",
    magnet: "magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567&dn=zanghai",
    parsedSeason: 1, availableEpisodes: Array.from({ length: 40 }, (_, index) => index + 1)
  });
});

test("normalizes timeout, HTTP status, and transport errors without classifying a magnet as failed", async () => {
  const timeout = new Error("socket timed out");
  const timeoutAdapter = new BtbtlaSearchAdapter({ get: async () => { throw timeout; } });
  await assert.rejects(timeoutAdapter.search("Show"), (error: unknown) => isRequestError(error, "BTBTLA_TIMEOUT"));

  const statusAdapter = new BtbtlaSearchAdapter({ get: async () => ({ status: 503, body: "maintenance" }) });
  await assert.rejects(statusAdapter.search("Show"), (error: unknown) => isRequestError(error, "BTBTLA_HTTP_ERROR", 503));

  const networkAdapter = new BtbtlaSearchAdapter({ get: async () => { throw new Error("DNS failed"); } });
  await assert.rejects(networkAdapter.search("Show"), (error: unknown) => isRequestError(error, "BTBTLA_NETWORK_ERROR"));
});

function isRequestError(error: unknown, code: BtbtlaRequestError["code"], status?: number): boolean {
  return error instanceof BtbtlaRequestError && error.code === code && error.status === status;
}
