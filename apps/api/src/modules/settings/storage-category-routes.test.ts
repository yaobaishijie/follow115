import assert from "node:assert/strict";
import test from "node:test";
import { buildApp, type SecurityServices } from "../../app.js";
import { InMemorySessionStore, PasswordHasher, type SingleUserRepository } from "../auth/auth-service.js";
import { SavedCredentialPan115FolderBrowser } from "../pan115/folder-browser-service.js";
import type { Pan115FolderPageClient } from "../pan115/list-folder.js";
import { InMemoryCredentialStore, type Pan115CredentialVerifier } from "./settings-service.js";
import { InMemoryStorageCategoryMappingStore } from "./storage-category-service.js";
import { InMemoryQualitySettingsStore } from "./quality-settings-service.js";

const config = { host: "127.0.0.1", port: 3000, databaseUrl: "postgres://unused", logLevel: "silent", adminUsername: "admin", adminPassword: "test-password" };
class Users implements SingleUserRepository { constructor(private readonly passwordHash: string) {} async findByUsername(username: string) { return username === "admin" ? { id: "u", username, passwordHash: this.passwordHash } : null; } }
class Verifier implements Pan115CredentialVerifier { async verify() { return { outcome: "valid" as const }; } }
async function fixture() {
  const credentials = new InMemoryCredentialStore();
  await credentials.savePan115Credential({ cookie: "saved-only", verifiedAt: "2026-01-01T00:00:00.000Z" });
  const mappings = new InMemoryStorageCategoryMappingStore();
  const quality = new InMemoryQualitySettingsStore();
  const seen: string[] = [];
  const browser = new SavedCredentialPan115FolderBrowser(credentials, (cookie): Pan115FolderPageClient => ({ async listFolderPage({ cid }) { seen.push(`${cookie}:${cid}`); return { data: [{ n: "国产剧", cid: "9", is_dir: 1 }, { n: "x.mkv", fid: "f" }] }; } }));
  const security: SecurityServices = { users: new Users(await new PasswordHasher().hash("pass")), sessions: new InMemorySessionStore(), credentials, pan115Verifier: new Verifier(), storageCategories: mappings, qualitySettings: quality, pan115FolderBrowser: browser };
  const app = buildApp(config, { database: async () => true, jobs: async () => true }, undefined, security);
  const logged = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: "pass" } });
  return { app, cookie: (logged.headers["set-cookie"] as string).split(";", 1)[0]!, mappings, quality, seen };
}

test("folder browser uses only saved cookies and read-only directory data", async () => {
  const { app, cookie, seen } = await fixture();
  const response = await app.inject({ method: "GET", url: "/api/v1/pan115/folders?cid=7&path=115%20%2F%20影视库", headers: { cookie } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), [{ cid: "9", name: "国产剧", path: "115 / 影视库 / 国产剧" }]);
  assert.deepEqual(seen, ["saved-only:7"]);
  await app.close();
});

test("default target quality accepts only the two PRD choices", async () => {
  const { app, cookie, quality } = await fixture();
  const invalid = await app.inject({ method: "PUT", url: "/api/v1/settings/default-target-quality", headers: { cookie }, payload: { defaultTargetQuality: "720p" } });
  assert.equal(invalid.statusCode, 400);
  const saved = await app.inject({ method: "PUT", url: "/api/v1/settings/default-target-quality", headers: { cookie }, payload: { defaultTargetQuality: "2160p" } });
  assert.deepEqual(saved.json(), { defaultTargetQuality: "2160p" });
  assert.equal(quality.value, "2160p");
  await app.close();
});

test("folder browsing and mappings enforce configuration and validation", async () => {
  const { app, cookie, mappings } = await fixture();
  const invalidKey = await app.inject({ method: "PUT", url: "/api/v1/settings/storage-categories/nope", headers: { cookie }, payload: { folderCid: "9", folderPath: "影视库 / 自定义" } });
  assert.equal(invalidKey.statusCode, 404);
  const invalidPath = await app.inject({ method: "PUT", url: "/api/v1/settings/storage-categories/movie", headers: { cookie }, payload: { folderCid: "9", folderPath: "../电影" } });
  assert.equal(invalidPath.statusCode, 400);
  const saved = await app.inject({ method: "PUT", url: "/api/v1/settings/storage-categories/movie", headers: { cookie }, payload: { folderCid: "9", folderPath: "影视库/电影" } });
  assert.deepEqual(saved.json(), { key: "movie", label: "电影", folderCid: "9", folderPath: "影视库 / 电影", configured: true });
  assert.equal(mappings.mappings.get("movie")?.folderCid, "9");
  await app.close();
});
