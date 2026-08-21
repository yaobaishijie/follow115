import type { ResourceCandidateContext } from "@follow115/contracts";
import type { SearchChannelRepository } from "../search-channels/search-channel-service.js";
import type { TelegramSearchAdapter, TelegramSearchChannel } from "./telegram-search-adapter.js";

/**
 * A share observed in a public Telegram preview.  It intentionally is not a
 * resource candidate: PRD §9.9 requires 115 share-info expansion before a
 * share may be matched, ranked, or attempted.
 */
export interface DiscoveredTelegramShare {
  shareUrl: string;
  shareCode: string;
  receiveCode?: string;
  messageId: string;
  messageText: string;
  channelId: string;
  channelSortOrder: number;
}

/**
 * Read-only first stage of PRD §9.3.  The injected public-preview adapter
 * enforces six concurrent, ten-second channel reads and isolates a failed
 * channel; no 115 endpoint or write operation is used here.
 */
export class TelegramShareDiscovery {
  constructor(
    private readonly channels: Pick<SearchChannelRepository, "list">,
    private readonly telegram: Pick<TelegramSearchAdapter, "searchChannels">
  ) {}

  async discover(context: Pick<ResourceCandidateContext, "title">): Promise<readonly DiscoveredTelegramShare[]> {
    const configured = await this.channels.list();
    const searched = await this.telegram.searchChannels(
      configured.map((channel): TelegramSearchChannel => ({
        id: channel.id,
        channelId: channel.channelId,
        isEnabled: channel.isEnabled,
        sortOrder: channel.sortOrder
      })),
      context.title
    );

    const found: DiscoveredTelegramShare[] = [];
    const shareCodes = new Set<string>();
    for (const result of searched) {
      for (const message of result.messages) {
        for (const share of message.pan115Shares) {
          // Keep the first configured channel/message that exposed a share.
          // searchChannels preserves configured sort order after its bounded
          // concurrent work completes.
          if (shareCodes.has(share.shareCode)) continue;
          shareCodes.add(share.shareCode);
          found.push({
            shareUrl: share.url,
            shareCode: share.shareCode,
            ...(share.receiveCode ? { receiveCode: share.receiveCode } : {}),
            messageId: message.id,
            messageText: message.text,
            channelId: result.channel.channelId,
            channelSortOrder: result.channel.sortOrder
          });
        }
      }
    }
    return found;
  }
}
