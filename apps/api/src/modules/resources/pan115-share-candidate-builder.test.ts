import assert from "node:assert/strict";
import test from "node:test";
import type { Pan115Item } from "../pan115/directory-model.js";
import { Pan115ShareCandidateBuilder } from "./pan115-share-candidate-builder.js";

const file = (name: string, parentPath: string[]): { item: Pan115Item; parentCid: string | null; parentPath: string[] } => ({
  item: { id: name, fid: name, cid: null, name, isDirectory: false, size: 1, pickCode: null, raw: {} }, parentCid: "season", parentPath
});

test("expanded share candidates use real feature files and parent-path season recognition", async () => {
  const builder = new Pan115ShareCandidateBuilder({
    async expand(input) {
      assert.deepEqual(input, { shareCode: "share", receiveCode: "code" });
      return { rootCid: null, directoriesScanned: 1, filesScanned: 3, files: [
        file("藏海传.E01-E02.2160p.mkv", ["Season 02"]),
        file("藏海传.第3集.1080p.mp4", ["第二季"]),
        file("藏海传.花絮.E04.2160p.mkv", ["Season 02"])
      ] };
    }
  });

  const candidate = await builder.build(
    { share: { shareCode: "share", receiveCode: "code", url: "https://115.com/s/share?password=code" }, messageText: "藏海传 资源", channelSortOrder: 2 },
    { mediaType: "series", seasonNumber: 2 }
  );

  assert.ok(candidate);
  assert.deepEqual(candidate.availableEpisodes, [1, 2, 3]);
  assert.equal(candidate.parsedSeason, 2);
  assert.equal(candidate.channelSortOrder, 2);
  assert.match(candidate.title, /2160p/u);
});

test("expanded share with no current-season feature video is never made eligible", async () => {
  const builder = new Pan115ShareCandidateBuilder({
    async expand() { return { rootCid: null, directoriesScanned: 1, filesScanned: 1, files: [file("预告.E01.2160p.mkv", ["Season 02"])] }; }
  });
  assert.equal(await builder.build(
    { share: { shareCode: "share", url: "https://115.com/s/share" }, messageText: "藏海传", channelSortOrder: 0 },
    { mediaType: "series", seasonNumber: 2 }
  ), null);
});
