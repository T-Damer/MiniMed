import type { JSX } from 'solid-js';

/** What protects the patient cards and what does not; shown behind the «?» of the patients page and of Settings. */
export function PatientStorageHelp(): JSX.Element {
  return (
    <>
      <p>
        Карточки, осмотры и файлы хранятся только на этом устройстве и шифруются: на Android ключ
        лежит в защищённой памяти телефона, в браузере это ключ самого браузера.
      </p>
      <p>
        Браузерный ключ не защитит от человека, открывшего ваш профиль браузера, а очистка данных
        сайта сотрёт и ключ, и карточки. Для реальных пациентов используйте приложение для Android.
      </p>
    </>
  );
}
