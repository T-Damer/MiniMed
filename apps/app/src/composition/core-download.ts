// Android downloads a separately published encoding of the same corpus. `checksum` is the exact
// SQLite file that gets installed; `url` is its gzip transfer (76 MB instead of 441 MB), whose own
// checksum and size are recorded in core-report.json. The native installer inflates the stream and
// verifies the decoded checksum, so a damaged or truncated archive never becomes an installed core.
// The raw `MiniMed-*-core.db` asset of the same release stays published for older app builds.
export const ANDROID_CORE_DOWNLOAD = {
  url: 'https://github.com/T-Damer/MiniMed/releases/download/core-0.6.47/core.db.gz',
  compression: 'gzip',
  transferSha256: 'sha256:a5d0e3b5dfc418c4208c171d365afc03a956fae75bd5ddeee3b956ae814392c5',
  transferSizeBytes: 76_268_794,
  checksum: 'sha256:8e6fe3bf5874c63b0df0e260fccf0905c6af1ac06e8b93ea5039a2f6ad1318d4',
} as const;

/**
 * What the user downloads for the core, for copy such as «Скачать · 76 МБ». Browser and Android
 * both fetch the gzip archive of the same corpus; their sizes differ by kilobytes.
 */
export const CORE_DOWNLOAD_SIZE_LABEL = `${Math.round(ANDROID_CORE_DOWNLOAD.transferSizeBytes / 1_000_000)} МБ`;
