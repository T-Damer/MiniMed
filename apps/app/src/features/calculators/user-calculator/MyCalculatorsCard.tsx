import type { JSX } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { pluralRu } from '@/i18n/labels';

import '@/features/calculators/user-calculator/user-calculator.css';

export function myCalculatorsCountLabel(count: number): string {
  return count === 0
    ? 'Пока нет своих калькуляторов — создайте первый'
    : `${count} ${pluralRu(count, 'калькулятор', 'калькулятора', 'калькуляторов')} на этом устройстве`;
}

/**
 * The entry to «Мои калькуляторы» on the calculators home: a compact row after the catalog, always
 * there, even when the list is empty.
 */
export function MyCalculatorsCard(props: {
  readonly count: number;
  readonly onOpen: () => void;
}): JSX.Element {
  return (
    <section class="my-calculators-card paper-card" data-testid="calculator-section-custom">
      <button
        type="button"
        class="my-calculators-card__hit-area"
        aria-label="Открыть раздел «Мои калькуляторы»"
        onClick={props.onOpen}
      />
      <AppGlyph name="calculator" class="my-calculators-card__icon" />
      <div class="my-calculators-card__copy">
        <h2 class="my-calculators-card__title">Мои калькуляторы</h2>
        <small class="my-calculators-card__count">{myCalculatorsCountLabel(props.count)}</small>
      </div>
      <AppGlyph name="caret-right" class="my-calculators-card__caret" />
    </section>
  );
}
