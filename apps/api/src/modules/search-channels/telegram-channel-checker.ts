import type { SearchChannelCheckPort } from "./search-channel-service.js";
import type { TelegramSearchAdapter } from "../resources/telegram-search-adapter.js";

/**
 * A channel is reachable when Telegram's public preview search responds
 * successfully.  A search may legitimately have no matches, so that is not a
 * failed configuration check.
 */
export class TelegramSearchChannelChecker implements SearchChannelCheckPort {
  constructor(private readonly telegram: TelegramSearchAdapter) {}

  async check(channel: { name: string; channelId: string }): Promise<void> {
    await this.telegram.search({ id: channel.channelId, channelId: channel.channelId, sortOrder: 0 }, "115");
  }
}
