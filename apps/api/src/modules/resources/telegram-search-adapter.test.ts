import assert from "node:assert/strict";
import test from "node:test";
import {
  TELEGRAM_CHANNEL_CONCURRENCY,
  TELEGRAM_CHANNEL_TIMEOUT_MS,
  TelegramSearchAdapter,
  buildTelegramSearchUrl,
  parseTelegramPreviewHtml,
  type TelegramPreviewHttpClient
} from "./telegram-search-adapter.js";

const previewHtml = `
  <a class="tgme_page_photo_image" style="background-image:url('https://cdn.example/logo.jpg')"></a>
  <div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="test_channel/42">
    <div class="tgme_widget_message_text">Show S02E03<br><a href="https://115.com/s/shareA?password=p&amp;x=1">115 分享</a> https://example.test/no</div>
    <time datetime="2026-08-20T10:00:00+00:00"></time>
  </div></div>
  <a href="/s/test_channel?before=41">Older posts</a>`;

test("builds the public t.me/s URL and injects a ten-second HTTP request", async () => {
  const calls: Array<{ url: string; timeoutMs: number }> = [];
  const http: TelegramPreviewHttpClient = { get: async (url, options) => { calls.push({ url, timeoutMs: options.timeoutMs }); return { body: previewHtml, status: 200 }; } };
  const adapter = new TelegramSearchAdapter(http);
  const result = await adapter.search({ id: "1", channelId: "@test_channel", sortOrder: 1 }, "Show & more");
  assert.equal(buildTelegramSearchUrl("@test_channel", "Show & more"), "https://t.me/s/test_channel?q=Show%20%26%20more");
  assert.equal(buildTelegramSearchUrl("test_channel", "Show", "123"), "https://t.me/s/test_channel?q=Show&before=123");
  assert.deepEqual(calls, [{ url: "https://t.me/s/test_channel?q=Show%20%26%20more", timeoutMs: TELEGRAM_CHANNEL_TIMEOUT_MS }]);
  assert.equal(result.messages[0]?.pan115Shares[0]?.shareCode, "shareA");
});

test("parses messages, time, text, links, logo, pagination, and only 115 links", () => {
  const page = parseTelegramPreviewHtml(previewHtml);
  assert.equal(page.channelLogoUrl, "https://cdn.example/logo.jpg");
  assert.deepEqual(page.pagination, { hasMore: true, nextMessageId: "41" });
  assert.deepEqual(page.messages[0], {
    id: "42", dateTime: "2026-08-20T10:00:00+00:00", text: "Show S02E03\n115 分享 https://example.test/no",
    links: [{ href: "https://115.com/s/shareA?password=p&x=1", text: "115 分享" }],
    pan115Shares: [{ shareCode: "shareA", receiveCode: "p", url: "https://115.com/s/shareA?password=p&x=1" }]
  });
});

test("limits channel requests to the fixed six-port concurrency", async () => {
  let active = 0;
  let maximum = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const http: TelegramPreviewHttpClient = { get: async () => { active += 1; maximum = Math.max(maximum, active); await gate; active -= 1; return { body: "" }; } };
  const adapter = new TelegramSearchAdapter(http);
  const search = adapter.searchChannels(Array.from({ length: 7 }, (_, index) => ({ id: String(index), channelId: `channel_${index}`, sortOrder: 7 - index })), "show");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maximum, TELEGRAM_CHANNEL_CONCURRENCY);
  release?.();
  await search;
});

test("skips a failed channel while retaining ordered results from other channels", async () => {
  const http: TelegramPreviewHttpClient = {
    async get(url) {
      if (url.includes("bad_channel")) throw new Error("timeout");
      return { body: previewHtml, status: 200 };
    }
  };
  const results = await new TelegramSearchAdapter(http).searchChannels([
    { id: "first", channelId: "first_channel", sortOrder: 2 },
    { id: "bad", channelId: "bad_channel", sortOrder: 1 },
    { id: "last", channelId: "last_channel", sortOrder: 3 }
  ], "show");
  assert.deepEqual(results.map((result) => result.channel.id), ["first", "last"]);
});
