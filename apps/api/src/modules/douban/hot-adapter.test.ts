import assert from "node:assert/strict";
import test from "node:test";
import { createFetchDoubanHotHttpClient, DoubanHotAdapter, DOUBAN_HOT_TIMEOUT_MS, type DoubanHotHttpClient } from "./hot-adapter.js";
import { doubanHotCategories } from "./hot-categories.js";

test("uses the independently verified REXXAR hot endpoint and PRD query fields", async () => {
  const calls: Parameters<DoubanHotHttpClient["get"]>[0][] = [];
  const adapter = new DoubanHotAdapter({
    async get(request) {
      calls.push(request);
      return { status: 200, body: { items: [{ id: 42, title: "示例", pic: { large: "poster" }, rating: { value: "8.5", count: "9" }, card_subtitle: "2026 · 剧情" }] } };
    }
  });

  const items = await adapter.list(doubanHotCategories[4]!);

  assert.deepEqual(calls, [{
    url: "https://m.douban.com/rexxar/api/v2/subject/recent_hot/tv",
    query: { type: "tv_domestic", category: "tv", api: "tv", start: 0, count: 9 },
    timeoutMs: DOUBAN_HOT_TIMEOUT_MS
  }]);
  assert.deepEqual(items, [{ id: "42", title: "示例", pic: { large: "poster" }, rating: { value: 8.5, count: 9 }, card_subtitle: "2026 · 剧情" }]);
});

test("rejects upstream HTTP failures and safely drops malformed cards", async () => {
  const failure = new DoubanHotAdapter({ get: async () => ({ status: 503, body: {} }) });
  await assert.rejects(failure.list(doubanHotCategories[0]!), /HTTP 503/);

  const empty = new DoubanHotAdapter({ get: async () => ({ status: 200, body: { items: [{ id: "x" }, { title: "missing" }] } }) });
  assert.deepEqual(await empty.list(doubanHotCategories[0]!), []);
});

test("production transport is injected and performs only the verified GET request", async () => {
  let seen: { input: string; init: { method: string; signal: AbortSignal } } | undefined;
  const client = createFetchDoubanHotHttpClient(async (input, init) => {
    seen = { input, init };
    return { status: 200, json: async () => ({ items: [] }) };
  });
  await new DoubanHotAdapter(client).list(doubanHotCategories[0]!);
  assert.equal(seen?.init.method, "GET");
  assert.match(seen?.input ?? "", /subject\/recent_hot\/movie/);
  assert.match(seen?.input ?? "", /type=%E5%85%A8%E9%83%A8/);
});
