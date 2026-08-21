import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { AppError, errorStatus } from "@follow115/contracts";
import type { Config } from "./config.js";
import { MockReadRepository, type ReadRepository } from "./modules/read-api/mock-read-repository.js";
import { registerReadRoutes } from "./modules/read-api/routes.js";
import { AuthService, InMemorySessionStore, type SessionStore, type SingleUserRepository } from "./modules/auth/auth-service.js";
import { EmptySingleUserRepository } from "./modules/auth/repositories.js";
import { DisabledPan115CredentialVerifier, InMemoryCredentialStore, Pan115SettingsService, type CredentialStore, type Pan115CredentialVerifier } from "./modules/settings/settings-service.js";
import { InMemoryStorageCategoryMappingStore, StorageCategoryService, type StorageCategoryMappingStore } from "./modules/settings/storage-category-service.js";
import { InMemoryQualitySettingsStore, QualitySettingsService, type QualitySettingsStore } from "./modules/settings/quality-settings-service.js";
import { InMemorySearchSourceProxySettingsStore, SearchSourceProxySettingsService, type SearchSourceProxySettingsStore } from "./modules/settings/search-source-proxy-settings-service.js";
import { DisabledProxyConnectionTester, type ProxyConnectionTester } from "./modules/settings/proxy-connection-tester.js";
import type { SearchSourceProxySettings } from "@follow115/contracts";
import type { Pan115FolderBrowser } from "./modules/pan115/folder-browser-service.js";
import { DisabledSearchChannelCheckPort, InMemorySearchChannelRepository, SearchChannelService, type SearchChannelCheckPort, type SearchChannelRepository } from "./modules/search-channels/search-channel-service.js";
import { registerSearchChannelRoutes } from "./modules/search-channels/routes.js";
import { registerSubscriptionRoutes } from "./modules/subscriptions/routes.js";
import type { SubscriptionRepository } from "./modules/subscriptions/repository.js";
import type { PgBossJobClient } from "./modules/subscriptions/scheduler.js";
import type { DiscoverService } from "./modules/discover/discover-service.js";
import { registerDiscoverRoutes } from "./modules/discover/routes.js";
import { DisabledBtbtlaConnectionTester, type BtbtlaConnectionTester } from "./modules/resources/btbtla-connection-tester.js";
import type { CleanupCandidateRepository } from "./modules/cleanup-candidates/repository.js";
import { registerCleanupCandidateRoutes } from "./modules/cleanup-candidates/routes.js";

const sessionCookie = "follow115_session";
type LoginBody = { username?: unknown; password?: unknown };
type CookieBody = { cookie?: unknown };
type StorageMappingBody = { folderCid?: unknown; folderPath?: unknown };
type DefaultQualityBody = { defaultTargetQuality?: unknown };
type SearchSourceProxyBody = Partial<SearchSourceProxySettings>;

export interface SecurityServices {
  users: SingleUserRepository;
  sessions: SessionStore;
  credentials: CredentialStore;
  pan115Verifier: Pan115CredentialVerifier;
  storageCategories?: StorageCategoryMappingStore;
  qualitySettings?: QualitySettingsStore;
  searchSourceProxySettings?: SearchSourceProxySettingsStore;
  proxyConnectionTester?: ProxyConnectionTester;
  btbtlaConnectionTester?: BtbtlaConnectionTester;
  pan115FolderBrowser?: Pan115FolderBrowser;
  searchChannels?: SearchChannelRepository;
  searchChannelChecker?: SearchChannelCheckPort;
}

export interface SubscriptionServices {
  repository: SubscriptionRepository;
  jobs: PgBossJobClient;
}
export interface DiscoverServices { service: DiscoverService; }
export interface CleanupCandidateServices { repository: CleanupCandidateRepository; jobs?: PgBossJobClient; }

function defaultSecurityServices(): SecurityServices {
  return { users: new EmptySingleUserRepository(), sessions: new InMemorySessionStore(), credentials: new InMemoryCredentialStore(), pan115Verifier: new DisabledPan115CredentialVerifier(), storageCategories: new InMemoryStorageCategoryMappingStore(), qualitySettings: new InMemoryQualitySettingsStore(), searchSourceProxySettings: new InMemorySearchSourceProxySettingsStore(), proxyConnectionTester: new DisabledProxyConnectionTester(), btbtlaConnectionTester: new DisabledBtbtlaConnectionTester(), searchChannels: new InMemorySearchChannelRepository(), searchChannelChecker: new DisabledSearchChannelCheckPort() };
}

function sessionToken(headers: Record<string, string | string[] | undefined>): string | undefined {
  const authorization = headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) return authorization.slice(7);
  const cookie = headers.cookie;
  const source = Array.isArray(cookie) ? cookie.join("; ") : cookie;
  return source?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new AppError("VALIDATION_ERROR", `${name} must not be empty.`);
  return value;
}

export function buildApp(config: Config, checks: { database: () => Promise<boolean>; jobs: () => Promise<boolean> }, repository: ReadRepository = new MockReadRepository(), security: SecurityServices = defaultSecurityServices(), subscriptions?: SubscriptionServices, discover?: DiscoverServices, cleanupCandidates?: CleanupCandidateServices): FastifyInstance {
  const app = Fastify({ logger: { level: config.logLevel }, genReqId: () => crypto.randomUUID() });
  const auth = new AuthService(security.users, security.sessions);
  const pan115 = new Pan115SettingsService(security.credentials, security.pan115Verifier);
  const storageCategories = new StorageCategoryService(security.storageCategories ?? new InMemoryStorageCategoryMappingStore());
  const qualitySettings = new QualitySettingsService(security.qualitySettings ?? new InMemoryQualitySettingsStore());
  const searchSourceProxySettings = new SearchSourceProxySettingsService(security.searchSourceProxySettings ?? new InMemorySearchSourceProxySettingsStore());
  const proxyConnectionTester = security.proxyConnectionTester ?? new DisabledProxyConnectionTester();
  const btbtlaConnectionTester = security.btbtlaConnectionTester ?? new DisabledBtbtlaConnectionTester();
  const searchChannels = new SearchChannelService(security.searchChannels ?? new InMemorySearchChannelRepository(), security.searchChannelChecker ?? new DisabledSearchChannelCheckPort());
  void app.register(cors, { origin: false });
  app.setErrorHandler((error, request, reply) => {
    const appError = error instanceof AppError ? error : new AppError("INTERNAL_ERROR", "An unexpected error occurred.");
    request.log.error({ err: error, code: appError.code }, "request failed");
    void reply.status(errorStatus[appError.code]).send(appError.toBody(request.id));
  });
  app.get("/health", async (): Promise<{ status: "ok" | "degraded"; database: "ok" | "unavailable"; jobs: "ok" | "unavailable"; version: string }> => {
    const [database, jobs] = await Promise.all([checks.database().catch(() => false), checks.jobs().catch(() => false)]);
    return { status: database && jobs ? "ok" : "degraded", database: database ? "ok" : "unavailable", jobs: jobs ? "ok" : "unavailable", version: "0.1.0" };
  });
  registerReadRoutes(app, repository);
  if (discover !== undefined) registerDiscoverRoutes(app, discover.service);
  if (subscriptions !== undefined) registerSubscriptionRoutes(app, subscriptions.repository, subscriptions.jobs);
  if (cleanupCandidates !== undefined) registerCleanupCandidateRoutes(app, cleanupCandidates.repository, (headers) => auth.requireSession(sessionToken(headers)), cleanupCandidates.jobs);
  app.post<{ Body: LoginBody }>("/api/v1/auth/login", async (request, reply) => {
    const session = await auth.login(requiredString(request.body?.username, "username"), requiredString(request.body?.password, "password"));
    void reply.header("Set-Cookie", `${sessionCookie}=${session.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${session.expiresAt.toUTCString()}`);
    return { expiresAt: session.expiresAt.toISOString() };
  });
  app.post("/api/v1/auth/logout", async (request, reply) => {
    await auth.logout(sessionToken(request.headers));
    void reply.header("Set-Cookie", `${sessionCookie}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    return reply.status(204).send();
  });
  app.get("/api/v1/settings", async (request) => {
    await auth.requireSession(sessionToken(request.headers));
    const settings = await repository.getSettings();
    return { ...settings, pan115: await pan115.status(), searchSourceProxy: await searchSourceProxySettings.get() };
  });
  app.put<{ Body: DefaultQualityBody }>("/api/v1/settings/default-target-quality", async (request) => {
    await auth.requireSession(sessionToken(request.headers));
    return qualitySettings.save(request.body?.defaultTargetQuality);
  });
  app.put<{ Body: SearchSourceProxyBody }>("/api/v1/settings/search-source-proxy", async (request) => {
    await auth.requireSession(sessionToken(request.headers));
    return searchSourceProxySettings.save(request.body ?? {});
  });
  app.post("/api/v1/settings/search-source-proxy/test", async (request) => {
    await auth.requireSession(sessionToken(request.headers));
    await proxyConnectionTester.test();
    return { ok: true, message: "代理连接正常。" };
  });
  app.post("/api/v1/settings/search-source-proxy/btbtla/test", async (request) => {
    await auth.requireSession(sessionToken(request.headers));
    await btbtlaConnectionTester.test();
    return { ok: true, message: "btbtla 连接正常。" };
  });
  app.post<{ Body: CookieBody }>("/api/v1/settings/pan115/test", async (request) => {
    await auth.requireSession(sessionToken(request.headers));
    return pan115.test(requiredString(request.body?.cookie, "cookie"));
  });
  app.put<{ Body: CookieBody }>("/api/v1/settings/pan115", async (request) => {
    await auth.requireSession(sessionToken(request.headers));
    return pan115.save(requiredString(request.body?.cookie, "cookie"));
  });
  app.get<{ Querystring: { cid?: unknown; path?: unknown } }>("/api/v1/pan115/folders", async (request) => {
    await auth.requireSession(sessionToken(request.headers));
    const browser = security.pan115FolderBrowser;
    if (browser === undefined) throw new AppError("CONFIGURATION_REQUIRED", "115 folder browsing is not configured.");
    return browser.list({ cid: request.query.cid ?? "0", path: request.query.path });
  });
  app.put<{ Params: { key: string }; Body: StorageMappingBody }>("/api/v1/settings/storage-categories/:key", async (request) => {
    await auth.requireSession(sessionToken(request.headers));
    return storageCategories.save(request.params.key, request.body ?? {});
  });
  registerSearchChannelRoutes(app, searchChannels, (headers) => auth.requireSession(sessionToken(headers)));
  app.all("/api/v1/*", async () => { throw new AppError("NOT_IMPLEMENTED", "This API contract is reserved for its implementation module."); });
  return app;
}
