import assert from "node:assert/strict";
import test from "node:test";
import { ConfiguredExternalFetchClient } from "./configured-fetch-client.js";

test("configured external client is read-only, forwards headers, and reads proxy policy per request", async () => {
  const seen: Array<{ url: string; init: { method: "GET"; headers?: Readonly<Record<string, string>>; signal: AbortSignal } }> = [];
  const settings = { async getSearchSourceProxySettings() { return { btbtlaEnabled: true, isProxyEnabled: false, httpProxyHost: "clash", httpProxyPort: 7890 }; } };
  const client = new ConfiguredExternalFetchClient(settings, async (url, init) => {
    seen.push({ url: String(url), init });
    return { status: 200, async text() { return "ok"; } };
  });
  assert.deepEqual(await client.get("https://example.test/preview", { timeoutMs: 10_000, headers: { "user-agent": "test" } }), { body: "ok", status: 200 });
  assert.equal(seen[0]?.url, "https://example.test/preview");
  assert.equal(seen[0]?.init.headers?.["user-agent"], "test");
  assert.equal(seen[0]?.init.method, "GET");
});
