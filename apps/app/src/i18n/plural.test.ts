import { describe, expect, it } from 'vitest';

import { pluralRu } from './labels';

describe('pluralRu', () => {
  it('chooses the Russian one/few/many form', () => {
    const form = (count: number) => pluralRu(count, 'файл', 'файла', 'файлов');
    expect([1, 2, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(form)).toEqual([
      'файл',
      'файла',
      'файлов',
      'файлов',
      'файлов',
      'файлов',
      'файл',
      'файла',
      'файлов',
      'файл',
      'файлов',
    ]);
  });
});
