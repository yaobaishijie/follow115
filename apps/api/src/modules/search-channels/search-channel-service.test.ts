import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySearchChannelRepository, SearchChannelService, type SearchChannelCheckPort } from "./search-channel-service.js";

class Checker implements SearchChannelCheckPort {
  failures = new Set<string>();
  async check(channel: { channelId: string }): Promise<void> { if (this.failures.has(channel.channelId)) throw new Error("preview unavailable"); }
}

test("new and imported channels are checked through the injected port and failures remain enabled", async () => {
  const checker = new Checker();
  checker.failures.add("bad_channel");
  const service = new SearchChannelService(new InMemorySearchChannelRepository(), checker);
  const failed = await service.create({ name: "Bad", channelId: "@bad_channel" });
  assert.equal(failed.channelId, "bad_channel");
  assert.equal(failed.isEnabled, true);
  assert.equal(failed.lastCheckStatus, "failed");
  const imported = await service.import({ entries: [{ name: "Other", channelId: "other" }, { name: "115 Shares", channelId: "shares_115" }] });
  assert.deepEqual(imported.map((channel) => channel.channelId), ["shares_115", "other"]);
  assert.deepEqual((await service.list()).map((channel) => channel.sortOrder), [0, 1, 2]);
});

test("explicit order is persisted and check-all records each result without removing channels", async () => {
  const checker = new Checker();
  const service = new SearchChannelService(new InMemorySearchChannelRepository(), checker);
  const first = await service.create({ name: "First", channelId: "first" });
  const second = await service.create({ name: "Second", channelId: "second" });
  checker.failures.add("second");
  const checks = await service.checkAll();
  assert.deepEqual(checks.map((result) => result.checked), [true, false]);
  assert.equal((await service.list()).length, 2);
  assert.deepEqual((await service.saveOrder([second.id, first.id])).map((channel) => channel.id), [second.id, first.id]);
});
