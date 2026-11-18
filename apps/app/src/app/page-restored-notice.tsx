import { toast } from 'solid-sonner';
import {
  loadAppPreferences,
  setRestoreLastPage,
  setShowPageRestoreNotice,
} from '@/state/app-preferences';

export function showPageRestoredNotice(): void {
  if (!loadAppPreferences().showPageRestoreNotice) return;
  const id = 'last-page-restored';
  toast('Страница восстановлена', {
    id,
    duration: 8000,
    description: (
      <div class="app-notification__actions">
        <button
          type="button"
          class="app-notification__action"
          onClick={() => {
            setRestoreLastPage(false);
            toast.dismiss(id);
          }}
        >
          Отключить восстановление
        </button>
        <button
          type="button"
          class="app-notification__action"
          onClick={() => {
            setShowPageRestoreNotice(false);
            toast.dismiss(id);
          }}
        >
          Больше не показывать
        </button>
      </div>
    ),
  });
}
