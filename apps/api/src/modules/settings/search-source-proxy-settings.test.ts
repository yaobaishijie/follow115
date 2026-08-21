import assert from "node:assert/strict";
import test from "node:test";
import { buildApp, type SecurityServices } from "../../app.js";
import { InMemorySessionStore, PasswordHasher, type SingleUserRepository } from "../auth/auth-service.js";
import { InMemoryCredentialStore, type Pan115CredentialVerifier } from "./settings-service.js";
import { InMemorySearchSourceProxySettingsStore } from "./search-source-proxy-settings-service.js";

const config = { host: "127.0.0.1", port: 3000, databaseUrl: "postgres://unused", logLevel: "silent", adminUsername: "admin", adminPassword: "test-password" };
class Users implements SingleUserRepository { constructor(private readonly passwordHash: string) {} async findByUsername(username: string) { return username === "admin" ? { id: "u", username, passwordHash: this.passwordHash } : null; } }
class Verifier implements Pan115CredentialVerifier { async verify() { return { outcome: "valid" as const }; } }

async function fixture() {
  const searchSourceProxySettings = new InMemorySearchSourceProxySettingsStore();
  const security: SecurityServices = {
    users: new Users(await new PasswordHasher().hash("pass")), sessions: new InMemorySessionStore(),
    credentials: new InMemoryCredentialStore(), pan115Verifier: new Verifier(), searchSourceProxySettings
  };
  const app = buildApp(config, { database: async () => true, jobs: async () => true }, undefined, security);
  const logged = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: "pass" } });
  return { app, cookie: (logged.headers["set-cookie"] as string).split(";", 1)[0]!, searchSourceProxySettings };
}

const valid = { btbtlaEnabled: false, isProxyEnabled: true, httpProxyHost: " 127.0.0.1 ", httpProxyPort: 7890 };

test("search source and proxy settings require authentication and strictly validate host and port", async () => {
  const { app, cookie } = await fixture();
  assert.equal((await app.inject({ method: "PUT", url: "/api/v1/settings/search-source-proxy", payload: valid })).statusCode, 401);
  for (const payload of [
    { ...valid, httpProxyHost: " " },
    { ...valid, httpProxyPort: 0 },
    { ...valid, httpProxyPort: 65536 },
    { ...valid, httpProxyPort: 7890.5 }
  ]) assert.equal((await app.inject({ method: "PUT", url: "/api/v1/settings/search-source-proxy", headers: { cookie }, payload })).statusCode, 400);
  await app.close();
});

test("search source and proxy settings persist locally and GET returns the saved policy", async () => {
  const { app, cookie, searchSourceProxySettings } = await fixture();
  const saved = await app.inject({ method: "PUT", url: "/api/v1/settings/search-source-proxy", headers: { cookie }, payload: valid });
  const expected = { ...valid, httpProxyHost: "127.0.0.1" };
  assert.deepEqual(saved.json(), expected);
  assert.deepEqual(await searchSourceProxySettings.getSearchSourceProxySettings(), expected);
  const settings = await app.inject({ method: "GET", url: "/api/v1/settings", headers: { cookie } });
  assert.deepEqual(settings.json().searchSourceProxy, expected);
  await app.close();
});
