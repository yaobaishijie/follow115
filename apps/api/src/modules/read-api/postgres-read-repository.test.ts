import assert from "node:assert/strict";
import test from "node:test";
import { PostgresReadRepository, type ReadQueryPool } from "./postgres-read-repository.js";

function poolWith(rows: unknown[][], calls: Array<{ text: string; values: readonly unknown[] | undefined }>): ReadQueryPool {
  return { async query(text, values) { calls.push({ text, values }); return { rows: (rows.shift() ?? []) as never[] }; } };
}

test("postgres read repository maps media rows and uses a look-ahead cursor query", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  const repository = new PostgresReadRepository(poolWith([[
    { id: "a", sourceId: "tmdb-1", source: "tmdb", title: "Example", aliases: '["Alias"]', year: 2025, mediaType: "series", region: null, genres: ["Drama"], posterUrl: null, backdropUrl: null, rating: "8.5", recommendation: null, latestEpisode: 3, totalEpisodes: 8, summary: null },
    { id: "b", sourceId: "tmdb-2", source: "tmdb", title: "Next", aliases: [], year: 2025, mediaType: "movie", region: "US", genres: [], posterUrl: null, backdropUrl: null, rating: null, recommendation: null, latestEpisode: null, totalEpisodes: null, summary: "" }
  ]], calls));
  const result = await repository.discoverMedia("before", 1);
  assert.deepEqual(result, { items: [{ id: "a", sourceId: "tmdb-1", source: "tmdb", title: "Example", aliases: ["Alias"], year: 2025, mediaType: "series", region: "", genres: ["Drama"], posterUrl: null, backdropUrl: null, rating: 8.5, recommendation: null, latestEpisode: 3, totalEpisodes: 8, summary: "" }], nextCursor: "a" });
  assert.match(calls[0]!.text, /FROM media_metadata/);
  assert.deepEqual(calls[0]!.values, ["before", 2]);
});

test("postgres media search is local, includes aliases, and supports cursor pagination", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  const repository = new PostgresReadRepository(poolWith([[
    { id: "a", sourceId: "douban-1", source: "douban", title: "最后生还者", aliases: '["The Last of Us"]', year: 2025, mediaType: "series", region: "美国", genres: [], posterUrl: null, backdropUrl: null, rating: null, recommendation: null, latestEpisode: 7, totalEpisodes: 7, summary: null },
    { id: "b", sourceId: "douban-2", source: "douban", title: "Other", aliases: [], year: null, mediaType: "movie", region: null, genres: [], posterUrl: null, backdropUrl: null, rating: null, recommendation: null, latestEpisode: null, totalEpisodes: null, summary: null }
  ]], calls));
  const result = await repository.searchMedia("Last", "before", 1);
  assert.equal(result.items[0]!.aliases[0], "The Last of Us");
  assert.equal(result.nextCursor, "a");
  assert.match(calls[0]!.text, /jsonb_array_elements_text\(aliases\)/);
  assert.deepEqual(calls[0]!.values, ["Last", "before", 2]);
});

test("postgres media detail only reads local media_metadata", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  const repository = new PostgresReadRepository(poolWith([[
    { id: "media-1", sourceId: "douban-1", source: "douban", title: "Example", aliases: [], year: 2025, mediaType: "series", region: null, genres: [], posterUrl: null, backdropUrl: null, rating: "8.5", recommendation: null, latestEpisode: 1, totalEpisodes: 8, summary: "Summary" }
  ], []], calls));
  assert.equal((await repository.getMedia("media-1"))?.rating, 8.5);
  assert.equal(await repository.getMedia("missing"), null);
  assert.match(calls[0]!.text, /FROM media_metadata/);
  assert.deepEqual(calls[0]!.values, ["media-1"]);
});

test("postgres read repository returns an empty database as empty pages and PRD storage defaults", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  const repository = new PostgresReadRepository(poolWith([[], [], [], [], []], calls));
  assert.deepEqual(await repository.listSubscriptions(undefined, 20), { items: [], nextCursor: null });
  assert.equal(await repository.getSubscription("missing"), null);
  assert.deepEqual(await repository.getSettings(), {
    pan115: { connected: false, configured: false }, defaultTargetQuality: "1080p",
    searchSourceProxy: { btbtlaEnabled: true, isProxyEnabled: true, httpProxyHost: "clash", httpProxyPort: 7890 },
    storageCategories: [
      { key: "cn_drama", label: "国产剧", configured: false, folderCid: null, folderPath: null }, { key: "us_drama", label: "美剧", configured: false, folderCid: null, folderPath: null },
      { key: "jp_kr_drama", label: "日韩剧", configured: false, folderCid: null, folderPath: null }, { key: "tv", label: "电视剧", configured: false, folderCid: null, folderPath: null },
      { key: "variety", label: "综艺", configured: false, folderCid: null, folderPath: null }, { key: "animation", label: "动漫", configured: false, folderCid: null, folderPath: null },
      { key: "documentary", label: "纪录片", configured: false, folderCid: null, folderPath: null }, { key: "movie", label: "电影", configured: false, folderCid: null, folderPath: null }
    ]
  });
});

test("postgres read repository maps visible subscription fields and orders by recent updates", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  const repository = new PostgresReadRepository(poolWith([[
    { id: "sub-1", seriesId: "series-1", title: "Series title", seasonNumber: 2, subscriptionStatus: "following", lifecycleStatus: "active", runStatus: "waiting", resolvedLatestEpisode: 4, missingEpisodeKeys: '["S02E05"]', targetQuality: "2160p", targetSeasonPath: "/影视库/美剧/Example/Season 02", lastCheckedAt: "2026-08-20T08:00:00.000Z", consecutiveFailRounds: 2, updatedAt: "2026-08-20T09:00:00.000Z" }
  ]], calls));
  assert.deepEqual(await repository.listSubscriptions(undefined, 20), {
    items: [{ id: "sub-1", seriesId: "series-1", title: "Series title", seasonNumber: 2, subscriptionStatus: "following", lifecycleStatus: "active", runStatus: "waiting", resolvedLatestEpisode: 4, missingEpisodeKeys: ["S02E05"], targetQuality: "2160p", targetSeasonPath: "/影视库/美剧/Example/Season 02", lastCheckedAt: "2026-08-20T08:00:00.000Z", consecutiveFailRounds: 2 }],
    nextCursor: null
  });
  assert.match(calls[0]!.text, /ORDER BY s\.updated_at DESC, s\.id DESC/);
  assert.deepEqual(calls[0]!.values, [null, null, 21]);
});

test("postgres read repository maps subscription detail from joined rows", async () => {
  const repository = new PostgresReadRepository(poolWith([[
    { subscriptionId: "sub-1", seriesId: "series-1", seriesTitle: "Example", seasonNumber: 2, subscriptionStatus: "following", lifecycleStatus: "active", runStatus: "waiting", resolvedLatestEpisode: 4, missingEpisodeKeys: '["S02E05"]', subscriptionTotalEpisodes: 8, targetQuality: "2160p", targetSeasonPath: "/影视库/美剧/Example/Season 02", lastCheckedAt: "2026-08-20T08:00:00.000Z", consecutiveFailRounds: 1, updatedAt: "2026-08-20T09:00:00.000Z", mediaId: "media-1", sourceId: "tmdb-1", source: "tmdb", mediaTitle: "Example", aliases: [], year: 2025, mediaType: "series", region: "美国", genres: [], posterUrl: null, backdropUrl: null, rating: null, recommendation: null, latestEpisode: 5, totalEpisodes: 8, summary: "Summary" }
  ], [
    { time: "2026-08-20T08:00:00.000Z", level: "info", type: "candidate.verified", message: "已补齐第 5 集" }
  ]], []));
  const detail = await repository.getSubscription("sub-1");
  assert.deepEqual(detail, {
    id: "sub-1", seriesId: "series-1", title: "Example", seasonNumber: 2, subscriptionStatus: "following", lifecycleStatus: "active", runStatus: "waiting", resolvedLatestEpisode: 4, missingEpisodeKeys: ["S02E05"], targetQuality: "2160p", targetSeasonPath: "/影视库/美剧/Example/Season 02", lastCheckedAt: "2026-08-20T08:00:00.000Z", consecutiveFailRounds: 1,
    media: { id: "media-1", sourceId: "tmdb-1", source: "tmdb", title: "Example", aliases: [], year: 2025, mediaType: "series", region: "美国", genres: [], posterUrl: null, backdropUrl: null, rating: null, recommendation: null, latestEpisode: 5, totalEpisodes: 8, summary: "Summary" },
    totalEpisodes: 8, activities: [{ time: "2026-08-20T08:00:00.000Z", level: "info", type: "candidate.verified", message: "已补齐第 5 集" }]
  });
});
