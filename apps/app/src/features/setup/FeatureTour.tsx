import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { conversationSession } from '@/features/conversations/conversation-session';
import {
  createUserLibraryDocuments,
  findExampleStudy,
  openImagingStudy,
} from '@/features/library/imaging-entry';
import { userLibraryFolderHash } from '@/features/library/user-library-routing';
import {
  USER_LIBRARY_EXAMPLE_MRI_FILE_NAME,
  USER_LIBRARY_RESEARCH_FOLDER_ID,
  type UserLibraryDocument,
} from '@/state/user-library';
import {
  CanvasDemo,
  DictaphoneDemo,
  ImagingDemo,
  PatientDemo,
  SearchDemo,
  ToolsDemo,
  type TourDemoProps,
} from './FeatureTourDemos';
import './feature-tour.css';

/** A way from a slide to the real page: a route, or a callback for something that is not a page. */
export interface TourAction {
  readonly id: string;
  readonly label: string;
  readonly icon: AppGlyphName;
  readonly href?: string;
  readonly run?: () => void;
}

interface TourContext {
  /** The MRI example, when «Мои файлы» already holds it. */
  readonly mriExample: UserLibraryDocument | undefined;
}

interface TourSlide {
  readonly id: string;
  readonly icon: AppGlyphName;
  readonly title: string;
  readonly text: string;
  readonly badge?: string;
  readonly demo: (props: TourDemoProps) => JSX.Element;
  /** Where the slide leads; the first action is the primary one. */
  readonly actions: (context: TourContext) => readonly TourAction[];
}

const SLIDES: readonly TourSlide[] = [
  {
    id: 'search',
    icon: 'search',
    title: 'Поиск без интернета',
    text: 'Клинические рекомендации, справочники и ваши файлы ищутся прямо на устройстве. Результат открывается на нужном месте источника.',
    demo: SearchDemo,
    actions: () => [{ id: 'search', label: 'Открыть поиск', icon: 'search', href: '#/search' }],
  },
  {
    id: 'patients',
    icon: 'users',
    title: 'Пациенты и визиты',
    text: 'Карточка, события визитов и показатели на графике. Дневник давления или сахара пациент ведёт у себя в браузере и возвращает QR-кодом.',
    demo: PatientDemo,
    actions: () => [
      { id: 'patients', label: 'Открыть пациентов', icon: 'users', href: '#/notes/patients' },
    ],
  },
  {
    id: 'dictaphone',
    icon: 'microphone',
    title: 'Диктофон приёма',
    text: 'Запись беседы с согласия пациента и расшифровка по говорящим прямо на телефоне. Аудио и текст сохраняются в визит.',
    badge: 'Android',
    demo: DictaphoneDemo,
    actions: () => [
      {
        id: 'record',
        label: 'Записать беседу',
        icon: 'microphone',
        run: () => conversationSession.prepare(),
      },
    ],
  },
  {
    id: 'canvas',
    icon: 'edit',
    title: 'Заметки и холст',
    text: 'Пишите от руки или стилусом, связывайте заметки с документами и пациентами.',
    demo: CanvasDemo,
    actions: () => [{ id: 'notes', label: 'Открыть заметки', icon: 'notes', href: '#/notes' }],
  },
  {
    id: 'imaging',
    icon: 'image',
    title: 'Снимки КТ и МРТ',
    text: 'DICOM и NIfTI открываются прямо в «Моих файлах»: срезы в трёх плоскостях, 3D, контраст — без интернета. Снимки лежат в папке «Исследования».',
    demo: ImagingDemo,
    actions: ({ mriExample }) => [
      ...(mriExample
        ? [
            {
              id: 'example',
              label: 'Открыть пример МРТ',
              icon: 'image' as const,
              run: () => openImagingStudy(mriExample),
            },
          ]
        : []),
      {
        id: 'research',
        label: 'Исследования',
        icon: 'folder-open',
        href: userLibraryFolderHash(USER_LIBRARY_RESEARCH_FOLDER_ID),
      },
    ],
  },
  {
    id: 'tools',
    icon: 'calculator',
    title: 'Шкалы и калькуляторы',
    text: 'Опросники считают баллы, объясняют интерпретацию по источнику шкалы и выводятся на печать.',
    demo: ToolsDemo,
    actions: () => [
      { id: 'calculators', label: 'Калькуляторы', icon: 'calculator', href: '#/calculators' },
      { id: 'assessments', label: 'Опросники', icon: 'list-checks', href: '#/assessments' },
    ],
  },
];

const AUTO_ADVANCE_MS = 7_000;
const INTERACTION_PAUSE_MS = 20_000;

export function FeatureTour(props: { readonly onNavigate: () => void }): JSX.Element {
  const [active, setActive] = createSignal(0);
  const documents = createUserLibraryDocuments();
  const context = createMemo(
    (): TourContext => ({
      mriExample: findExampleStudy(documents(), 'mri', USER_LIBRARY_EXAMPLE_MRI_FILE_NAME),
    }),
  );
  /** Leaves the tour for the page: the dialog closes first, then the page or action opens. */
  const follow = (action: TourAction): void => {
    props.onNavigate();
    if (action.href) window.location.hash = action.href;
    action.run?.();
  };
  let track: HTMLDivElement | undefined;
  let pausedUntil = 0;
  // A smooth programmatic scroll passes intermediate slides; ignore them until it settles.
  let settling: ReturnType<typeof setTimeout> | undefined;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const endSettling = (): void => {
    clearTimeout(settling);
    settling = undefined;
  };
  const goTo = (index: number): void => {
    if (!track) return;
    const next = (index + SLIDES.length) % SLIDES.length;
    clearTimeout(settling);
    // `scrollend` releases this early; the timeout covers engines without it.
    settling = setTimeout(endSettling, 1_500);
    track.scrollTo({
      left: next * track.clientWidth,
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
    setActive(next);
  };
  const pause = (): void => {
    pausedUntil = Date.now() + INTERACTION_PAUSE_MS;
  };
  const syncFromScroll = (): void => {
    if (!track || track.clientWidth === 0 || settling !== undefined) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    if (index !== active() && index >= 0 && index < SLIDES.length) setActive(index);
  };

  onMount(() => {
    if (reducedMotion) return;
    const timer = setInterval(() => {
      if (document.hidden || Date.now() < pausedUntil) return;
      goTo(active() + 1);
    }, AUTO_ADVANCE_MS);
    onCleanup(() => clearInterval(timer));
  });
  onCleanup(() => clearTimeout(settling));

  return (
    <section class="feature-tour" aria-roledescription="карусель" aria-label="Возможности MiniMed">
      <div
        ref={(element) => {
          track = element;
        }}
        class="feature-tour__track"
        onScroll={syncFromScroll}
        on:scrollend={() => {
          endSettling();
          syncFromScroll();
        }}
        onPointerDown={pause}
        onFocusIn={pause}
        onWheel={pause}
      >
        <For each={SLIDES}>
          {(slide, index) => (
            <article
              class="feature-tour__slide"
              classList={{ 'feature-tour__slide--active': index() === active() }}
              aria-roledescription="слайд"
              aria-label={`${index() + 1} из ${SLIDES.length}: ${slide.title}`}
              inert={index() !== active()}
            >
              <div class="feature-tour__stage">
                <Dynamic component={slide.demo} active={index() === active()} />
              </div>
              <div class="feature-tour__copy">
                <h4 class="feature-tour__title">
                  <span class="feature-tour__icon">
                    <AppGlyph name={slide.icon} class="feature-tour__icon-glyph" />
                  </span>
                  {slide.title}
                  <Show when={slide.badge}>
                    {(badge) => <span class="feature-tour__badge">{badge()}</span>}
                  </Show>
                </h4>
                <p class="feature-tour__text">{slide.text}</p>
                <div class="feature-tour__actions">
                  <For each={slide.actions(context())}>
                    {(action, position) => (
                      <Button
                        class="feature-tour__action"
                        variant={position() === 0 ? 'primary' : 'secondary'}
                        data-tour-action={action.id}
                        icon={<AppGlyph name={action.icon} />}
                        onClick={() => follow(action)}
                      >
                        {action.label}
                      </Button>
                    )}
                  </For>
                </div>
              </div>
            </article>
          )}
        </For>
      </div>
      <div class="feature-tour__nav">
        <Button
          class="feature-tour__arrow"
          variant="icon"
          aria-label="Предыдущая возможность"
          icon={<AppGlyph name="caret-left" />}
          onClick={() => {
            pause();
            goTo(active() - 1);
          }}
        />
        <div class="feature-tour__dots">
          <For each={SLIDES}>
            {(slide, index) => (
              <button
                class="feature-tour__dot"
                classList={{ 'feature-tour__dot--active': index() === active() }}
                type="button"
                aria-label={slide.title}
                aria-current={index() === active() ? 'true' : undefined}
                onClick={() => {
                  pause();
                  goTo(index());
                }}
              />
            )}
          </For>
        </div>
        <Button
          class="feature-tour__arrow"
          variant="icon"
          aria-label="Следующая возможность"
          icon={<AppGlyph name="caret-right" />}
          onClick={() => {
            pause();
            goTo(active() + 1);
          }}
        />
      </div>
    </section>
  );
}
