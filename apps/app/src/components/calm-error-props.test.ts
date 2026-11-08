import { describe, expect, it } from 'vitest';

import { calmErrorProps } from '@/components/calm-error-props';

describe('calmErrorProps', () => {
  it('draws the action only when the screen can perform it', () => {
    const retry = () => {};
    const state = {
      title: 'Нет сети',
      text: 'Показаны сохранённые записи.',
      action: 'retry',
    } as const;
    expect(calmErrorProps(state, { retry })).toEqual({
      title: 'Нет сети',
      detail: 'Показаны сохранённые записи.',
      actionLabel: 'Повторить',
      onAction: retry,
    });
    expect(calmErrorProps(state, {})).toEqual({
      title: 'Нет сети',
      detail: 'Показаны сохранённые записи.',
    });
    expect(calmErrorProps({ title: 'Лимит' }, { retry })).toEqual({ title: 'Лимит' });
  });
});
