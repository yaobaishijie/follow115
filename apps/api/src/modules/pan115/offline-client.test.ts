import assert from "node:assert/strict";
import test from "node:test";
import { createFetchPan115OfflineClient, PAN115_OFFLINE_ADD_TASK_URL, PAN115_OFFLINE_SPACE_URL, type Pan115OfflineFetch } from "./offline-client.js";

test("offline submit uses the PRD-confirmed GET credentials then POST form with nested info_hash", async () => {
  const calls: Array<{ url: string; method: string; body?: string; headers: Readonly<Record<string, string>> }> = [];
  const fetchImpl: Pan115OfflineFetch = async (url, init) => {
    calls.push({ url, method: init.method, ...(init.body === undefined ? {} : { body: init.body }), headers: init.headers });
    return calls.length === 1
      ? { status: 200, text: async () => JSON.stringify({ state: true, data: { uid: "u", sign: "signature", time: "123" } }) }
      : { status: 200, text: async () => JSON.stringify({ state: true, data: { info_hash: "task-hash" } }) };
  };
  const result = await createFetchPan115OfflineClient("UID=cookie-user", fetchImpl).submitMagnet("magnet:?xt=urn:btih:abc", "1234");
  assert.equal(result.taskId, "task-hash");
  assert.deepEqual(calls.map(({ url, method, body }) => ({ url, method, body })), [
    { url: PAN115_OFFLINE_SPACE_URL, method: "GET", body: undefined },
    { url: PAN115_OFFLINE_ADD_TASK_URL, method: "POST", body: "url=magnet%3A%3Fxt%3Durn%3Abtih%3Aabc&wp_path_id=1234&uid=u&sign=signature&time=123" }
  ]);
  assert.equal(calls[1]?.headers["Content-Type"], "application/x-www-form-urlencoded; charset=UTF-8");
});

test("offline submit falls back to UID cookie and refuses ambiguous success", async () => {
  let calls = 0;
  const client = createFetchPan115OfflineClient("foo=1; UID=fallback_user_42; bar=2", async () => {
    calls += 1;
    return calls === 1
      ? { status: 200, text: async () => JSON.stringify({ data: { sign: "s", time: 7 } }) }
      : { status: 200, text: async () => JSON.stringify({ state: true }) };
  });
  await assert.rejects(() => client.submitMagnet("magnet:?xt=x", "1"), (error: unknown) => (error as { code?: string }).code === "RESOURCE_UNAVAILABLE");
});

test("offline submit validates inputs and maps authentication errors without real I/O", async () => {
  const client = createFetchPan115OfflineClient("UID=x", async () => ({ status: 200, text: async () => "{}" }));
  await assert.rejects(() => client.submitMagnet("https://example.test", "1"), /magnet/);
  await assert.rejects(() => client.submitMagnet("magnet:?xt=x", " "), /targetCid/);
  const unauthenticated = createFetchPan115OfflineClient("UID=x", async () => ({ status: 403, text: async () => "{}" }));
  await assert.rejects(() => unauthenticated.submitMagnet("magnet:?xt=x", "1"), (error: unknown) => (error as { code?: string }).code === "CREDENTIAL_INVALID");
});
