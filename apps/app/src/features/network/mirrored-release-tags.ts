/**
 * Data prereleases whose `.db.gz` assets the Pages build mirrors under `content/releases/<tag>/`.
 * Shared by the app's URL resolver and the Pages workflow's mirror list; keep it dependency-free.
 */
export const MIRRORED_DATA_RELEASE_TAG =
  /^(?:terminology|definition-reference|reference-krasotaimedicina)-[0-9a-z.-]+$/u;
