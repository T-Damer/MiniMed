import type { JSX } from 'solid-js';

import { EcgHomeEntry } from '@/features/calculators/EcgHomeEntry';

import './search-welcome.css';

function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 18) return 'Добрый день';
  if (hour >= 18 && hour < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

/** The page heading above the search field: greeting and what can be searched. */
export function SearchGreeting(): JSX.Element {
  return (
    <div class="search-greeting">
      <h1 class="search-greeting__title">{greeting(new Date().getHours())}</h1>
      <p class="search-greeting__text">
        Ищите болезнь, препарат или код МКБ — или опишите случай своими словами. Всё работает без
        интернета.
      </p>
    </div>
  );
}

/**
 * The capability under the search field while it is empty. The tools themselves live in the tool
 * row and the «Все инструменты» sheet; this block folds away once a search starts.
 */
export function SearchWelcome(): JSX.Element {
  return (
    <div class="search-welcome__content">
      <div class="search-welcome__feature">
        <EcgHomeEntry />
      </div>
    </div>
  );
}
