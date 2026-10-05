import { toast } from 'solid-sonner';

import {
  OPEN_APP_SETTINGS_LABEL,
  openMicrophoneSettings,
} from '@/features/conversations/microphone-access';

/** A microphone error toast; Android's app settings are offered only when the OS refused. */
export function toastMicrophoneError(message: string, openSettings: boolean): void {
  if (!openSettings) {
    toast.error(message);
    return;
  }
  toast.error(message, {
    action: {
      label: OPEN_APP_SETTINGS_LABEL,
      onClick: () => {
        openMicrophoneSettings().catch(() =>
          toast.error('Не удалось открыть настройки приложения.'),
        );
      },
    },
  });
}
