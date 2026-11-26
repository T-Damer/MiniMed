import { describe, expect, it } from 'vitest';
import { companionPresetId } from '@/diary/companion-avatar';
import { companionHelpIntent, companionReply } from '@/diary/companion-dialogue';

describe('offline companion replies', () => {
  it('recognizes complete conversational acts without classifying patient narratives', () => {
    expect(companionReply('Спасибо!', 0)).toContain('Пожалуйста');
    expect(companionReply('Не знаю…', 0)).toContain('парой слов');
    expect(companionReply('Не сейчас.', 0)).toContain('когда вам будет удобно');
    expect(companionReply('У мамы давление 150, спасибо что спросили', 0)).toContain('рассказали');
  });

  it('offers help on a direct request and does not classify a narrative or negation', () => {
    expect(companionHelpIntent('Мне нужна срочная помощь!')).toBe(true);
    expect(companionHelpIntent('Я хочу навредить себе')).toBe(true);
    expect(companionHelpIntent('Я не хочу навредить себе')).toBe(false);
    expect(companionHelpIntent('Друг сказал, что хочет навредить себе')).toBe(false);
    expect(companionReply('Мне сейчас небезопасно', 1)).toContain('контакты помощи');
  });

  it('routes questions to the doctor and varies ordinary follow-ups', () => {
    expect(companionReply('Почему я так себя чувствую?', 0)).toContain('для врача');
    expect(companionReply('Я гуляла', 0)).not.toBe(companionReply('Я гуляла', 1));
  });
});

describe('fixed companion identity', () => {
  it('chooses reproducibly for the same diary, with a distributed fixed pool', () => {
    expect(companionPresetId('companion01')).toBe(companionPresetId('companion01'));
    const assigned = new Set(
      Array.from({ length: 120 }, (_, index) => companionPresetId(`diary-${index}`)),
    );
    expect(assigned.size).toBe(12);
  });
});
