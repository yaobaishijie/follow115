import pg from "pg";
import PgBoss from "pg-boss";
import { AppError } from "@follow115/contracts";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PasswordHasher } from "./modules/auth/auth-service.js";
import { ensureInitialUser, PostgresSessionStore, PostgresSingleUserRepository } from "./modules/auth/repositories.js";
import { PostgresCredentialStore, PostgresQualitySettingsStore, PostgresSearchSourceProxySettingsStore, PostgresStorageCategoryMappingStore } from "./modules/settings/repositories.js";
import { createFetchPan115FilesHttpClient, createPan115FilesClient } from "./modules/pan115/files-client.js";
import { Pan115FilesCredentialVerifier } from "./modules/settings/settings-service.js";
import { SavedCredentialPan115FolderBrowser } from "./modules/pan115/folder-browser-service.js";
import { PostgresReadRepository } from "./modules/read-api/postgres-read-repository.js";
import { PostgresSubscriptionRepository } from "./modules/subscriptions/repository.js";
import { PostgresSearchChannelRepository } from "./modules/search-channels/repositories.js";
import { TelegramSearchChannelChecker } from "./modules/search-channels/telegram-channel-checker.js";
import { createFetchDoubanHotHttpClient, DoubanHotAdapter } from "./modules/douban/hot-adapter.js";
import { DiscoverService } from "./modules/discover/discover-service.js";
import { PostgresDiscoverMediaCache } from "./modules/discover/discover-media-cache.js";
import { ConfiguredExternalFetchClient } from "./modules/external-http/configured-fetch-client.js";
import { TelegramSearchAdapter } from "./modules/resources/telegram-search-adapter.js";
import { defaultSearchSourceProxySettings } from "./modules/settings/search-source-proxy-settings-service.js";
import { ExternalProxyConnectionTester } from "./modules/settings/proxy-connection-tester.js";
import { HomepageBtbtlaConnectionTester } from "./modules/resources/btbtla-connection-tester.js";
import { PostgresActiveSubscriptionRepository } from "./modules/subscriptions/active-subscription-repository.js";
import { HOURLY_SUBSCRIPTION_CRON, HOURLY_SUBSCRIPTION_QUEUE, HourlySubscriptionScheduler } from "./modules/subscriptions/hourly-scheduler.js";
import { CredentialCipher } from "./modules/settings/credential-cipher.js";
import { PostgresResourceCandidateRepository, PostgresResourceFailureRepository } from "./modules/resources/resource-repositories.js";
import { TelegramShareDiscovery } from "./modules/resources/telegram-share-discovery.js";
import { Pan115ShareCandidateBuilder } from "./modules/resources/pan115-share-candidate-builder.js";
import { createPan115ShareExpandService } from "./modules/pan115/share-expand-service.js";
import { createPan115ShareInfoAdapter } from "./modules/pan115/share-info.js";
import { createFetchPan115ShareInfoHttpClient, createFetchPan115ShareSaveClient } from "./modules/pan115/share-http-client.js";
import { createFetchPan115FolderWriteClient } from "./modules/pan115/folder-write-client.js";
import { createFetchPan115RecycleDeleteClient } from "./modules/pan115/recycle-delete-client.js";
import { createFetchPan115OfflineClient } from "./modules/pan115/offline-client.js";
import { ReadOnlySubscriptionCheckWorker } from "./modules/subscriptions/read-only-subscription-check.js";
import { PostgresReadOnlySubscriptionCheckStore, SavedCredentialSeasonEpisodeReader } from "./modules/subscriptions/read-only-check-repositories.js";
import { Pan115SubscriptionDirectoryBinder } from "./modules/subscriptions/subscription-directory-binder.js";
import { Pan115CandidateSubmitWorker } from "./modules/subscriptions/pan115-candidate-submit.js";
import { PostgresPan115CandidateSubmissionStore } from "./modules/subscriptions/pan115-candidate-submit-repository.js";
import { CandidateVerificationWorker } from "./modules/subscriptions/candidate-verification.js";
import { PostgresCandidateVerificationStore, SavedCredentialCandidateDirectoryReader } from "./modules/subscriptions/candidate-verification-repository.js";
import { ReleaseCleanupWorker } from "./modules/subscriptions/release-cleanup.js";
import { PostgresReleaseCleanupStore, SavedCredentialReleaseDirectoryReader } from "./modules/subscriptions/release-cleanup-repository.js";
import { BtbtlaSearchAdapter } from "./modules/resources/btbtla-search-adapter.js";
import { MagnetCandidateSubmitWorker } from "./modules/subscriptions/magnet-candidate-submit.js";
import { PostgresMagnetCandidateSubmissionStore } from "./modules/subscriptions/magnet-candidate-submit-repository.js";
import { PostgresCleanupCandidateRepository } from "./modules/cleanup-candidates/repository.js";
import { DuplicateCleanupWorker } from "./modules/cleanup-candidates/cleanup-worker.js";

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl });
await ensureInitialUser(pool, config.adminUsername, await new PasswordHasher().hash(config.adminPassword));
const boss = new PgBoss(config.databaseUrl);
await boss.start();
await boss.createQueue("system.health");
await boss.createQueue("subscription.check");
await boss.createQueue("quality.upgrade");
await boss.createQueue("candidate.verify");
await boss.createQueue("cleanup");
await boss.createQueue("release.recover");
await boss.createQueue("duplicate.cleanup");
await boss.createQueue("duplicate.cleanup.recover");
await boss.createQueue(HOURLY_SUBSCRIPTION_QUEUE);
await boss.schedule(HOURLY_SUBSCRIPTION_QUEUE, HOURLY_SUBSCRIPTION_CRON);
await boss.schedule("release.recover", "* * * * *");
await boss.schedule("duplicate.cleanup.recover", "* * * * *");
await boss.work(HOURLY_SUBSCRIPTION_QUEUE, async () => {
  await new HourlySubscriptionScheduler(new PostgresActiveSubscriptionRepository(pool), boss).enqueueActiveSubscriptions();
});
const searchSourceProxySettings = new PostgresSearchSourceProxySettingsStore(pool);
const credentialStore = new PostgresCredentialStore(pool, new CredentialCipher(config.appEncryptionKey!));
const externalFetch = new ConfiguredExternalFetchClient({
  async getSearchSourceProxySettings() {
    return (await searchSourceProxySettings.getSearchSourceProxySettings()) ?? defaultSearchSourceProxySettings;
  }
});
const searchChannelRepository = new PostgresSearchChannelRepository(pool);
const telegramAdapter = new TelegramSearchAdapter(externalFetch);
const candidateRepository = new PostgresResourceCandidateRepository(pool);
const btbtlaAdapter = new BtbtlaSearchAdapter(externalFetch);
const subscriptionCheckWorker = new ReadOnlySubscriptionCheckWorker(
  new PostgresReadOnlySubscriptionCheckStore(pool, candidateRepository),
  new SavedCredentialSeasonEpisodeReader(credentialStore, (cookie) => createPan115FilesClient(createFetchPan115FilesHttpClient(), { cookie })),
  new TelegramShareDiscovery(searchChannelRepository, telegramAdapter),
  { async build(share, context) {
    const credential = await credentialStore.getPan115Credential();
    if (!credential) return null;
    const expansion = createPan115ShareExpandService(createPan115ShareInfoAdapter(createFetchPan115ShareInfoHttpClient(credential.cookie)));
    return new Pan115ShareCandidateBuilder(expansion).build(share, context);
  } },
  new PostgresResourceFailureRepository(pool),
  undefined,
  { async discover(context) {
    const settings = (await searchSourceProxySettings.getSearchSourceProxySettings()) ?? defaultSearchSourceProxySettings;
    if (!settings.btbtlaEnabled) return [];
    return (await btbtlaAdapter.search(context.title)).map((candidate) => candidate.resourceCandidate);
  } }
);
const resourceFailures = new PostgresResourceFailureRepository(pool);
const candidateVerificationDelayMs = 15_000;
const candidateSubmitWorker = new Pan115CandidateSubmitWorker(
  new PostgresPan115CandidateSubmissionStore(pool, resourceFailures),
  { async expand(share) {
    const credential = await credentialStore.getPan115Credential();
    if (!credential) throw new AppError("CONFIGURATION_REQUIRED", "Configure and verify a 115 cookie before transferring files.");
    return createPan115ShareExpandService(createPan115ShareInfoAdapter(createFetchPan115ShareInfoHttpClient(credential.cookie))).expand(share);
  } },
  { async save(input) {
    const credential = await credentialStore.getPan115Credential();
    if (!credential) throw new AppError("CONFIGURATION_REQUIRED", "Configure and verify a 115 cookie before transferring files.");
    return createFetchPan115ShareSaveClient(credential.cookie).save(input);
  } },
  { async enqueue(input) {
    await boss.send("candidate.verify", { subscriptionId: input.subscriptionId, candidateId: input.candidateId }, {
      singletonKey: `subscription:${input.subscriptionId}:candidate:${input.candidateId}:verify`,
      startAfter: input.startAfter,
      retryLimit: 5,
      retryDelay: 15
    });
  } },
  candidateVerificationDelayMs
);
const candidateVerificationWorker = new CandidateVerificationWorker(
  new PostgresCandidateVerificationStore(pool, resourceFailures),
  new SavedCredentialCandidateDirectoryReader(credentialStore, (cookie) => createPan115FilesClient(createFetchPan115FilesHttpClient(), { cookie }))
);
const magnetCandidateSubmitWorker = new MagnetCandidateSubmitWorker(
  new PostgresMagnetCandidateSubmissionStore(pool),
  { async submitMagnet(magnet, targetCid) {
    const credential = await credentialStore.getPan115Credential();
    if (!credential) throw new AppError("CONFIGURATION_REQUIRED", "Configure and verify a 115 cookie before submitting an offline task.");
    return createFetchPan115OfflineClient(credential.cookie).submitMagnet(magnet, targetCid);
  } },
  { async enqueue(input) {
    await boss.send("candidate.verify", { subscriptionId: input.subscriptionId, candidateId: input.candidateId }, {
      singletonKey: `subscription:${input.subscriptionId}:candidate:${input.candidateId}:verify`, startAfter: input.startAfter,
      retryLimit: 5, retryDelay: 60
    });
  } },
  5 * 60_000
);
const releaseCleanupStore = new PostgresReleaseCleanupStore(pool);
const cleanupCandidateRepository = new PostgresCleanupCandidateRepository(pool);
const savedCredentialDirectoryReader = new SavedCredentialReleaseDirectoryReader(credentialStore, (cookie) => createPan115FilesClient(createFetchPan115FilesHttpClient(), { cookie }));
const releaseCleanupWorker = new ReleaseCleanupWorker(
  releaseCleanupStore,
  savedCredentialDirectoryReader,
  { async deleteFiles(fileIds) {
    const credential = await credentialStore.getPan115Credential();
    if (!credential) throw new AppError("CONFIGURATION_REQUIRED", "Configure and verify a 115 cookie before releasing content.");
    return createFetchPan115RecycleDeleteClient(credential.cookie).deleteFiles(fileIds);
  } }
);
const duplicateCleanupWorker = new DuplicateCleanupWorker(cleanupCandidateRepository, savedCredentialDirectoryReader, {
  async deleteFiles(fileIds) {
    const credential = await credentialStore.getPan115Credential();
    if (!credential) throw new AppError("CONFIGURATION_REQUIRED", "Configure and verify a 115 cookie before cleaning duplicates.");
    return createFetchPan115RecycleDeleteClient(credential.cookie).deleteFiles(fileIds);
  }
});
const enqueueRecoverableReleases = async (): Promise<void> => {
  for (const request of await releaseCleanupStore.listRecoverable()) {
    await boss.send("cleanup", request, { singletonKey: `subscription:${request.subscriptionId}:cleanup:${request.generation}`, retryLimit: 5, retryDelay: 15 });
  }
};
const submitFirstRunnable = async (candidateIds: readonly string[]): Promise<void> => {
  for (const candidateId of candidateIds.slice(0, 2)) {
    const source = (await pool.query<{ source: "pan115" | "magnet" }>("SELECT source FROM resource_candidates WHERE id::text = $1", [candidateId])).rows[0]?.source;
    if (source === "magnet") {
      const result = await magnetCandidateSubmitWorker.run(candidateId);
      if (result.kind !== "skipped") return;
      continue;
    }
    if (source === "pan115") {
      const result = await candidateSubmitWorker.run(candidateId);
      if (result.kind !== "resource-failed" && result.kind !== "skipped") return;
    }
  }
};
await boss.work<{ subscriptionId: string }>("subscription.check", { batchSize: 1 }, async (jobs) => {
  for (const job of jobs) {
    const result = await subscriptionCheckWorker.run(job.data.subscriptionId);
    if (result.kind === "checked" && result.candidateIds?.length) await submitFirstRunnable(result.candidateIds);
  }
});
await boss.work<{ subscriptionId: string; candidateId: string }>("candidate.verify", { batchSize: 1, includeMetadata: true }, async (jobs) => {
  for (const job of jobs) {
    const result = await candidateVerificationWorker.run(job.data.candidateId, job.retryCount >= job.retryLimit);
    if ((result.kind === "verified" || result.kind === "resource-failed") && result.nextCandidateId) {
      await submitFirstRunnable([result.nextCandidateId]);
    }
  }
});
await boss.work<{ subscriptionId: string; requestId: string; generation: number }>("cleanup", { batchSize: 1, includeMetadata: true }, async (jobs) => {
  for (const job of jobs) await releaseCleanupWorker.run(job.data.requestId, job.retryCount >= job.retryLimit);
});
await boss.work("release.recover", async () => { await enqueueRecoverableReleases(); });
await boss.work<{ candidateId: string }>("duplicate.cleanup", { batchSize: 1, includeMetadata: true }, async (jobs) => {
  for (const job of jobs) await duplicateCleanupWorker.run(job.data.candidateId, job.retryCount >= job.retryLimit);
});
await boss.work("duplicate.cleanup.recover", async () => {
  for (const candidateId of await cleanupCandidateRepository.listPendingIds()) {
    await boss.send("duplicate.cleanup", { candidateId }, { singletonKey: `duplicate-cleanup:${candidateId}`, retryLimit: 5, retryDelay: 15 });
  }
});
await enqueueRecoverableReleases();
const app = buildApp(config, {
  database: async () => { await pool.query("SELECT 1"); return true; },
  jobs: async () => (await boss.getQueue("system.health")) !== null
}, new PostgresReadRepository(pool), {
  users: new PostgresSingleUserRepository(pool), sessions: new PostgresSessionStore(pool), credentials: credentialStore, storageCategories: new PostgresStorageCategoryMappingStore(pool), qualitySettings: new PostgresQualitySettingsStore(pool), searchSourceProxySettings,
  pan115Verifier: new Pan115FilesCredentialVerifier((cookie) => createPan115FilesClient(createFetchPan115FilesHttpClient(), { cookie })),
  pan115FolderBrowser: new SavedCredentialPan115FolderBrowser(credentialStore, (cookie) => createPan115FilesClient(createFetchPan115FilesHttpClient(), { cookie })),
  proxyConnectionTester: new ExternalProxyConnectionTester(externalFetch),
  btbtlaConnectionTester: new HomepageBtbtlaConnectionTester(externalFetch),
  searchChannels: searchChannelRepository,
  searchChannelChecker: new TelegramSearchChannelChecker(telegramAdapter)
}, { repository: new PostgresSubscriptionRepository(pool, new Pan115SubscriptionDirectoryBinder(
  credentialStore,
  (cookie) => createPan115FilesClient(createFetchPan115FilesHttpClient(), { cookie }),
  (cookie) => createFetchPan115FolderWriteClient(cookie)
)), jobs: boss }, {
  service: new DiscoverService(new DoubanHotAdapter(createFetchDoubanHotHttpClient()), Date.now, undefined, new PostgresDiscoverMediaCache(pool))
}, { repository: cleanupCandidateRepository, jobs: boss });
await app.listen({ host: config.host, port: config.port });
const close = async (): Promise<void> => { await app.close(); await boss.stop(); await pool.end(); };
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
