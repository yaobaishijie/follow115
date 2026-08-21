import { AppError, type SearchSourceProxySettings } from "@follow115/contracts";

export type { SearchSourceProxySettings } from "@follow115/contracts";

export interface SearchSourceProxySettingsStore {
  getSearchSourceProxySettings(): Promise<SearchSourceProxySettings | null>;
  saveSearchSourceProxySettings(settings: SearchSourceProxySettings): Promise<void>;
}

export const defaultSearchSourceProxySettings: SearchSourceProxySettings = {
  btbtlaEnabled: true,
  isProxyEnabled: true,
  httpProxyHost: "clash",
  httpProxyPort: 7890
};

function validate(settings: Partial<SearchSourceProxySettings>): SearchSourceProxySettings {
  if (typeof settings.btbtlaEnabled !== "boolean") throw new AppError("VALIDATION_ERROR", "btbtlaEnabled must be a boolean.");
  if (typeof settings.isProxyEnabled !== "boolean") throw new AppError("VALIDATION_ERROR", "isProxyEnabled must be a boolean.");
  if (typeof settings.httpProxyHost !== "string" || !settings.httpProxyHost.trim()) {
    throw new AppError("VALIDATION_ERROR", "httpProxyHost must not be empty.");
  }
  const port = settings.httpProxyPort;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AppError("VALIDATION_ERROR", "httpProxyPort must be an integer from 1 to 65535.");
  }
  return { btbtlaEnabled: settings.btbtlaEnabled, isProxyEnabled: settings.isProxyEnabled, httpProxyHost: settings.httpProxyHost.trim(), httpProxyPort: port };
}

export class SearchSourceProxySettingsService {
  constructor(private readonly store: SearchSourceProxySettingsStore) {}
  async get(): Promise<SearchSourceProxySettings> {
    return (await this.store.getSearchSourceProxySettings()) ?? defaultSearchSourceProxySettings;
  }
  async save(input: Partial<SearchSourceProxySettings>): Promise<SearchSourceProxySettings> {
    const settings = validate(input);
    await this.store.saveSearchSourceProxySettings(settings);
    return settings;
  }
}

export class InMemorySearchSourceProxySettingsStore implements SearchSourceProxySettingsStore {
  value: SearchSourceProxySettings | null = null;
  async getSearchSourceProxySettings(): Promise<SearchSourceProxySettings | null> { return this.value; }
  async saveSearchSourceProxySettings(settings: SearchSourceProxySettings): Promise<void> { this.value = { ...settings }; }
}
