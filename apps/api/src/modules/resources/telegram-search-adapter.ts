import { extractPan115Shares, type Pan115Share } from "./resource-candidates.js";

/** The timeout and channel fan-out specified by PRD 22.6. */
export const TELEGRAM_CHANNEL_TIMEOUT_MS = 10_000;
export const TELEGRAM_CHANNEL_CONCURRENCY = 6;

/**
 * Deliberately small HTTP boundary.  The adapter never imports or calls a
 * global network client, which keeps network policy at composition time and
 * makes every adapter test a mock-only test.
 */
export interface TelegramPreviewHttpClient {
  get(url: string, options: { timeoutMs: number }): Promise<{ body: string; status?: number }>;
}

export interface TelegramSearchChannel {
  id: string;
  channelId: string;
  sortOrder: number;
  isEnabled?: boolean;
}

export interface TelegramPreviewLink {
  href: string;
  text: string;
}

export interface TelegramPreviewMessage {
  id: string;
  dateTime: string | null;
  text: string;
  links: readonly TelegramPreviewLink[];
  pan115Shares: readonly Pan115Share[];
}

export interface TelegramPreviewPage {
  channelLogoUrl: string | null;
  messages: readonly TelegramPreviewMessage[];
  pagination: { hasMore: boolean; nextMessageId: string | null };
}

export interface TelegramChannelSearchResult extends TelegramPreviewPage {
  channel: TelegramSearchChannel;
  url: string;
}

/** Builds Telegram's public-preview search URL without accepting a host override. */
export function buildTelegramSearchUrl(channelId: string, keyword: string, beforeMessageId?: string): string {
  const channel = channelId.trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,64}$/u.test(channel)) throw new TypeError("Telegram channelId must be a public channel username.");
  const query = keyword ? `q=${encodeURIComponent(keyword)}` : "";
  const before = beforeMessageId?.trim();
  return `https://t.me/s/${encodeURIComponent(channel)}?${[query, before ? `before=${encodeURIComponent(before)}` : ""].filter(Boolean).join("&")}`;
}

/**
 * Public t.me/s adapter.  It has no default HTTP implementation by design:
 * callers must inject their configured (and test-mockable) client.
 */
export class TelegramSearchAdapter {
  constructor(private readonly http: TelegramPreviewHttpClient) {}

  async search(channel: TelegramSearchChannel, keyword: string, beforeMessageId?: string): Promise<TelegramChannelSearchResult> {
    const url = buildTelegramSearchUrl(channel.channelId, keyword, beforeMessageId);
    const response = await this.http.get(url, { timeoutMs: TELEGRAM_CHANNEL_TIMEOUT_MS });
    if (response.status !== undefined && (response.status < 200 || response.status >= 300)) {
      throw new Error(`Telegram preview request failed with HTTP ${response.status}.`);
    }
    return { channel, url, ...parseTelegramPreviewHtml(response.body) };
  }

  /** Searches enabled channels in sort order while never exceeding six in-flight requests. */
  async searchChannels(channels: readonly TelegramSearchChannel[], keyword: string): Promise<TelegramChannelSearchResult[]> {
    const pending = channels.filter((channel) => channel.isEnabled !== false).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const results: Array<TelegramChannelSearchResult | undefined> = new Array(pending.length);
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= pending.length) return;
        const channel = pending[index];
        if (!channel) return;
        // PRD §9.4: one unavailable public channel must not abort the other
        // configured sources in this scheduling round.
        try { results[index] = await this.search(channel, keyword); }
        catch { /* channel-level failure is deliberately skipped */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(TELEGRAM_CHANNEL_CONCURRENCY, pending.length) }, worker));
    return results.filter((result): result is TelegramChannelSearchResult => result !== undefined);
  }
}

/** Parses the stable public-preview message, logo, and ?before=<id> pagination markup. */
export function parseTelegramPreviewHtml(html: string): TelegramPreviewPage {
  const messages = extractMessageBlocks(html).map(parseMessage).filter((message): message is TelegramPreviewMessage => message !== null);
  const before = /[?&]before=([^&#"'\s<>]+)/iu.exec(html)?.[1];
  return {
    channelLogoUrl: extractChannelLogoUrl(html),
    messages,
    pagination: { hasMore: Boolean(before), nextMessageId: before ? decodeHtml(before) : null }
  };
}

function parseMessage(block: string): TelegramPreviewMessage | null {
  const post = /\bdata-post\s*=\s*(["'])(.*?)\1/iu.exec(block)?.[2];
  const id = post?.split("/").at(-1)?.trim();
  if (!id) return null;
  const textBlock = firstElementWithClass(block, "tgme_widget_message_text") ?? "";
  const text = textContent(textBlock);
  const links = extractLinks(textBlock);
  const dateTime = /<time\b[^>]*\bdatetime\s*=\s*(["'])(.*?)\1/iu.exec(block)?.[2] ?? null;
  const shareText = [text, ...links.map((link) => link.href)].join(" ");
  return { id, dateTime: dateTime ? decodeHtml(dateTime) : null, text, links, pan115Shares: extractPan115Shares(decodeHtml(shareText)) };
}

function extractMessageBlocks(html: string): string[] {
  const blocks: string[] = [];
  const marker = /<div\b(?=[^>]*\bdata-post\s*=)[^>]*>/giu;
  for (const match of html.matchAll(marker)) {
    const start = match.index;
    if (start === undefined) continue;
    const block = balancedDiv(html, start);
    if (block) blocks.push(block);
  }
  return blocks;
}

function balancedDiv(html: string, start: number): string | null {
  const tag = /<\/?div\b[^>]*>/giu;
  tag.lastIndex = start;
  let depth = 0;
  let opened = false;
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    if (match.index < start) continue;
    const closing = /^<\//u.test(match[0]);
    if (!closing) { depth += 1; opened = true; }
    else depth -= 1;
    if (opened && depth === 0) return html.slice(start, tag.lastIndex);
  }
  return null;
}

function firstElementWithClass(html: string, className: string): string | null {
  const marker = new RegExp(`<div\\b(?=[^>]*\\bclass\\s*=\\s*(["'])[^"']*\\b${className}\\b)[^>]*>`, "iu");
  const match = marker.exec(html);
  return match?.index === undefined ? null : balancedDiv(html, match.index);
}

function extractLinks(html: string): TelegramPreviewLink[] {
  const links: TelegramPreviewLink[] = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/giu)) {
    const href = decodeHtml(match[2] ?? "").trim();
    if (href) links.push({ href, text: textContent(match[3] ?? "") });
  }
  return links;
}

function extractChannelLogoUrl(html: string): string | null {
  const photo = /<(?:a|div)\b(?=[^>]*\btgme_page_photo_image\b)[^>]*>/iu.exec(html)?.[0];
  const style = photo ? /\bstyle\s*=\s*(["'])(.*?)\1/iu.exec(photo)?.[2] : undefined;
  const url = style ? /url\(\s*['"]?([^'")]+)['"]?\s*\)/iu.exec(style)?.[1] : undefined;
  if (url) return decodeHtml(url);
  const image = /<img\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\btgme_page_photo_image\b)(?=[^>]*\bsrc\s*=\s*(["'])(.*?)\2)[^>]*>/iu.exec(html);
  return image?.[3] ? decodeHtml(image[3]) : null;
}

function textContent(html: string): string {
  return decodeHtml(html.replace(/<br\s*\/?\s*>/giu, "\n").replace(/<[^>]+>/gu, " ")).replace(/\s*\n\s*/gu, "\n").replace(/[ \t]{2,}/gu, " ").trim();
}

function decodeHtml(value: string): string {
  return value.replace(/&(?:amp|#38);/giu, "&").replace(/&lt;/giu, "<").replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, "\"").replace(/&#(?:39|x27);/giu, "'").replace(/&#(\d+);/gu, (_all, code: string) => String.fromCodePoint(Number(code)));
}
