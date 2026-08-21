import assert from "node:assert/strict";
import test from "node:test";
import { generateDuplicateCleanupCandidates, type ScannedMediaFile } from "./duplicate-candidate-generator.js";

const file = (input: Partial<ScannedMediaFile> & Pick<ScannedMediaFile, "fileId" | "episodeKeys" | "quality">): ScannedMediaFile => ({
  name: input.fileId, addedAt: "2026-01-01T00:00:00.000Z", isVideo: true, isParseable: true, ...input
});

test("generates deterministic duplicate removals by quality, then by earlier addedAt", () => {
  const candidates = generateDuplicateCleanupCandidates("sub-1", [
    file({ fileId: "high", episodeKeys: ["S01E18"], quality: "2160p", addedAt: "2026-02-01" }),
    file({ fileId: "low", episodeKeys: ["S01E18"], quality: "1080p" }),
    file({ fileId: "old", episodeKeys: ["S01E19"], quality: "1080p", addedAt: "2026-01-01" }),
    file({ fileId: "new", episodeKeys: ["S01E19"], quality: "1080p", addedAt: "2026-02-01" })
  ]);
  assert.deepEqual(candidates.map(({ episodeKey, keepFileId, removeFileId, keepQuality, removeQuality }) => ({ episodeKey, keepFileId, removeFileId, keepQuality, removeQuality })), [
    { episodeKey: "S01E18", keepFileId: "high", removeFileId: "low", keepQuality: "2160p", removeQuality: "1080p" },
    { episodeKey: "S01E19", keepFileId: "old", removeFileId: "new", keepQuality: "1080p", removeQuality: "1080p" }
  ]);
});

test("does not generate ambiguous, unparseable, non-video, or multi-episode deletions", () => {
  assert.deepEqual(generateDuplicateCleanupCandidates("sub-1", [
    file({ fileId: "unknown", episodeKeys: ["S01E01"], quality: "unknown" }),
    file({ fileId: "known", episodeKeys: ["S01E01"], quality: "1080p" }),
    file({ fileId: "unknown-with-high", episodeKeys: ["S01E06"], quality: "unknown" }),
    file({ fileId: "high-with-unknown", episodeKeys: ["S01E06"], quality: "2160p" }),
    file({ fileId: "low-with-unknown", episodeKeys: ["S01E06"], quality: "1080p" }),
    file({ fileId: "nodate-a", episodeKeys: ["S01E02"], quality: "1080p", addedAt: null }),
    file({ fileId: "nodate-b", episodeKeys: ["S01E02"], quality: "1080p", addedAt: null }),
    file({ fileId: "range-a", episodeKeys: ["S01E03", "S01E04"], quality: "2160p" }),
    file({ fileId: "range-b", episodeKeys: ["S01E03", "S01E04"], quality: "1080p" }),
    file({ fileId: "subtitle", episodeKeys: ["S01E05"], quality: "1080p", isVideo: false })
  ]), []);
});
