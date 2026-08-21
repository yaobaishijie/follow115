import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerCleanupCandidateRoutes } from "./routes.js";

test("cleanup preview is authenticated and has no mutating route", async () => {
  const app = Fastify();
  let authenticated = false;
  registerCleanupCandidateRoutes(app, { async upsertPending() {}, async listPendingIds() { return ["c"]; }, async listPending() { return [{ id: "c", subscriptionId: "s", title: "藏海传", episodeKey: "S01E18", keep: { fileId: "keep", name: "4K", quality: "2160p" as const }, remove: { fileId: "remove", name: "1080P", quality: "1080p" as const }, reason: "高画质" }]; } }, async () => { authenticated = true; });
  const response = await app.inject({ method: "GET", url: "/api/v1/cleanup-candidates" });
  assert.equal(response.statusCode, 200); assert.equal(authenticated, true);
  assert.deepEqual(response.json().items[0].remove.quality, "1080p");
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/cleanup-candidates" })).statusCode, 404);
  await app.close();
});
