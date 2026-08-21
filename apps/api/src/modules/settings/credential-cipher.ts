import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Pan115Credential } from "./settings-service.js";

type EncryptedPan115Credential = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
  verifiedAt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Encrypts the one persisted 115 credential before it reaches PostgreSQL. */
export class CredentialCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, "base64");
    if (this.key.byteLength !== 32) throw new Error("APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }

  encrypt(credential: Pan115Credential): EncryptedPan115Credential {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ cookie: credential.cookie }), "utf8"), cipher.final()]);
    return {
      version: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      verifiedAt: credential.verifiedAt
    };
  }

  decrypt(value: unknown): Pan115Credential | null {
    if (!isEncrypted(value)) return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(value.iv, "base64"));
      decipher.setAuthTag(Buffer.from(value.tag, "base64"));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
      const parsed: unknown = JSON.parse(plaintext);
      if (!isRecord(parsed) || typeof parsed.cookie !== "string" || !parsed.cookie) return null;
      return { cookie: parsed.cookie, verifiedAt: value.verifiedAt };
    } catch {
      return null;
    }
  }
}

function isEncrypted(value: unknown): value is EncryptedPan115Credential {
  return isRecord(value) && value.version === 1 && value.algorithm === "aes-256-gcm"
    && typeof value.iv === "string" && typeof value.tag === "string" && typeof value.ciphertext === "string"
    && typeof value.verifiedAt === "string";
}
