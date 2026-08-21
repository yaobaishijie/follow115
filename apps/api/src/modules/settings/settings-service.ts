import { AppError } from "@follow115/contracts";
import type { Pan115FolderPageClient } from "../pan115/list-folder.js";

export interface Pan115Credential { cookie: string; verifiedAt: string; }
export type Pan115Verification =
  | { outcome: "valid"; accountLabel?: string }
  | { outcome: "invalid" }
  | { outcome: "unavailable"; retryable?: boolean };
export interface Pan115CredentialVerifier { verify(cookie: string): Promise<Pan115Verification>; }
export interface CredentialStore {
  getPan115Credential(): Promise<Pan115Credential | null>;
  savePan115Credential(credential: Pan115Credential): Promise<void>;
}
export interface Pan115Connection { connected: boolean; configured: boolean; accountLabel?: string; }

export class DisabledPan115CredentialVerifier implements Pan115CredentialVerifier {
  async verify(): Promise<Pan115Verification> { return { outcome: "unavailable", retryable: false }; }
}

/** Verifies credentials using only the verified, read-only root-folder request. */
export class Pan115FilesCredentialVerifier implements Pan115CredentialVerifier {
  constructor(private readonly createClient: (cookie: string) => Pan115FolderPageClient) {}

  async verify(cookie: string): Promise<Pan115Verification> {
    try {
      await this.createClient(cookie).listFolderPage({ cid: "0", offset: 0, limit: 1 });
      return { outcome: "valid" };
    } catch (error) {
      if (error instanceof AppError && error.code === "CREDENTIAL_INVALID") return { outcome: "invalid" };
      return { outcome: "unavailable", retryable: error instanceof AppError ? error.retryable : true };
    }
  }
}

export class InMemoryCredentialStore implements CredentialStore {
  private credential: Pan115Credential | null = null;
  async getPan115Credential(): Promise<Pan115Credential | null> { return this.credential; }
  async savePan115Credential(credential: Pan115Credential): Promise<void> { this.credential = credential; }
}

export class Pan115SettingsService {
  constructor(private readonly store: CredentialStore, private readonly verifier: Pan115CredentialVerifier) {}
  async status(): Promise<Pan115Connection> {
    // Credentials are persisted only after a successful read-only verification,
    // so a stored credential represents the last known connected state. Runtime
    // checks can later invalidate it when 115 explicitly reports expiry.
    const configured = (await this.store.getPan115Credential()) !== null;
    return { connected: configured, configured };
  }
  async test(cookie: string): Promise<Pan115Connection> {
    const verified = await this.verify(cookie);
    return { connected: true, configured: (await this.store.getPan115Credential()) !== null, ...(verified.accountLabel ? { accountLabel: verified.accountLabel } : {}) };
  }
  async save(cookie: string): Promise<Pan115Connection> {
    const verified = await this.verify(cookie);
    // Persist only a credential that passed the read-only verifier. A failed test leaves any prior credential untouched.
    await this.store.savePan115Credential({ cookie, verifiedAt: new Date().toISOString() });
    return { connected: true, configured: true, ...(verified.accountLabel ? { accountLabel: verified.accountLabel } : {}) };
  }
  private async verify(cookie: string): Promise<Extract<Pan115Verification, { outcome: "valid" }>> {
    if (!cookie.trim()) throw new AppError("VALIDATION_ERROR", "cookie must not be empty.");
    const result = await this.verifier.verify(cookie);
    if (result.outcome === "valid") return result;
    if (result.outcome === "invalid") throw new AppError("CREDENTIAL_INVALID", "The 115 credential could not be verified.");
    throw new AppError("EXTERNAL_UNAVAILABLE", "115 credential verification is unavailable.", result.retryable ?? true);
  }
}
