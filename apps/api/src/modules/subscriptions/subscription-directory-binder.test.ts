import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryCredentialStore } from "../settings/settings-service.js";
import { Pan115SubscriptionDirectoryBinder } from "./subscription-directory-binder.js";

function fixture(tree: Record<string, unknown[]> = {}) {
  const credentials = new InMemoryCredentialStore();
  const creates: Array<{ parentCid: string; name: string }> = [];
  const reader = { async listFolderPage({ cid }: { cid: string }) { const data = tree[cid] ?? []; return { data, count: data.length }; } };
  const writer = { async createFolder(parentCid: string, name: string) { creates.push({ parentCid, name }); return { cid: `${parentCid}-${creates.length}`, name, raw: {} }; } };
  return { credentials, creates, binder: new Pan115SubscriptionDirectoryBinder(credentials, () => reader, () => writer) };
}

test("binder reuses a title/year Series and a Chinese Season alias without renaming", async () => {
  const { credentials, creates, binder } = fixture({ category: [{ n: "最后生还者 (2023)", cid: "series", is_dir: 1 }], series: [{ n: "第二季", cid: "season", is_dir: 1 }] });
  await credentials.savePan115Credential({ cookie: "saved", verifiedAt: new Date().toISOString() });
  assert.deepEqual(await binder.bind({ mediaType: "series", title: "最后生还者", year: 2023, tmdbId: null, seasonNumber: 2, categoryFolderCid: "category", categoryFolderPath: "影视库 / 美剧" }), {
    targetSeriesCid: "series", targetSeriesPath: "影视库 / 美剧 / 最后生还者 (2023)", targetSeasonCid: "season", targetSeasonPath: "影视库 / 美剧 / 最后生还者 (2023) / 第二季"
  });
  assert.deepEqual(creates, []);
});

test("binder creates only canonical Series and Season names when missing", async () => {
  const { credentials, creates, binder } = fixture();
  await credentials.savePan115Credential({ cookie: "saved", verifiedAt: new Date().toISOString() });
  const result = await binder.bind({ mediaType: "series", title: "新剧", year: 2026, tmdbId: 12, seasonNumber: 1, categoryFolderCid: "category", categoryFolderPath: "影视库 / 电视剧" });
  assert.deepEqual(creates, [{ parentCid: "category", name: "新剧 (2026) [tmdbid-12]" }, { parentCid: "category-1", name: "Season 01" }]);
  assert.equal(result.targetSeasonPath, "影视库 / 电视剧 / 新剧 (2026) [tmdbid-12] / Season 01");
});

test("movies bind the Series directory itself as the target directory", async () => {
  const { credentials, creates, binder } = fixture();
  await credentials.savePan115Credential({ cookie: "saved", verifiedAt: new Date().toISOString() });
  const result = await binder.bind({ mediaType: "movie", title: "电影", year: 2026, tmdbId: null, seasonNumber: 0, categoryFolderCid: "category", categoryFolderPath: "影视库 / 电影" });
  assert.equal(result.targetSeasonCid, result.targetSeriesCid);
  assert.equal(creates.length, 1);
});
