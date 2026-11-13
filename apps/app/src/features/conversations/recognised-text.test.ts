import { describe, expect, it } from 'vitest';

import { cleanRecognisedText } from './recognised-text';

describe('cleanRecognisedText', () => {
  it('drops the subtitle credits Whisper invents on quiet audio', () => {
    expect(cleanRecognisedText('Субтитры сделал DimaTorzok')).toBe('');
    expect(cleanRecognisedText('Продолжение следует...')).toBe('');
    expect(cleanRecognisedText(' Спасибо за просмотр! ')).toBe('');
    expect(cleanRecognisedText('[Музыка]')).toBe('');
    expect(cleanRecognisedText('...')).toBe('');
  });

  it('keeps real speech around a phantom sentence', () => {
    expect(cleanRecognisedText('Я плохо сплю. Продолжение следует... Просыпаюсь в четыре.')).toBe(
      'Я плохо сплю. Просыпаюсь в четыре.',
    );
  });

  it('cuts a loop to one occurrence and leaves ordinary repeats alone', () => {
    expect(cleanRecognisedText('да да да да да')).toBe('да да');
    expect(cleanRecognisedText('я не знаю я не знаю я не знаю я не знаю')).toBe('я не знаю');
    expect(cleanRecognisedText('нет, нет. Всё хорошо')).toBe('нет, нет. Всё хорошо');
  });

  it('normalises spaces', () => {
    expect(cleanRecognisedText('  Добрый   день ')).toBe('Добрый день');
  });
});
