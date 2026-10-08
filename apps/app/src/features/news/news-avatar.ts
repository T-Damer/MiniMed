import { iconKeyFor } from '@/features/news/news-icons';
import { stableHash } from '@/features/news/news-state';
import type { Subscription } from '@/features/news/news-types';
import { bundledAvatarFor } from '@/features/news/suggested-avatars';
import { suggestedFeedById } from '@/features/news/suggested-feeds';

/** A stable colour for a name's monogram, 0-359; the lightness stays with the stylesheet. */
export function avatarHue(name: string): number {
  return Number.parseInt(stableHash(name.trim().toLowerCase()).slice(-6), 36) % 360;
}

/** One or two capital letters for the monogram: the first letters of the first two words. */
export function avatarInitials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word !== '');
  const letters = words.slice(0, 2).map((word) => [...word][0] ?? '');
  const initials = letters.join('').toUpperCase();
  return initials === '' ? '?' : initials;
}

export interface AvatarLook {
  /** A data URL: the fetched icon or the bundled one; absent for a monogram. */
  readonly src?: string;
  readonly hue: number;
  readonly mark: string;
}

/**
 * What a source's avatar looks like: the icon fetched from its site, else the one bundled for a
 * suggested source, else a monogram coloured by the name (a suggested source keeps its own mark and
 * hue from the data file).
 */
export function avatarLook(
  name: string,
  siteUrl: string | undefined,
  icons: Readonly<Record<string, string>>,
  suggestedId?: string,
): AvatarLook {
  const suggested = suggestedFeedById(suggestedId);
  const src =
    (siteUrl ? icons[iconKeyFor(siteUrl)] : undefined) ??
    (siteUrl ? bundledAvatarFor(siteUrl) : undefined);
  return {
    ...(src ? { src } : {}),
    hue: suggested?.visual.hue ?? avatarHue(name),
    mark: suggested?.visual.mark ?? avatarInitials(name),
  };
}

export function avatarLookOf(
  subscription: Subscription,
  icons: Readonly<Record<string, string>>,
): AvatarLook {
  return avatarLook(
    subscription.title,
    subscription.siteUrl ?? subscription.url,
    icons,
    subscription.suggestedId,
  );
}
