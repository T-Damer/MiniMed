import type { JSX } from 'solid-js';

import { HomeFeatureCard } from '@/features/search/HomeFeatureCard';
import { SKIN_CLASSES } from '@/features/skin/skin-model';
import { SKIN_PHOTO_TOOL } from '@/features/skin/skin-tool';
import { pluralRu } from '@/i18n/labels';

/** Home entry of the experimental «Кожа по фото»: the camera is one tap away. */
export function SkinHomeEntry(): JSX.Element {
  const count = SKIN_CLASSES.length;
  return (
    <HomeFeatureCard
      icon={SKIN_PHOTO_TOOL.icon}
      title={SKIN_PHOTO_TOOL.title}
      text={`Сходство снимка с ${count} ${pluralRu(count, 'состоянием', 'состояниями', 'состояниями')} кожи, фото остаётся на устройстве`}
      action={{ label: 'Открыть камеру', icon: 'camera', href: SKIN_PHOTO_TOOL.href }}
      helpHref={SKIN_PHOTO_TOOL.href}
    />
  );
}
