import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "@follow115/contracts";
import {
  NotImplementedPan115SharePort,
  NotImplementedTelegramSearchPort,
  ResourceCandidateService,
  TelegramSearchAdapterPort,
  type ResourceCandidateDiscoveryPort,
  type ResourceFailureReader
} from "./resource-candidate-service.js";
import { TelegramSearchAdapter, type TelegramPreviewHttpClient } from "./telegram-search-adapter.js";

test("service composes mocked discovery, pure normalization, blacklist reads, and ranking", async () => {
  const discovery: ResourceCandidateDiscoveryPort = {
    discover: async () => [
      { source: "pan115", title: "Show S01E04-E06 1080p", shareUrl: "https://115.com/s/complete", channelSortOrder: 4 },
      { source: "pan115", title: "Show S01E05 2160p", shareUrl: "https://115.com/s/partial", channelSortOrder: 1 },
      { source: "pan115", title: "Show S01E04 720p", shareUrl: "https://115.com/s/low" },
      { source: "magnet", title: "Show S01E04 1080p", magnet: "ABCDEF0123456789ABCDEF0123456789ABCDEF01" }
    ]
  };
  const reads: string[] = [];
  const failures: ResourceFailureReader = {
    find: async (source, candidateKey) => {
      reads.push(`${source}:${candidateKey}`);
      return candidateKey === "abcdef0123456789abcdef0123456789abcdef01" ? { failureCount: 2, isBlacklisted: true } : null;
    }
  };

  const result = await new ResourceCandidateService(discovery, failures).discoverEligible({
    mediaType: "series", title: "Show", seasonNumber: 1, missingEpisodes: [4, 5, 6]
  });

  assert.deepEqual(result.candidates.map((candidate) => candidate.candidateKey), ["complete", "partial"]);
  assert.deepEqual(reads, ["pan115:complete", "pan115:partial", "magnet:abcdef0123456789abcdef0123456789abcdef01"]);
  assert.equal(result.rejectedCount, 1);
  assert.equal(result.blacklistedCount, 1);
});

test("uncomposed Telegram and disabled 115 share operations are explicit NOT_IMPLEMENTED boundaries", async () => {
  const pan115 = new NotImplementedPan115SharePort();
  const telegram = new NotImplementedTelegramSearchPort();
  const share = { shareCode: "share", url: "https://115.com/s/share" };

  await assert.rejects(pan115.expandShare(share), isNotImplemented);
  await assert.rejects(pan115.saveFiles({ share, fileIds: ["1"], targetFolderId: "2" }), isNotImplemented);
  await assert.rejects(telegram.search({ channelId: "channel", keyword: "Show" }), isNotImplemented);
});

test("service uses an injected Telegram adapter port without creating a network client", async () => {
  const calls: string[] = [];
  const http: TelegramPreviewHttpClient = {
    get: async (url) => {
      calls.push(url);
      return { status: 200, body: '<div data-post="show_channel/9"><div class="tgme_widget_message_text">Show S01E04 <a href="https://115.com/s/share">share</a></div></div>' };
    }
  };
  const service = new ResourceCandidateService(
    { discover: async () => [] },
    { find: async () => null },
    new TelegramSearchAdapterPort(new TelegramSearchAdapter(http))
  );

  const result = await service.searchTelegram({ channelId: "show_channel", keyword: "Show" });

  assert.deepEqual(calls, ["https://t.me/s/show_channel?q=Show"]);
  assert.equal(result.channel.channelId, "show_channel");
  assert.deepEqual(result.messages[0]?.pan115Shares.map((share) => share.shareCode), ["share"]);
});

function isNotImplemented(error: unknown): boolean {
  return error instanceof AppError && error.code === "NOT_IMPLEMENTED";
}
