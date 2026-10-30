/**
 * The published skin pack: the one place to fill after the release asset is uploaded
 * (tools/derm-cnn/build_skin_pack.py writes the ZIP; `shasum -a 256` and `stat` give the rest).
 * Until all four values are real, `skinPackOffer()` reports no pack and the app offers no download.
 */

/** `version` of skin-pack.json inside the ZIP. */
export const SKIN_PACK_VERSION = '2026.10.30';
/** The GitHub release asset, `https://github.com/T-Damer/MiniMed/releases/download/<tag>/<file>.zip`. */
export const SKIN_PACK_RELEASE_URL =
  'https://github.com/T-Damer/MiniMed/releases/download/models-preview-1/minimed-skin-pack-2026.10.30.zip';
/** SHA-256 of the whole ZIP, 64 lowercase hex characters. */
export const SKIN_PACK_SHA256 = '9c60ab2b83a79a83fab30fda14660340b71b3a14d972d87bfe6ddbf401f9d646';
/** Exact size of the ZIP in bytes. */
export const SKIN_PACK_DOWNLOAD_BYTES = 17_992_027;
