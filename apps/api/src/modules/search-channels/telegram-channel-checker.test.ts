import assert from "node:assert/strict";
import test from "node:test";
import { TelegramSearchChannelChecker } from "./telegram-channel-checker.js";

test("channel checker accepts a reachable public preview even when it has no matched messages", async () => {
  let received: unknown;
  const checker = new TelegramSearchChannelChecker({ async search(channel: unknown, keyword: string) { received = { channel, keyword }; return {} as never; } } as never);
  await checker.check({ name: "资源频道", channelId: "media115" });
  assert.deepEqual(received, { channel: { id: "media115", channelId: "media115", sortOrder: 0 }, keyword: "115" });
});
