import assert from "node:assert/strict";
import test from "node:test";
import { DuplicateCleanupVerificationPendingError, DuplicateCleanupWorker, type DuplicateCleanupSnapshot, type DuplicateCleanupStore } from "./cleanup-worker.js";

const snapshot: DuplicateCleanupSnapshot = { candidateId: "candidate", subscriptionId: "subscription", episodeKey: "S01E18", targetSeasonCid: "season", keepFileId: "keep", removeFileId: "remove", keepQuality: "2160p", removeQuality: "1080p", status: "pending", releaseInProgress: false };
const item = (id: string, name: string) => ({ id, cid: null, fid: id, name, isDirectory: false, size: 1, pickCode: null, raw: null });

function store(events: string[]): DuplicateCleanupStore {
  return { async get() { return snapshot; }, async claim() { events.push("claim"); return true; }, async markCompleted() { events.push("completed"); }, async markSkipped() { events.push("skipped"); }, async markFailed() { events.push("failed"); } };
}

test("deletes only the precomputed lower-quality file after live episode revalidation", async () => {
  const events: string[] = []; const deleted: string[][] = [];
  const worker = new DuplicateCleanupWorker(store(events), { async listDirectEntries() { return [item("keep", "Show.S01E18.2160p.mkv"), item("remove", "Show.S01E18.1080p.mkv")]; } }, { async deleteFiles(ids) { deleted.push([...ids]); return { success: true }; } });
  await assert.rejects(() => worker.run("candidate", false), DuplicateCleanupVerificationPendingError);
  assert.deepEqual(deleted, [["remove"]]);
});

test("skips safely when the live files no longer match the fixed recommendation", async () => {
  const events: string[] = []; let deleted = false;
  const worker = new DuplicateCleanupWorker(store(events), { async listDirectEntries() { return [item("keep", "Show.S01E18.2160p.mkv"), item("remove", "Show.S01E19.1080p.mkv")]; } }, { async deleteFiles() { deleted = true; return { success: true }; } });
  assert.equal(await worker.run("candidate", false), "skipped");
  assert.equal(deleted, false); assert.deepEqual(events, ["claim", "skipped"]);
});

test("marks complete only when remove is absent and the recommended keep file remains", async () => {
  const events: string[] = [];
  const worker = new DuplicateCleanupWorker(store(events), { async listDirectEntries() { return [item("keep", "Show.S01E18.2160p.mkv")]; } }, { async deleteFiles() { throw new Error("must not delete"); } });
  assert.equal(await worker.run("candidate", false), "completed");
  assert.deepEqual(events, ["claim", "completed"]);
});
