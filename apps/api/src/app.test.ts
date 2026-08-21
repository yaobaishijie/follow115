import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "./app.js";

const config = { host: "127.0.0.1", port: 3000, databaseUrl: "postgres://unused", logLevel: "silent", adminUsername: "admin", adminPassword: "test-password" };
test("health reports durable infrastructure readiness", async () => {
  const app = buildApp(config, { database: async () => true, jobs: async () => true });
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok", database: "ok", jobs: "ok", version: "0.1.0" });
  await app.close();
});
test("health degrades instead of leaking infrastructure failures", async () => {
  const app = buildApp(config, { database: async () => false, jobs: async () => true });
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.deepEqual(response.json(), { status: "degraded", database: "unavailable", jobs: "ok", version: "0.1.0" });
  await app.close();
});
test("search-channel APIs require a session", async () => {
  const app = buildApp(config, { database: async () => true, jobs: async () => true });
  const response = await app.inject({ method: "GET", url: "/api/v1/search-channels" });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "UNAUTHENTICATED");
  await app.close();
});
test("read APIs return fixture data without requiring external services", async () => {
  const app = buildApp(config, { database: async () => true, jobs: async () => true });
  const discover = await app.inject({ method: "GET", url: "/api/v1/media/discover?limit=1" });
  assert.equal(discover.statusCode, 200);
  assert.equal(discover.json().items[0].source, "mock");
  assert.equal(discover.json().nextCursor, "media-the-last-of-us");
  const subscriptions = await app.inject({ method: "GET", url: "/api/v1/subscriptions" });
  assert.equal(subscriptions.statusCode, 200);
  assert.equal(subscriptions.json().items[0].id, "sub-last-of-us-s02");
  const settings = await app.inject({ method: "GET", url: "/api/v1/settings" });
  assert.equal(settings.statusCode, 401);
  assert.equal(settings.json().error.code, "UNAUTHENTICATED");
  await app.close();
});
test("subscription details and validation failures use the uniform API errors", async () => {
  const app = buildApp(config, { database: async () => true, jobs: async () => true });
  const detail = await app.inject({ method: "GET", url: "/api/v1/subscriptions/sub-last-of-us-s02" });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().media.id, "media-the-last-of-us");
  const missing = await app.inject({ method: "GET", url: "/api/v1/subscriptions/nope" });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, "NOT_FOUND");
  const invalid = await app.inject({ method: "GET", url: "/api/v1/media/discover?limit=0" });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, "VALIDATION_ERROR");
  await app.close();
});
test("media search and details read only local fixtures with contract errors", async () => {
  const app = buildApp(config, { database: async () => true, jobs: async () => true });
  const search = await app.inject({ method: "GET", url: "/api/v1/media/search?q=Last%20of%20Us" });
  assert.equal(search.statusCode, 200);
  assert.equal(search.json().items[0].id, "media-the-last-of-us");
  const detail = await app.inject({ method: "GET", url: "/api/v1/media/media-the-last-of-us" });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().title, "最后生还者");
  const blank = await app.inject({ method: "GET", url: "/api/v1/media/search?q=%20%20" });
  assert.equal(blank.statusCode, 400);
  assert.equal(blank.json().error.code, "VALIDATION_ERROR");
  const missing = await app.inject({ method: "GET", url: "/api/v1/media/nope" });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, "NOT_FOUND");
  await app.close();
});
