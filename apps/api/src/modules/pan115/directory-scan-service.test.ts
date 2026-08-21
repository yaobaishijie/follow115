import assert from "node:assert/strict";
import test from "node:test";
import { createPan115DirectoryScanService } from "./directory-scan-service.js";
import type { Pan115FolderPageClient } from "./list-folder.js";

test("directory scan recursively paginates through an injected read-only client", async () => {
  const calls: Array<{ cid: string; offset: number }> = [];
  const client: Pan115FolderPageClient = {
    async listFolderPage({ cid, offset }) {
      calls.push({ cid, offset });
      if (cid === "root") {
        return offset === 0
          ? { count: 3, data: [{ n: "Season 02", cid: "season", is_dir: 1 }, { n: "Show.S02E01.1080p.mkv", fid: "file-1", s: 1 }] }
          : { count: 3, data: [{ n: "Show.Trailer.mkv", fid: "file-2", s: 1 }] };
      }
      return { count: 1, data: [{ n: "Show 第02集.2160p.mkv", fid: "file-3", s: 2 }] };
    }
  };

  const result = await createPan115DirectoryScanService(client).scan({ cid: "root", parentPath: ["影视库"], pageSize: 2 });

  assert.deepEqual(calls, [{ cid: "root", offset: 0 }, { cid: "root", offset: 2 }, { cid: "season", offset: 0 }]);
  assert.equal(result.directoriesScanned, 2);
  assert.equal(result.filesScanned, 3);
  assert.deepEqual(result.videos.map((video) => ({ name: video.item.name, parentPath: video.parentPath, keys: video.episodeKeys, quality: video.parsed.quality })), [
    { name: "Show 第02集.2160p.mkv", parentPath: ["影视库", "Season 02"], keys: ["S02E02"], quality: "2160p" },
    { name: "Show.S02E01.1080p.mkv", parentPath: ["影视库"], keys: ["S02E01"], quality: "1080p" }
  ]);
});

test("directory scan refuses cycles and unbounded depth", async () => {
  const client: Pan115FolderPageClient = {
    async listFolderPage({ cid }) {
      return cid === "root" ? { data: [{ n: "loop", cid: "root", is_dir: 1 }] } : { data: [] };
    }
  };
  const result = await createPan115DirectoryScanService(client).scan({ cid: "root" });
  assert.equal(result.directoriesScanned, 1);

  const nestedClient: Pan115FolderPageClient = {
    async listFolderPage({ cid }) {
      return cid === "root" ? { data: [{ n: "child", cid: "child", is_dir: 1 }] } : { data: [] };
    }
  };
  await assert.rejects(createPan115DirectoryScanService(nestedClient).scan({ cid: "root", maxDepth: 0 }), /maxDepth/);
});
