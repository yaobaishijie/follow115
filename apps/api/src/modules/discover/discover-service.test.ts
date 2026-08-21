import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "@follow115/contracts";
import { DiscoverService, doubanHotCategories, formatRating, loadDiscoverSections, recommendationTag, sortBySubtitleYear, yearFromCardSubtitle } from "./discover-service.js";

test("keeps the eleven PRD categories and visible fixed order", () => {
  assert.deepEqual(doubanHotCategories.map(({ key }) => key), ["hot-movie", "latest-movie", "classic-movie", "hot-tv", "tv-domestic", "tv-american", "tv-korean", "tv-japanese", "tv-animation", "hot-show", "tv-documentary"]);
  assert.deepEqual(doubanHotCategories.at(-2), { key: "hot-show", title: "热门综艺", type: "show", category: "show", api: "tv" });
});

test("extracts a leading year and sorts descending without reordering ties", () => {
  assert.equal(yearFromCardSubtitle("2025 / 中国大陆 / 剧情"), 2025);
  assert.equal(yearFromCardSubtitle("中国大陆 / 2025"), undefined);
  assert.deepEqual(sortBySubtitleYear([{ id: "a", card_subtitle: "2024 / A" }, { id: "b", card_subtitle: "2025 / B" }, { id: "c", card_subtitle: "2024 / C" }, { id: "d" }]).map(({ id }) => id), ["b", "a", "c", "d"]);
});

test("formats ratings and assigns the five native recommendation labels", () => {
  assert.equal(formatRating(8), "8.0");
  assert.equal(formatRating(0), "--");
  assert.equal(formatRating(undefined), "--");
  assert.deepEqual([undefined, 0, 8.5, 7.5, 6.5, 6.4].map(recommendationTag), ["待评分", "待评分", "神作", "推荐", "可看", "一般"]);
});

test("uses the injected port only and returns every category", async () => {
  const seen: string[] = [];
  const sections = await loadDiscoverSections({ list: async (category) => { seen.push(category.key); return [{ id: category.key, title: category.title, card_subtitle: "2025" }]; } });
  assert.deepEqual(seen, doubanHotCategories.map(({ key }) => key));
  assert.equal(sections.length, 11);
});

test("maps an injected upstream failure to the uniform retryable error model", async () => {
  const service = new DiscoverService({ list: async () => { throw new Error("offline"); } });
  await assert.rejects(service.listHotSections(), (error: unknown) => error instanceof AppError && error.code === "EXTERNAL_UNAVAILABLE" && error.retryable);
});
