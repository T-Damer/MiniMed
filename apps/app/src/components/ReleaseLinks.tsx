import { Capacitor } from '@capacitor/core';
import type { JSX } from 'solid-js';
import { For } from 'solid-js';

import { diaryPageUrl } from '@/features/diary/diary-links';
import { appVariantLinks, defaultAppVariantUrls } from '@/state/app-variants';

interface ReleaseLinksProps {
  readonly linkClass?: string;
}

/** The app's other variants (never the one running now) and the source repository. */
export function ReleaseLinks(props: ReleaseLinksProps = {}): JSX.Element {
  const links = appVariantLinks(
    {
      nativePlatform: Capacitor.getPlatform(),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
    },
    defaultAppVariantUrls(diaryPageUrl()),
  );
  return (
    <For each={links}>
      {(link) => (
        <a
          class={props.linkClass}
          href={link.href}
          target={link.external ? '_blank' : undefined}
          rel={link.external ? 'noreferrer' : undefined}
        >
          {link.label}
        </a>
      )}
    </For>
  );
}
