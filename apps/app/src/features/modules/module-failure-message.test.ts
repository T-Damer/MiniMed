import { describe, expect, it } from 'vitest';

import { describeModuleFailure } from './module-failure-message';

describe('describeModuleFailure', () => {
  it('names a full device, whichever way the browser words it', () => {
    const full = 'Не хватает места на устройстве. Освободите место и нажмите «Повторить».';
    expect(
      describeModuleFailure(
        'QuotaExceededError: The current transaction exceeded its quota limitations.',
      ),
    ).toBe(full);
    expect(
      describeModuleFailure(
        'Encountered full disk while opening backing store for indexedDB.open.',
      ),
    ).toBe(full);
  });

  it('says a missing file is not the doctor’s fault, and keeps the changed-content advice', () => {
    expect(describeModuleFailure('Сервер ответил HTTP 404.')).toContain('нет на сервере');
    expect(describeModuleFailure('Artifact index has a conflicting source-set digest.')).toContain(
      'Обновите приложение',
    );
  });

  it('falls back to the general line', () => {
    expect(describeModuleFailure(null)).toBe(
      'Набор не установлен: загрузка или проверка не завершена.',
    );
    expect(describeModuleFailure('Module index validation failed: boom')).toBe(
      'Набор не установлен: загрузка или проверка не завершена.',
    );
  });
});
