import assert from "node:assert/strict";
import test from "node:test";
import { createFetchPan115FolderWriteClient, PAN115_FOLDER_ADD_URL, type Pan115FolderWriteFetch } from "./folder-write-client.js";

test("folder creation sends only the recovered /files/add form", async () => {
  let captured: { url: string; headers: Readonly<Record<string, string>>; body: string } | undefined;
  const fetchImpl: Pan115FolderWriteFetch = async (url, init) => {
    captured = { url, headers: init.headers, body: init.body };
    return { status: 200, text: async () => JSON.stringify({ state: true, errno: 0, error: "", data: { cid: "new-cid" } }) };
  };
  const result = await createFetchPan115FolderWriteClient("UID=x", fetchImpl).createFolder("0", "Codex-115追剧-测试");
  assert.equal(captured?.url, PAN115_FOLDER_ADD_URL);
  assert.equal(captured?.body, "pid=0&cname=Codex-115%E8%BF%BD%E5%89%A7-%E6%B5%8B%E8%AF%95");
  assert.equal(captured?.headers.Cookie, "UID=x");
  assert.equal(captured?.headers.Origin, "https://115.com");
  assert.deepEqual({ cid: result.cid, name: result.name }, { cid: "new-cid", name: "Codex-115追剧-测试" });
});

test("folder creation rejects a successful-looking response without a CID", async () => {
  const client = createFetchPan115FolderWriteClient("UID=x", async () => ({ status: 200, text: async () => JSON.stringify({ state: true }) }));
  await assert.rejects(() => client.createFolder("0", "x"), /did not include a CID/);
});
