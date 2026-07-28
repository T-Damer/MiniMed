import type { JSX } from 'solid-js';

import { ANDROID_APK_URL, GITHUB_REPOSITORY_URL } from '../../../../release';

export function ReleaseLinks(): JSX.Element {
  return (
    <>
      <a href={GITHUB_REPOSITORY_URL} target="_blank" rel="noreferrer">
        GitHub
      </a>
      <a href={ANDROID_APK_URL}>Android APK</a>
    </>
  );
}
