import assert from "node:assert/strict";
import test from "node:test";
import { PostgresCleanupCandidateRepository } from "./repository.js";

test("upserts only pending local cleanup recommendations and previews joined file names", async () => {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  const repository = new PostgresCleanupCandidateRepository({ async query<Row>(text: string, values?: readonly unknown[]) {
    if (values === undefined) calls.push({ text }); else calls.push({ text, values });
    return { rows: (text.includes("SELECT c.id") ? [{ id: "c-1", subscriptionId: "sub-1", title: "藏海传", episodeKey: "S01E18", keepFileId: "high", keepName: "藏海传.S01E18.2160p.mkv", keepQuality: "2160p", removeFileId: "low", removeName: "藏海传.S01E18.1080p.mkv", removeQuality: "1080p", reason: "保留 2160P" }] : []) as Row[] };
  } });
  await repository.upsertPending([{ subscriptionId: "sub-1", episodeKey: "S01E18", keepFileId: "high", removeFileId: "low", keepQuality: "2160p", removeQuality: "1080p", reason: "保留 2160P" }]);
  const items = await repository.listPending();
  assert.match(calls[0]!.text, /ON CONFLICT \(subscription_id, remove_file_id\)/);
  assert.match(calls[0]!.text, /WHERE cleanup_candidates.status = 'pending'/);
  assert.deepEqual(calls[0]!.values, ["sub-1", "S01E18", "high", "low", "2160p", "1080p", "保留 2160P"]);
  assert.deepEqual(items, [{ id: "c-1", subscriptionId: "sub-1", title: "藏海传", episodeKey: "S01E18", keep: { fileId: "high", name: "藏海传.S01E18.2160p.mkv", quality: "2160p" }, remove: { fileId: "low", name: "藏海传.S01E18.1080p.mkv", quality: "1080p" }, reason: "保留 2160P" }]);
});
