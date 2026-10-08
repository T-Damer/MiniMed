// Android downloads a separately published encoding of the same corpus. `checksum` is the exact
// SQLite file that gets installed; `url` is its gzip transfer (76 MB instead of 441 MB), whose own
// checksum and size are recorded in core-report.json. The native installer inflates the stream and
// verifies the decoded checksum, so a damaged or truncated archive never becomes an installed core.
// The raw `MiniMed-*-core.db` asset of the same release stays published for older app builds.
export const ANDROID_CORE_DOWNLOAD = {
  url: 'https://github.com/T-Damer/MiniMed/releases/download/core-0.6.57/core.db.gz',
  compression: 'gzip',
  transferSha256: 'sha256:8033cf48189a3b6aad2264f1bd495b5a992d0bffe2825afe802c0e75405d00c2',
  transferSizeBytes: 75_935_899,
  checksum: 'sha256:56ca3ba79539180790257e22f294d6aead0402043b998989375d8db54246cdeb',
} as const;

/**
 * What the user downloads for the core, for copy such as «Скачать · 76 МБ». Browser and Android
 * both fetch the gzip archive of the same corpus; their sizes differ by kilobytes.
 */
export const CORE_DOWNLOAD_SIZE_LABEL = `${Math.round(ANDROID_CORE_DOWNLOAD.transferSizeBytes / 1_000_000)} МБ`;
