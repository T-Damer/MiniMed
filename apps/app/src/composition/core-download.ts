// Android downloads a separately published encoding of the same corpus. `checksum` is the exact
// SQLite file that gets installed; `url` is its gzip transfer (76 MB instead of 441 MB), whose own
// checksum and size are recorded in core-report.json. The native installer inflates the stream and
// verifies the decoded checksum, so a damaged or truncated archive never becomes an installed core.
// The raw `MiniMed-*-core.db` asset of the same release stays published for older app builds.
export const ANDROID_CORE_DOWNLOAD = {
  url: 'https://github.com/T-Damer/MiniMed/releases/download/core-0.6.64/core.db.gz',
  compression: 'gzip',
  transferSha256: 'sha256:9e6570090bf3842872621e1261960be92e570e864bff92b10aa2f851e5f6ce2e',
  transferSizeBytes: 77_454_008,
  checksum: 'sha256:1e25041f97be5fd6fb2dd67013bb384a436362c5c32498fdda2a07983321229a',
} as const;

/**
 * What the user downloads for the core, for copy such as «Скачать · 76 МБ». Browser and Android
 * both fetch the gzip archive of the same corpus; their sizes differ by kilobytes.
 */
export const CORE_DOWNLOAD_SIZE_LABEL = `${Math.round(ANDROID_CORE_DOWNLOAD.transferSizeBytes / 1_000_000)} МБ`;
