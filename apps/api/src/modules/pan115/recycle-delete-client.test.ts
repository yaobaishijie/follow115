import assert from "node:assert/strict";
import test from "node:test";
import { createFetchPan115RecycleDeleteClient, PAN115_RECYCLE_DELETE_URL, type Pan115RecycleDeleteFetch } from "./recycle-delete-client.js";

test("recycle deletion sends only the PRD-confirmed rb/delete indexed form", async () => {
  let captured: { url: string; headers: Readonly<Record<string, string>>; body: string } | undefined;
  const fetchImpl: Pan115RecycleDeleteFetch = async (url, init) => {
    captured = { url, headers: init.headers, body: init.body };
    return { status: 200, text: async () => JSON.stringify({ state: true, errno: 0, data: {} }) };
  };
  const payload = await createFetchPan115RecycleDeleteClient("UID=x", fetchImpl).deleteFiles(["fid-1", "目录 内/fid-2"]);
  assert.equal(captured?.url, PAN115_RECYCLE_DELETE_URL);
  assert.equal(captured?.body, "fid%5B0%5D=fid-1&fid%5B1%5D=%E7%9B%AE%E5%BD%95+%E5%86%85%2Ffid-2");
  assert.equal(captured?.headers.Cookie, "UID=x");
  assert.equal(captured?.headers.Origin, "https://115.com");
  assert.deepEqual(payload, { state: true, errno: 0, data: {} });
});

test("recycle deletion validates IDs and classifies authentication or business rejection", async () => {
  const invalid = createFetchPan115RecycleDeleteClient("UID=x", async () => ({ status: 200, text: async () => "{}" }));
  await assert.rejects(() => invalid.deleteFiles([]), /at least one/);
  const unauthenticated = createFetchPan115RecycleDeleteClient("UID=x", async () => ({ status: 401, text: async () => "{}" }));
  await assert.rejects(() => unauthenticated.deleteFiles(["x"]), (error: unknown) => (error as { code?: string }).code === "CREDENTIAL_INVALID");
  const rejected = createFetchPan115RecycleDeleteClient("UID=x", async () => ({ status: 200, text: async () => JSON.stringify({ state: false, errno: 500 }) }));
  await assert.rejects(() => rejected.deleteFiles(["x"]), (error: unknown) => (error as { code?: string }).code === "RESOURCE_UNAVAILABLE");
});
