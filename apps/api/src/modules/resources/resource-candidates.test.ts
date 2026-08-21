import assert from "node:assert/strict";
import test from "node:test";
import {
  compareResourceCandidates,
  detectResourceQuality,
  extractBtbtlaDetailPaths,
  extractBtbtlaDownloadPaths,
  extractBtbtlaMagnets,
  extractPan115Shares,
  isPermanentlyBlacklisted,
  normalizeInfoHash,
  normalizeResourceCandidate,
  parsePan115ShareUrl,
  sortEligibleResourceCandidates
} from "./resource-candidates.js";

test("parses and extracts only approved 115 share URLs", () => {
  assert.deepEqual(parsePan115ShareUrl("https://115.com/s/abc_12?password=pass"), {
    shareCode: "abc_12", receiveCode: "pass", url: "https://115.com/s/abc_12?password=pass"
  });
  assert.equal(parsePan115ShareUrl("https://115.com/s/abc/path"), null);
  assert.equal(parsePan115ShareUrl("https://pan.baidu.com/s/abc"), null);
  assert.deepEqual(extractPan115Shares("a https://anxia.com/s/A?password=x， https://115cdn.com/s/A and https://115.com/s/B."), [
    { shareCode: "A", receiveCode: "x", url: "https://anxia.com/s/A?password=x" },
    { shareCode: "B", url: "https://115.com/s/B" }
  ]);
});

test("extracts btbtla internal paths and magnets without fetching", () => {
  const html = '<a href="/detail/100.html">A</a><a href="/detail/100.html">B</a><a href="/tdown/x">D</a> magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&amp;dn=x';
  assert.deepEqual(extractBtbtlaDetailPaths(html), ["/detail/100.html"]);
  assert.deepEqual(extractBtbtlaDownloadPaths(html), ["/tdown/x"]);
  assert.deepEqual(extractBtbtlaMagnets(html), ["magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=x"]);
  assert.equal(normalizeInfoHash("magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"), "abcdef0123456789abcdef0123456789abcdef01");
});

test("normalizes quality and rejects only explicitly low quality", () => {
  assert.equal(detectResourceQuality("Movie.3840x2160.UHD"), "2160p");
  assert.equal(detectResourceQuality("Movie.FHD"), "1080p");
  assert.equal(detectResourceQuality("Movie.720p"), "below_1080p");
  assert.equal(detectResourceQuality("Movie.WEB"), "unknown");
});

test("normalizes series candidate coverage and applies strict season and episode gates", () => {
  const context = { mediaType: "series" as const, title: "Example Show", aliases: ["示例剧"], seasonNumber: 2, missingEpisodes: [4, 7, 8] };
  const candidate = normalizeResourceCandidate({
    source: "pan115", title: "示例剧 S02E04-E08 1080P 全集", shareUrl: "https://115.com/s/share" , channelSortOrder: 5
  }, context);
  assert.equal(candidate.rejectionReason, undefined);
  assert.deepEqual(candidate.episodes, [4, 5, 6, 7, 8]);
  assert.equal(candidate.coversAllMissing, true);
  assert.equal(candidate.missingCoverageCount, 3);
  assert.equal(candidate.isSeasonPackage, true);

  const wrongSeason = normalizeResourceCandidate({ source: "pan115", title: "Example Show S01E04 1080p", shareUrl: "https://115.com/s/wrong" }, context);
  assert.equal(wrongSeason.rejectionReason, "season_mismatch");
  const noEpisode = normalizeResourceCandidate({ source: "pan115", title: "Example Show S02 1080p", shareUrl: "https://115.com/s/no-episode" }, context);
  assert.equal(noEpisode.rejectionReason, "episode_missing");
});

test("sorts complete coverage before quality, then follows the PRD comparator", () => {
  const context = { mediaType: "series" as const, title: "Show", seasonNumber: 1, missingEpisodes: [4, 7, 8], preferredGroupKey: "group" };
  const complete1080 = normalizeResourceCandidate({ source: "pan115", title: "Show S01E04-E08 1080p", shareUrl: "https://115.com/s/a", channelSortOrder: 9 }, context);
  const partial4k = normalizeResourceCandidate({ source: "pan115", title: "Show S01E07-E08 2160p", shareUrl: "https://115.com/s/b", channelSortOrder: 1 }, context);
  const complete4k = normalizeResourceCandidate({ source: "pan115", title: "Show S01E04-E08 2160p", shareUrl: "https://115.com/s/c", channelSortOrder: 4, groupKey: "group" }, context);
  assert.deepEqual(sortEligibleResourceCandidates([complete1080, partial4k, complete4k]).map((candidate) => candidate.candidateKey), ["c", "a", "b"]);
  assert.ok(compareResourceCandidates(complete1080, partial4k) < 0);
});

test("uses shareCode/infoHash keys and blacklists after two confirmed resource failures", () => {
  const movie = normalizeResourceCandidate({ source: "magnet", title: "Movie 1080p", magnet: "ABCDEF0123456789ABCDEF0123456789ABCDEF01" }, { mediaType: "movie", title: "Movie" });
  assert.equal(movie.candidateKey, "abcdef0123456789abcdef0123456789abcdef01");
  assert.equal(isPermanentlyBlacklisted({ failureCount: 1, isBlacklisted: false }), false);
  assert.equal(isPermanentlyBlacklisted({ failureCount: 2, isBlacklisted: false }), true);
  assert.equal(isPermanentlyBlacklisted({ failureCount: 0, isBlacklisted: true }), true);
});
