import assert from "node:assert/strict";
import test from "node:test";
import type { Pan115Item } from "./directory-model.js";
import { createPan115ShareExpandService } from "./share-expand-service.js";
import { createPan115ShareInfoAdapter, type Pan115ShareInfoHttpClient } from "./share-info.js";

const directory = (cid: string, name: string): Pan115Item => ({ id: cid, cid, fid: null, name, isDirectory: true, size: 0, pickCode: null, raw: {} });
const file = (fid: string, name: string, size = 1): Pan115Item => ({ id: fid, cid: null, fid, name, isDirectory: false, size, pickCode: null, raw: {} });

test("share-info adapter uses an injected HTTP client and only documented query parameters", async () => {
  const calls: Array<{ path: string; query: Readonly<Record<string, string | number>> }> = [];
  const http: Pan115ShareInfoHttpClient = {
    async get(request) {
      calls.push(request);
      return { data: { count: 1, list: [{ n: "Episode.mkv", fid: "file-1", s: "12" }] } };
    }
  };
  const client = createPan115ShareInfoAdapter(http, { path: "/verified-later/share-info" });
  const page = await client.listShareInfoPage({ shareCode: "share", receiveCode: "pass", cid: "dir", offset: 0, limit: 50 });

  assert.deepEqual(calls, [{ path: "/verified-later/share-info", query: { share_code: "share", receive_code: "pass", cid: "dir", offset: 0, limit: 50 } }]);
  assert.deepEqual(page.items.map(({ id, name, isDirectory, size }) => ({ id, name, isDirectory, size })), [{ id: "file-1", name: "Episode.mkv", isDirectory: false, size: 12 }]);
});

test("share expansion paginates, retains parent paths, and protects against cycles", async () => {
  const calls: Array<{ cid: string | undefined; offset: number }> = [];
  const service = createPan115ShareExpandService({
    async listShareInfoPage({ cid, offset }) {
      calls.push({ cid, offset });
      if (cid === undefined) return offset === 0
        ? { offset, total: 3, items: [directory("season", "Season 02"), file("root", "Root.mkv")] }
        : { offset, total: 3, items: [file("tail", "Tail.mkv", 2)] };
      return { offset, total: 2, items: [
        directory("season", "loop"),
        file("episode", "Episode.mkv", 3)
      ] };
    }
  });

  const result = await service.expand({ shareCode: "share", parentPath: ["影视库"], pageSize: 2 });
  assert.deepEqual(calls, [{ cid: undefined, offset: 0 }, { cid: undefined, offset: 2 }, { cid: "season", offset: 0 }]);
  assert.equal(result.directoriesScanned, 2);
  assert.equal(result.filesScanned, 3);
  assert.deepEqual(result.files.map((file) => ({ name: file.item.name, parentCid: file.parentCid, parentPath: file.parentPath })), [
    { name: "Episode.mkv", parentCid: "season", parentPath: ["影视库", "Season 02"] },
    { name: "Root.mkv", parentCid: null, parentPath: ["影视库"] },
    { name: "Tail.mkv", parentCid: null, parentPath: ["影视库"] }
  ]);
});

test("share expansion enforces configured depth, directory, and file limits", async () => {
  const service = createPan115ShareExpandService({
    async listShareInfoPage({ cid, offset }) {
      if (offset > 0) return { offset, total: 0, items: [] };
      return cid === undefined
        ? { offset, total: 1, items: [directory("child", "Child")] }
        : { offset, total: 1, items: [file("file", "File.mkv")] };
    }
  });
  await assert.rejects(service.expand({ shareCode: "share", maxDepth: 0 }), /maxDepth/);
  await assert.rejects(service.expand({ shareCode: "share", maxDirectories: 1 }), /maxDirectories/);
  await assert.rejects(service.expand({ shareCode: "share", maxFiles: 0 }), /maxFiles must be a positive integer/);
});
