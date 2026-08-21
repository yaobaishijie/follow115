import assert from "node:assert/strict";
import test from "node:test";
import type { SearchChannel } from "@follow115/contracts";
import { TelegramShareDiscovery } from "./telegram-share-discovery.js";

const channel = (id: string, sortOrder: number, isEnabled = true): SearchChannel => ({
  id, name: id, channelId: id, sortOrder, isEnabled, lastCheckStatus: "unknown", lastCheckedAt: null, lastCheckMessage: null
});

test("Telegram share discovery keeps only 115 shares and preserves configured priority", async () => {
  const seen: Array<{ channelId: string; sortOrder: number; isEnabled?: boolean }> = [];
  const discovery = new TelegramShareDiscovery(
    { async list() { return [channel("later", 8), channel("first", 1), channel("disabled", 0, false)]; } },
    {
      async searchChannels(channels, keyword) {
        assert.equal(keyword, "藏海传");
        seen.push(...channels);
        return [
          { channel: channels[1]!, url: "", channelLogoUrl: null, pagination: { hasMore: false, nextMessageId: null }, messages: [{ id: "11", dateTime: null, text: "藏海传 S01E30 2160P", links: [], pan115Shares: [{ shareCode: "early", url: "https://115.com/s/early" }] }] },
          { channel: channels[0]!, url: "", channelLogoUrl: null, pagination: { hasMore: false, nextMessageId: null }, messages: [{ id: "21", dateTime: null, text: "duplicate", links: [], pan115Shares: [{ shareCode: "early", url: "https://115.com/s/early" }, { shareCode: "later", receiveCode: "p", url: "https://115.com/s/later?password=p" }] }] }
        ];
      }
    }
  );

  const shares = await discovery.discover({ title: "藏海传" });
  // The repository owns its persisted order. TelegramSearchAdapter applies
  // the explicit sort before issuing bounded-concurrency requests.
  assert.deepEqual(seen.map((item) => item.channelId), ["later", "first", "disabled"]);
  assert.deepEqual(shares, [
    { shareUrl: "https://115.com/s/early", shareCode: "early", messageId: "11", messageText: "藏海传 S01E30 2160P", channelId: "first", channelSortOrder: 1 },
    { shareUrl: "https://115.com/s/later?password=p", shareCode: "later", receiveCode: "p", messageId: "21", messageText: "duplicate", channelId: "later", channelSortOrder: 8 }
  ]);
});
