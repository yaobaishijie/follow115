import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerDiscoverRoutes } from "./routes.js";
import { DiscoverService, type DoubanHotPort } from "./discover-service.js";

test("hot discover endpoint returns the PRD sections, nine items, and stable year order", async () => {
  const port: DoubanHotPort = {
    async list(category) {
      return Array.from({ length: 10 }, (_, index) => ({
        id: `${category.key}-${index}`, title: `条目 ${index}`,
        card_subtitle: index === 1 ? "2027 · A" : index < 3 ? "2026 · B" : "2025 · C"
      }));
    }
  };
  const app = Fastify();
  registerDiscoverRoutes(app, new DiscoverService(port, () => 0));
  const response = await app.inject({ method: "GET", url: "/api/v1/discover/hot" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(body.sections.map((section: { key: string }) => section.key), ["hot-movie", "latest-movie", "classic-movie", "hot-tv", "tv-domestic", "tv-american", "tv-korean", "tv-japanese", "tv-animation", "hot-show", "tv-documentary"]);
  assert.equal(body.sections[0].items.length, 9);
  assert.deepEqual(body.sections[0].items.slice(0, 3).map((item: { sourceId: string }) => item.sourceId), ["hot-movie-1", "hot-movie-0", "hot-movie-2"]);
  assert.match(body.sections[0].items[0].id, /^[0-9a-f-]{36}$/i);
  await app.close();
});

test("service caches one complete snapshot briefly without network access in tests", async () => {
  let calls = 0;
  let now = 100;
  const service = new DiscoverService({ list: async (category) => { calls += 1; return [{ id: category.key, title: category.title }]; } }, () => now, 1000);
  const first = await service.listHotSections();
  const second = await service.listHotSections();
  assert.equal(first, second);
  assert.equal(calls, 11);
  now = 1_100;
  await service.listHotSections();
  assert.equal(calls, 22);
});
