import type { Pool } from "pg";
import type { CredentialStore, Pan115Credential } from "./settings-service.js";
import type { StorageCategoryMapping, StorageCategoryMappingStore } from "./storage-category-service.js";
import type { DefaultTargetQuality, QualitySettingsStore } from "./quality-settings-service.js";
import type { SearchSourceProxySettings, SearchSourceProxySettingsStore } from "./search-source-proxy-settings-service.js";
import type { CredentialCipher } from "./credential-cipher.js";

export class PostgresCredentialStore implements CredentialStore {
  constructor(private readonly pool: Pool, private readonly cipher: CredentialCipher) {}
  async getPan115Credential(): Promise<Pan115Credential | null> {
    const result = await this.pool.query<{ value: unknown }>("SELECT value FROM app_settings WHERE key = 'pan115_credential'");
    return result.rows[0] === undefined ? null : this.cipher.decrypt(result.rows[0].value);
  }
  async savePan115Credential(credential: Pan115Credential): Promise<void> {
    await this.pool.query(
      "INSERT INTO app_settings (key, value, is_sensitive) VALUES ('pan115_credential', $1::jsonb, true) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, is_sensitive = true, updated_at = now()",
      [JSON.stringify(this.cipher.encrypt(credential))]
    );
  }
}

export class PostgresStorageCategoryMappingStore implements StorageCategoryMappingStore {
  constructor(private readonly pool: Pool) {}
  async saveStorageCategoryMapping(mapping: StorageCategoryMapping): Promise<void> {
    await this.pool.query(
      "UPDATE storage_categories SET parent_cid = $2, parent_path = $3, is_configured = true, updated_at = now() WHERE key = $1",
      [mapping.key, mapping.folderCid, mapping.folderPath]
    );
  }
}

export class PostgresQualitySettingsStore implements QualitySettingsStore {
  constructor(private readonly pool: Pool) {}
  async saveDefaultTargetQuality(value: DefaultTargetQuality): Promise<void> {
    await this.pool.query(
      "INSERT INTO app_settings (key, value, is_sensitive) VALUES ('default_target_quality', $1::jsonb, false) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, is_sensitive = false, updated_at = now()",
      [JSON.stringify(value)]
    );
  }
}

export class PostgresSearchSourceProxySettingsStore implements SearchSourceProxySettingsStore {
  constructor(private readonly pool: Pool) {}
  async getSearchSourceProxySettings(): Promise<SearchSourceProxySettings | null> {
    const result = await this.pool.query<{ value: SearchSourceProxySettings }>("SELECT value FROM app_settings WHERE key = 'search_source_proxy_settings' LIMIT 1");
    return result.rows[0]?.value ?? null;
  }
  async saveSearchSourceProxySettings(settings: SearchSourceProxySettings): Promise<void> {
    await this.pool.query(
      "INSERT INTO app_settings (key, value, is_sensitive) VALUES ('search_source_proxy_settings', $1::jsonb, false) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, is_sensitive = false, updated_at = now()",
      [JSON.stringify(settings)]
    );
  }
}
