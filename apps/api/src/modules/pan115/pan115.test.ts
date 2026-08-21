import assert from "node:assert/strict";
import test from "node:test";
import { buildSeasonFolderName, buildSeriesFolderName, inferStorageCategory } from "./directory-model.js";
import { buildEpisodeFileName, episodeKeys, parseEpisodeRange, parseVideoFile } from "./file-parser.js";
import { normalizePan115FolderPage, readAllFolderPages, type Pan115FolderPageClient } from "./list-folder.js";

test("normalizes the documented 115 list-field variants", () => {
  const page = normalizePan115FolderPage({ count: "2", data: [{ n: "Season 02", cid: "12", fc: "0" }, { fileName: "show.mkv", fileId: 99, size: "4096", pickCode: "pc" }] });
  assert.deepEqual(page.items.map(({ id, cid, fid, name, isDirectory, size, pickCode }) => ({ id, cid, fid, name, isDirectory, size, pickCode })), [
    { id: "12", cid: "12", fid: null, name: "Season 02", isDirectory: true, size: 0, pickCode: null },
    { id: "99", cid: null, fid: "99", name: "show.mkv", isDirectory: false, size: 4096, pickCode: "pc" }
  ]);
});

test("read-only folder reader consumes every page", async () => {
  const calls: number[] = [];
  const client: Pan115FolderPageClient = { listFolderPage: async ({ offset }) => { calls.push(offset); return { count: 3, data: offset === 0 ? [{ n: "A", cid: "1", is_dir: 1 }, { n: "B", cid: "2", is_dir: 1 }] : [{ n: "C", cid: "3", is_dir: 1 }] }; } };
  assert.equal((await readAllFolderPages(client, "0", { pageSize: 2 })).length, 3);
  assert.deepEqual(calls, [0, 2]);
});

test("PRD storage category priority and directory formats are stable", () => {
  assert.equal(inferStorageCategory({ mediaType: "movie", genres: ["动画"] }), "movie");
  assert.equal(inferStorageCategory({ mediaType: "series", regions: ["美国"] }), "us_drama");
  assert.equal(inferStorageCategory({ mediaType: "series", genres: ["真人秀"] }), "variety");
  assert.equal(buildSeriesFolderName({ title: "最后生还者", year: 2023, tmdbId: 100 }), "最后生还者 (2023) [tmdbid-100]");
  assert.equal(buildSeasonFolderName(2), "Season 02");
});

test("episode parsing preserves a parent path's season and supports ranges", () => {
  assert.deepEqual(parseEpisodeRange("show 第03集.mkv", ["Show", "第二季"]), { season: 2, episodeStart: 3, episodeEnd: 3 });
  assert.deepEqual(parseEpisodeRange("Show.S02E01-E02.2160p.mkv"), { season: 2, episodeStart: 1, episodeEnd: 2 });
  assert.deepEqual(episodeKeys({ season: 2, episodeStart: 1, episodeEnd: 2 }), ["S02E01", "S02E02"]);
  assert.equal(parseVideoFile("Show.Trailer.2160p.mkv").isFeature, false);
  assert.equal(parseVideoFile("Show.S01E01.2160p.mkv").quality, "2160p");
  assert.equal(buildEpisodeFileName({ title: "Show", year: 2024, season: 1, episodeStart: 1, extension: "MKV", quality: "2160p" }), "Show (2024) - S01E01 [2160p].mkv");
});
