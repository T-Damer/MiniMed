import { describe, expect, it } from 'vitest';

import { computerFolderSupported, sortComputerEntries } from '@/features/library/computer-folder';

describe('«Мой компьютер»', () => {
  it('lists folders first, then files, by name with numbers in order', () => {
    const entries = [
      { name: 'снимок 10.jpg', kind: 'file' },
      { name: 'Анализы', kind: 'folder' },
      { name: 'снимок 2.jpg', kind: 'file' },
      { name: 'архив', kind: 'folder' },
    ] as const;
    expect(sortComputerEntries(entries).map((entry) => entry.name)).toEqual([
      'Анализы',
      'архив',
      'снимок 2.jpg',
      'снимок 10.jpg',
    ]);
  });

  it('is unavailable without a browser folder picker', () => {
    expect(computerFolderSupported()).toBe(false);
  });
});
