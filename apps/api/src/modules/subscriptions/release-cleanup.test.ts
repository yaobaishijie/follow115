import assert from "node:assert/strict";
import test from "node:test";
import type { Pan115Item } from "../pan115/directory-model.js";
import { ReleaseCleanupWorker, ReleaseVerificationPendingError, type ReleaseCleanupSnapshot, type ReleaseCleanupStore } from "./release-cleanup.js";

const snapshot: ReleaseCleanupSnapshot = { requestId: "req-1", subscriptionId: "sub-1", generation: 2, targetSeasonCid: "season-cid", requestStatus: "queued", subscriptionStatus: "paused", currentGeneration: 2 };
class Store implements ReleaseCleanupStore {
  current: ReleaseCleanupSnapshot | null = snapshot; completed = 0; failed = 0; verifying: string[][] = [];
  async get() { return this.current; }
  async claim() { return true; }
  async markVerifying(_snapshot: ReleaseCleanupSnapshot, ids: readonly string[]) { this.verifying.push([...ids]); }
  async markCompleted() { this.completed += 1; }
  async markFailed() { this.failed += 1; }
}
const item = (id: string, isDirectory = false): Pan115Item => ({ id, cid: isDirectory ? id : null, fid: isDirectory ? null : id, name: id, isDirectory, size: 0, pickCode: null, raw: {} });

test("release preserves the Season CID and submits only its direct children", async () => {
  const store = new Store(); const deleted: string[][] = [];
  const worker = new ReleaseCleanupWorker(store, { async listDirectEntries() { return [item("file-1"), item("child-folder", true)]; } }, { async deleteFiles(ids) { deleted.push([...ids]); } });
  await assert.rejects(worker.run("req-1", false), ReleaseVerificationPendingError);
  assert.deepEqual(deleted, [["file-1", "child-folder"]]);
  assert.ok(!deleted.flat().includes("season-cid"));
  assert.deepEqual(store.verifying, [["file-1", "child-folder"]]);
});

test("an empty live directory is the only successful release condition", async () => {
  const store = new Store();
  const worker = new ReleaseCleanupWorker(store, { async listDirectEntries() { return []; } }, { async deleteFiles() { assert.fail("must not delete"); } });
  assert.deepEqual(await worker.run("req-1", false), { kind: "completed", removedEntryCount: 0 });
  assert.equal(store.completed, 1);
});

test("the final verification fails safely without another destructive submission", async () => {
  const store = new Store(); let deletes = 0;
  const worker = new ReleaseCleanupWorker(store, { async listDirectEntries() { return [item("remaining")]; } }, { async deleteFiles() { deletes += 1; } });
  assert.deepEqual(await worker.run("req-1", true), { kind: "failed", remainingEntryCount: 1 });
  assert.equal(deletes, 0); assert.equal(store.failed, 1);
});
