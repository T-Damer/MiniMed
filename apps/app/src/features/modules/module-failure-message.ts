const GENERIC = 'Набор не установлен: загрузка или проверка не завершена.';

/**
 * The one line a failed module download shows. The installer reports the technical cause; the doctor
 * gets what to do about it: the device is full (free space, then retry), the file is not on the
 * server (retry does not help yet), the content changed under the same version (update the app).
 */
export function describeModuleFailure(message: string | null): string {
  const text = (message ?? '').toLowerCase();
  if (text.includes('conflicting source-set digest')) {
    return 'Содержимое набора изменилось без новой версии. Обновите приложение: повторная загрузка этой версии не поможет.';
  }
  if (text.includes('quota') || text.includes('full disk')) {
    return 'Не хватает места на устройстве. Освободите место и нажмите «Повторить».';
  }
  if (text.includes('http 404')) {
    return 'Файла набора пока нет на сервере. Повторить можно позже.';
  }
  return GENERIC;
}
