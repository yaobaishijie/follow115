import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { CredentialCipher } from "./credential-cipher.js";

test("credential cipher persists no plaintext and decrypts only with its configured key", () => {
  const cipher = new CredentialCipher(randomBytes(32).toString("base64"));
  const credential = { cookie: "sensitive-cookie", verifiedAt: "2026-08-21T00:00:00.000Z" };
  const encrypted = cipher.encrypt(credential);
  assert.equal(JSON.stringify(encrypted).includes(credential.cookie), false);
  assert.deepEqual(cipher.decrypt(encrypted), credential);
  assert.equal(new CredentialCipher(randomBytes(32).toString("base64")).decrypt(encrypted), null);
});
