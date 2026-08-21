import assert from "node:assert/strict";
import test from "node:test";
import { PostgresSessionStore } from "./repositories.js";

test("postgres sessions persist only a token hash and restore the session", async () => {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  let storedUserId = "";
  let storedExpiresAt = new Date(0);
  let storedHash = "";
  const pool = { async query(text: string, values?: readonly unknown[]) {
    calls.push(values ? { text, values } : { text });
    if (text.startsWith("INSERT INTO app_sessions")) {
      storedHash = String(values?.[0]); storedUserId = String(values?.[1]); storedExpiresAt = values?.[2] as Date;
      return { rows: [] };
    }
    if (text.startsWith("SELECT user_id")) return { rows: [{ userId: storedUserId, expiresAt: storedExpiresAt }] };
    return { rows: [] };
  } };
  const store = new PostgresSessionStore(pool as never, 60_000);
  const created = await store.create("user-1");
  assert.notEqual(storedHash, created.token);
  assert.equal(storedHash.length, 64);
  assert.equal(JSON.stringify(calls).includes(created.token), false);
  assert.deepEqual(await store.find(created.token), created);
  await store.delete(created.token);
  assert.equal(calls.at(-1)?.values?.[0], storedHash);
});
