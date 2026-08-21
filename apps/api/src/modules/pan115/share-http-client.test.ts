import assert from "node:assert/strict";
import test from "node:test";
import { createFetchPan115ShareInfoHttpClient, createFetchPan115ShareSaveClient, type Pan115ShareFetch } from "./share-http-client.js";

test("share-info uses the recovered 115cdn request and falls back only on 405", async () => {
  const calls: Array<{ url: string; method: string; headers: Readonly<Record<string, string>> }> = [];
  const fetchImpl: Pan115ShareFetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers });
    return calls.length === 1 ? { status: 405, text: async () => "" } : { status: 200, text: async () => JSON.stringify({ state: true, errno: 0, error: "", data: { list: [] } }) };
  };
  const client = createFetchPan115ShareInfoHttpClient("UID=x", fetchImpl);
  await client.get({ path: "/share/snap", query: { share_code: "abc", receive_code: "pw", offset: 0, limit: 300, cid: "folder" } });
  assert.equal(new URL(calls[0]!.url).origin, "https://115cdn.com");
  assert.equal(new URL(calls[1]!.url).origin, "https://webapi.115.com");
  assert.equal(new URL(calls[0]!.url).pathname, "/webapi/share/snap");
  assert.equal(new URL(calls[1]!.url).pathname, "/share/snap");
  assert.equal(calls[0]!.headers.Cookie, "UID=x");
  assert.equal(calls[0]!.headers.xweb_xhr, "1");
  assert.equal(calls[0]!.headers["X-Requested-With"], undefined);
});

test("share save sends the exact recovered form without being composed at startup", async () => {
  let captured: { url: string; method: string; body?: string } | undefined;
  const client = createFetchPan115ShareSaveClient("UID=x", async (url, init) => {
    captured = { url, method: init.method, ...(init.body === undefined ? {} : { body: init.body }) };
    return { status: 200, text: async () => JSON.stringify({ state: true, errno: 0, error: "", data: {} }) };
  });
  await client.save({ shareCode: "share", receiveCode: "pw", fileIds: ["f1", "f2"], targetCid: "target" });
  assert.equal(captured?.url, "https://115cdn.com/webapi/share/receive");
  assert.equal(captured?.method, "POST");
  assert.equal(captured?.body, "cid=target&share_code=share&receive_code=pw&file_id=f1%2Cf2");
});
