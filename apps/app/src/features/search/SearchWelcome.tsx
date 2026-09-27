import { For, type JSX } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { EcgHomeEntry } from '@/features/calculators/EcgHomeEntry';
import {
  conversationSession,
  startConversation,
} from '@/features/conversations/conversation-session';
import { experimentalModulesEnabled } from '@/state/experimental-modules';

import './search-welcome.css';

function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 18) return 'Добрый день';
  if (hour >= 18 && hour < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

interface WelcomeLink {
  readonly icon: AppGlyphName;
  readonly label: string;
  readonly href?: string;
  readonly onClick?: () => void;
  readonly primary?: boolean;
  /** Shown only while experimental modules are enabled. */
  readonly experimental?: boolean;
  /** Reads the medical core, so it waits until the core is open. */
  readonly requiresCore?: boolean;
}

/**
 * First screen of search, collapsed as soon as typing starts: what can be searched, the key tools,
 * and the ECG photo entry as one of the capabilities — a single block rather than separate cards.
 */
export function SearchWelcome(props: {
  readonly onOpenReference: () => void;
  /** False while the medical core opens; entries that read it are disabled until then. */
  readonly coreReady?: boolean;
}): JSX.Element {
  const links: readonly WelcomeLink[] = [
    {
      icon: 'microphone',
      label: 'Записать беседу',
      onClick: () => void startConversation(),
      primary: true,
    },
    { icon: 'users', label: 'Пациенты', href: '#/notes/patients' },
    { icon: 'calculator', label: 'Калькуляторы', href: '#/calculators' },
    { icon: 'list-checks', label: 'Опросники', href: '#/assessments' },
    {
      icon: 'book-open',
      label: 'Словарь',
      onClick: () => props.onOpenReference(),
      experimental: true,
      requiresCore: true,
    },
  ];
  const visibleLinks = () =>
    links.filter((link) => !link.experimental || experimentalModulesEnabled());
  return (
    <div class="search-welcome__content">
      <div class="search-welcome__intro">
        <h1 class="search-welcome__title">{greeting(new Date().getHours())}</h1>
        <p class="search-welcome__text">
          Ищите болезнь, препарат или код МКБ — или опишите случай своими словами. Всё работает без
          интернета.
        </p>
        <nav class="search-welcome__links" aria-label="Быстрый переход">
          <For each={visibleLinks()}>
            {(link) =>
              link.href ? (
                <a class="search-welcome__link" href={link.href}>
                  <AppGlyph name={link.icon} class="search-welcome__link-icon" />
                  {link.label}
                </a>
              ) : (
                <button
                  class="search-welcome__link"
                  classList={{ 'search-welcome__link--primary': link.primary ?? false }}
                  type="button"
                  disabled={
                    link.primary
                      ? conversationSession.recorder() !== null
                      : Boolean(link.requiresCore) && props.coreReady === false
                  }
                  title={
                    link.requiresCore && props.coreReady === false
                      ? 'Откроется, когда база будет готова'
                      : undefined
                  }
                  onClick={link.onClick}
                >
                  <AppGlyph
                    name={link.icon}
                    class={`search-welcome__link-icon${link.primary ? ' search-welcome__link-icon--primary' : ''}`}
                  />
                  {link.label}
                </button>
              )
            }
          </For>
        </nav>
      </div>
      <div class="search-welcome__feature">
        <EcgHomeEntry />
      </div>
    </div>
  );
}
