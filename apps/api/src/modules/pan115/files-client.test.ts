import assert from "node:assert/strict";
import test from "node:test";
import {
  createPan115FilesClient,
  createFetchPan115FilesHttpClient,
  PAN115_FILES_DEFAULT_TIMEOUT_MS,
  Pan115FilesError,
  type Pan115FilesHttpClient
} from "./files-client.js";

const cookie = "UID=1; CID=2";

test("/files sends exactly the documented query and browser headers through injected HTTP", async () => {
  const calls: Array<{ url: string; headers: Readonly<Record<string, string>>; timeoutMs: number }> = [];
  const http: Pan115FilesHttpClient = { async get(request) {
    calls.push(request);
    return { status: 200, body: JSON.stringify({ state: true, count: 1, data: [{ n: "Episode.mkv", fid: "f1" }] }) };
  } };
  const client = createPan115FilesClient(http, { cookie });
  const page = await client.listFolderPage({ cid: "root id", offset: 20, limit: 50 });

  assert.deepEqual(page, { state: true, count: 1, data: [{ n: "Episode.mkv", fid: "f1" }] });
  assert.equal(calls.length, 1);
  const request = calls[0];
  assert.ok(request);
  const url = new URL(request.url);
  assert.equal(`${url.origin}${url.pathname}`, "https://webapi.115.com/files");
  assert.deepEqual(Object.fromEntries(url.searchParams), { aid: "1", cid: "root id", o: "user_ptime", asc: "0", offset: "20", show_dir: "1", limit: "50", fc_mix: "0" });
  assert.equal(request.timeoutMs, PAN115_FILES_DEFAULT_TIMEOUT_MS);
  assert.equal(request.headers.Cookie, cookie);
  assert.equal(request.headers.Referer, "https://115.com/");
  assert.equal(request.headers.Origin, "https://115.com");
  assert.equal(request.headers["User-Agent"], "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36");
});

test("/files uniformly classifies HTTP, JSON, and 115 business failures", async () => {
  const cases: Array<{ response: { status: number; body: string }; kind: Pan115FilesError["kind"]; code: string }> = [
    { response: { status: 403, body: "" }, kind: "http", code: "CREDENTIAL_INVALID" },
    { response: { status: 200, body: "not json" }, kind: "json", code: "EXTERNAL_UNAVAILABLE" },
    { response: { status: 200, body: JSON.stringify({ state: false, errno: 20021, error: "denied" }) }, kind: "business", code: "RESOURCE_UNAVAILABLE" },
    { response: { status: 200, body: JSON.stringify({ state: false, errno: 990001, error: "登录超时，请重新登录。" }) }, kind: "business", code: "CREDENTIAL_INVALID" }
  ];
  for (const expected of cases) {
    const client = createPan115FilesClient({ get: async () => expected.response }, { cookie, retries: 0 });
    await assert.rejects(client.listFolderPage({ cid: "0", offset: 0, limit: 1 }), (error: unknown) => {
      assert.ok(error instanceof Pan115FilesError);
      assert.equal(error.kind, expected.kind);
      assert.equal(error.code, expected.code);
      return true;
    });
  }
});

test("/files accepts 115 success payloads containing zero errno and empty error", async () => {
  const payload = { state: true, errno: 0, error: "", count: 0, data: [] };
  const client = createPan115FilesClient({
    get: async () => ({ status: 200, body: JSON.stringify(payload) })
  }, { cookie, retries: 0 });
  assert.deepEqual(await client.listFolderPage({ cid: "0", offset: 0, limit: 1 }), payload);
});

test("/files retries only retryable transport failures and honors configured timeout", async () => {
  let attempts = 0;
  const client = createPan115FilesClient({ async get({ timeoutMs }) {
    assert.equal(timeoutMs, 321);
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error("slow"), { code: "ETIMEDOUT" });
    return { status: 200, body: JSON.stringify({ data: [] }) };
  } }, { cookie, timeoutMs: 321, retries: 1 });
  assert.deepEqual(await client.listFolderPage({ cid: "0", offset: 0, limit: 1 }), { data: [] });
  assert.equal(attempts, 2);
});

test("fetch transport forwards headers through its injected fetch implementation", async () => {
  let received: { url: string; headers: Readonly<Record<string, string>>; signal: AbortSignal } | undefined;
  const transport = createFetchPan115FilesHttpClient(async (url, init) => {
    received = { url, headers: init.headers, signal: init.signal };
    return { status: 200, text: async () => "{}" };
  });
  const response = await transport.get({ url: "https://example.test/files", headers: { Cookie: cookie }, timeoutMs: 10 });
  assert.deepEqual(response, { status: 200, body: "{}" });
  assert.deepEqual(received?.headers, { Cookie: cookie });
  assert.equal(received?.signal.aborted, false);
});

test("fetch transport aborts an unsettled request at its configured deadline", async () => {
  const transport = createFetchPan115FilesHttpClient(async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("timed out"), { name: "AbortError" })), { once: true });
  }));
  await assert.rejects(transport.get({ url: "https://example.test/files", headers: {}, timeoutMs: 1 }), { name: "AbortError" });
});
