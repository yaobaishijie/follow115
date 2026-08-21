import { AppError, type ImportSearchChannelsRequest, type SearchChannel, type SearchChannelCheck, type SearchChannelRequest, type UpdateSearchChannelRequest } from "@follow115/contracts";

export interface SearchChannelRepository {
  list(): Promise<SearchChannel[]>;
  create(input: SearchChannel): Promise<SearchChannel>;
  update(id: string, input: UpdateSearchChannelRequest): Promise<SearchChannel | null>;
  delete(id: string): Promise<boolean>;
  replaceOrder(ids: readonly string[]): Promise<SearchChannel[]>;
  updateCheck(id: string, status: SearchChannel["lastCheckStatus"], checkedAt: string, message: string | null): Promise<SearchChannel | null>;
}

export interface SearchChannelCheckPort {
  check(channel: Pick<SearchChannel, "name" | "channelId">): Promise<void>;
}
type CheckFields = Pick<SearchChannel, "lastCheckStatus" | "lastCheckMessage"> & { lastCheckedAt: string };

export class DisabledSearchChannelCheckPort implements SearchChannelCheckPort {
  async check(): Promise<void> { throw new Error("Search-channel checks are not configured."); }
}

export class InMemorySearchChannelRepository implements SearchChannelRepository {
  private channels: SearchChannel[] = [];
  async list(): Promise<SearchChannel[]> { return this.channels.map(copy); }
  async create(input: SearchChannel): Promise<SearchChannel> {
    if (this.channels.some((channel) => channel.channelId === input.channelId)) throw new AppError("CONFLICT", "A channel with this channelId already exists.");
    this.channels.push(copy(input));
    return copy(input);
  }
  async update(id: string, input: UpdateSearchChannelRequest): Promise<SearchChannel | null> {
    const index = this.channels.findIndex((channel) => channel.id === id);
    if (index < 0) return null;
    const next = { ...this.channels[index]!, ...input };
    if (input.channelId && this.channels.some((channel) => channel.id !== id && channel.channelId === input.channelId)) throw new AppError("CONFLICT", "A channel with this channelId already exists.");
    this.channels[index] = next;
    return copy(next);
  }
  async delete(id: string): Promise<boolean> { const before = this.channels.length; this.channels = this.channels.filter((channel) => channel.id !== id); return this.channels.length !== before; }
  async replaceOrder(ids: readonly string[]): Promise<SearchChannel[]> {
    this.channels = ids.map((id, sortOrder) => ({ ...this.channels.find((channel) => channel.id === id)!, sortOrder }));
    return this.list();
  }
  async updateCheck(id: string, lastCheckStatus: SearchChannel["lastCheckStatus"], lastCheckedAt: string, lastCheckMessage: string | null): Promise<SearchChannel | null> {
    const channel = this.channels.find((entry) => entry.id === id);
    if (!channel) return null;
    Object.assign(channel, { lastCheckStatus, lastCheckedAt, lastCheckMessage });
    return copy(channel);
  }
}

const channelIdPattern = /^[A-Za-z0-9_]{1,64}$/u;
function normalizedChannelId(value: string): string { return value.trim().replace(/^@/, ""); }
function copy(channel: SearchChannel): SearchChannel { return { ...channel }; }
function validString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new AppError("VALIDATION_ERROR", `${field} must not be empty.`);
  return value.trim();
}

export class SearchChannelService {
  constructor(private readonly repository: SearchChannelRepository, private readonly checker: SearchChannelCheckPort) {}
  async list(): Promise<SearchChannel[]> { return this.repository.list(); }
  async create(input: SearchChannelRequest): Promise<SearchChannel> {
    const channel = this.validateCreate(input);
    const existing = await this.repository.list();
    if (existing.some((entry) => entry.channelId === channel.channelId)) throw new AppError("CONFLICT", "A channel with this channelId already exists.");
    const result = await this.checkCandidate(channel);
    return this.repository.create({ id: crypto.randomUUID(), ...channel, sortOrder: nextSortOrder(existing), ...result });
  }
  async update(id: string, input: UpdateSearchChannelRequest): Promise<SearchChannel> {
    validString(id, "id");
    const update: UpdateSearchChannelRequest = {};
    if (input.name !== undefined) update.name = validString(input.name, "name");
    if (input.channelId !== undefined) update.channelId = this.validateChannelId(input.channelId);
    if (input.isEnabled !== undefined) {
      if (typeof input.isEnabled !== "boolean") throw new AppError("VALIDATION_ERROR", "isEnabled must be a boolean.");
      update.isEnabled = input.isEnabled;
    }
    if (Object.keys(update).length === 0) throw new AppError("VALIDATION_ERROR", "At least one channel field is required.");
    if (update.channelId && (await this.repository.list()).some((channel) => channel.id !== id && channel.channelId === update.channelId)) throw new AppError("CONFLICT", "A channel with this channelId already exists.");
    const channel = await this.repository.update(id, update);
    if (!channel) throw new AppError("NOT_FOUND", "Search channel was not found.");
    return channel;
  }
  async delete(id: string): Promise<void> {
    if (!await this.repository.delete(validString(id, "id"))) throw new AppError("NOT_FOUND", "Search channel was not found.");
  }
  async saveOrder(ids: readonly string[]): Promise<SearchChannel[]> {
    const current = await this.repository.list();
    if (!Array.isArray(ids) || ids.length !== current.length || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string" || !id)) {
      throw new AppError("VALIDATION_ERROR", "ids must contain every channel exactly once.");
    }
    if (ids.some((id) => !current.some((channel) => channel.id === id))) throw new AppError("NOT_FOUND", "A search channel was not found.");
    return this.repository.replaceOrder(ids);
  }
  async import(input: ImportSearchChannelsRequest): Promise<SearchChannel[]> {
    if (!Array.isArray(input.entries) || input.entries.length === 0) throw new AppError("VALIDATION_ERROR", "entries must not be empty.");
    const entries = input.entries.map((entry) => this.validateCreate(entry));
    if (new Set(entries.map((entry) => entry.channelId)).size !== entries.length) throw new AppError("CONFLICT", "Imported channelIds must be unique.");
    const existing = await this.repository.list();
    if (entries.some((entry) => existing.some((channel) => channel.channelId === entry.channelId))) throw new AppError("CONFLICT", "A channel with this channelId already exists.");
    const ordered = entries.map((entry, index) => ({ entry, index })).sort((a, b) => Number(/115/iu.test(b.entry.name + b.entry.channelId)) - Number(/115/iu.test(a.entry.name + a.entry.channelId)) || a.index - b.index);
    const created: SearchChannel[] = [];
    for (const { entry } of ordered) {
      const result = await this.checkCandidate(entry);
      created.push(await this.repository.create({ id: crypto.randomUUID(), ...entry, sortOrder: nextSortOrder(existing) + created.length, ...result }));
    }
    return created;
  }
  async check(id: string): Promise<SearchChannelCheck> {
    const channel = (await this.repository.list()).find((entry) => entry.id === validString(id, "id"));
    if (!channel) throw new AppError("NOT_FOUND", "Search channel was not found.");
    const result = await this.checkCandidate(channel);
    const updated = await this.repository.updateCheck(channel.id, result.lastCheckStatus, result.lastCheckedAt, result.lastCheckMessage);
    return { channel: updated!, checked: result.lastCheckStatus === "ok" };
  }
  async checkAll(): Promise<SearchChannelCheck[]> { return Promise.all((await this.repository.list()).map((channel) => this.check(channel.id))); }
  private validateCreate(input: SearchChannelRequest): Pick<SearchChannel, "name" | "channelId" | "isEnabled"> {
    if (!input || typeof input !== "object") throw new AppError("VALIDATION_ERROR", "A channel body is required.");
    if (input.isEnabled !== undefined && typeof input.isEnabled !== "boolean") throw new AppError("VALIDATION_ERROR", "isEnabled must be a boolean.");
    return { name: validString(input.name, "name"), channelId: this.validateChannelId(input.channelId), isEnabled: input.isEnabled ?? true };
  }
  private validateChannelId(value: unknown): string {
    const channelId = normalizedChannelId(validString(value, "channelId"));
    if (!channelIdPattern.test(channelId)) throw new AppError("VALIDATION_ERROR", "channelId must be a public Telegram channel username.");
    return channelId;
  }
  private async checkCandidate(channel: Pick<SearchChannel, "name" | "channelId">): Promise<CheckFields> {
    const lastCheckedAt = new Date().toISOString();
    try { await this.checker.check(channel); return { lastCheckStatus: "ok", lastCheckedAt, lastCheckMessage: null }; }
    catch (error) { return { lastCheckStatus: "failed", lastCheckedAt, lastCheckMessage: error instanceof Error ? error.message : "Channel check failed." }; }
  }
}
function nextSortOrder(channels: readonly SearchChannel[]): number { return channels.reduce((maximum, channel) => Math.max(maximum, channel.sortOrder), -1) + 1; }
