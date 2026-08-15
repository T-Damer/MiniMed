import type { JSX } from 'solid-js';

import { ANDROID_APK_URL, GITHUB_REPOSITORY_URL } from '../../../../release';

interface ReleaseLinksProps {
  readonly linkClass?: string;
}

export function ReleaseLinks(props: ReleaseLinksProps = {}): JSX.Element {
  return (
    <>
      <a class={props.linkClass} href={GITHUB_REPOSITORY_URL} target="_blank" rel="noreferrer">
        GitHub
      </a>
      <a class={props.linkClass} href={ANDROID_APK_URL}>
        Android APK
      </a>
    </>
  );
}
