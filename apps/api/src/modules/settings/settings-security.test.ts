import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "@follow115/contracts";
import { buildApp, type SecurityServices } from "../../app.js";
import { InMemorySessionStore, PasswordHasher, type SingleUserRepository } from "../auth/auth-service.js";
import { InMemoryCredentialStore, Pan115FilesCredentialVerifier, type Pan115CredentialVerifier } from "./settings-service.js";

const config = { host: "127.0.0.1", port: 3000, databaseUrl: "postgres://unused", logLevel: "silent", adminUsername: "admin", adminPassword: "test-password" };
const checks = { database: async () => true, jobs: async () => true };

class UserRepository implements SingleUserRepository {
  constructor(private readonly passwordHash: string) {}
  async findByUsername(username: string) { return username === "admin" ? { id: "user-1", username, passwordHash: this.passwordHash } : null; }
}
class Verifier implements Pan115CredentialVerifier {
  public outcome: "valid" | "invalid" | "unavailable" = "valid";
  async verify() {
    return this.outcome === "valid" ? { outcome: "valid" as const, accountLabel: "masked-account" } :
      this.outcome === "invalid" ? { outcome: "invalid" as const } : { outcome: "unavailable" as const, retryable: true };
  }
}

async function appWithSecurity(): Promise<{ app: ReturnType<typeof buildApp>; verifier: Verifier; store: InMemoryCredentialStore }> {
  const users = new UserRepository(await new PasswordHasher().hash("correct horse battery staple"));
  const verifier = new Verifier();
  const store = new InMemoryCredentialStore();
  const security: SecurityServices = { users, sessions: new InMemorySessionStore(), credentials: store, pan115Verifier: verifier };
  return { app: buildApp(config, checks, undefined, security), verifier, store };
}

async function login(app: ReturnType<typeof buildApp>): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: "correct horse battery staple" } });
  assert.equal(response.statusCode, 200);
  const cookie = response.headers["set-cookie"];
  const value = Array.isArray(cookie) ? cookie[0] : cookie;
  assert.equal(typeof value, "string");
  return value!.split(";", 1)[0]!;
}

test("settings endpoints require a session and auth failures use the error envelope", async () => {
  const { app } = await appWithSecurity();
  const unauthenticated = await app.inject({ method: "PUT", url: "/api/v1/settings/pan115", payload: { cookie: "secret" } });
  assert.equal(unauthenticated.statusCode, 401);
  assert.deepEqual(Object.keys(unauthenticated.json().error).sort(), ["code", "message", "requestId", "retryable"]);
  const invalidLogin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: "wrong" } });
  assert.equal(invalidLogin.statusCode, 401);
  assert.equal(invalidLogin.json().error.code, "UNAUTHENTICATED");
  await app.close();
});

test("validates before saving, redacts responses, and preserves a working credential", async () => {
  const { app, verifier, store } = await appWithSecurity();
  const cookie = await login(app);
  const headers = { cookie };
  const saved = await app.inject({ method: "PUT", url: "/api/v1/settings/pan115", headers, payload: { cookie: "working-secret" } });
  assert.deepEqual(saved.json(), { connected: true, configured: true, accountLabel: "masked-account" });
  const settings = await app.inject({ method: "GET", url: "/api/v1/settings", headers });
  assert.deepEqual(settings.json().pan115, { connected: true, configured: true });
  assert.deepEqual(await store.getPan115Credential(), { cookie: "working-secret", verifiedAt: (await store.getPan115Credential())!.verifiedAt });
  assert.equal(JSON.stringify(saved.json()).includes("working-secret"), false);
  verifier.outcome = "invalid";
  const rejected = await app.inject({ method: "PUT", url: "/api/v1/settings/pan115", headers, payload: { cookie: "bad-secret" } });
  assert.equal(rejected.statusCode, 422);
  assert.equal(rejected.json().error.code, "CREDENTIAL_INVALID");
  assert.equal((await store.getPan115Credential())!.cookie, "working-secret");
  verifier.outcome = "unavailable";
  const unavailable = await app.inject({ method: "POST", url: "/api/v1/settings/pan115/test", headers, payload: { cookie: "another-secret" } });
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.json().error.retryable, true);
  assert.equal(JSON.stringify(unavailable.json()).includes("another-secret"), false);
  await app.close();
});

test("files verifier only calls the read-only root listing and classifies invalid credentials", async () => {
  const calls: Array<{ cid: string; offset: number; limit: number }> = [];
  const verifier = new Pan115FilesCredentialVerifier(() => ({
    async listFolderPage(input) { calls.push(input); return { state: true, data: [] }; }
  }));
  assert.deepEqual(await verifier.verify("UID=redacted"), { outcome: "valid" });
  assert.deepEqual(calls, [{ cid: "0", offset: 0, limit: 1 }]);
  const invalid = new Pan115FilesCredentialVerifier(() => ({
    async listFolderPage() { throw new AppError("CREDENTIAL_INVALID", "redacted"); }
  }));
  assert.deepEqual(await invalid.verify("UID=redacted"), { outcome: "invalid" });
});
