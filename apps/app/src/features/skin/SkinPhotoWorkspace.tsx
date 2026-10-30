import type { MedicalCore } from '@localmed/contracts';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { PAGE_HEROES } from '@/app/page-heroes';
import { AppGlyph } from '@/components/AppGlyph';
import { createFlipAnimator } from '@/components/flip-layout';
import type { HeaderAction } from '@/components/HeaderActions';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { PatientPickerRow } from '@/components/PatientPickerRow';
import { Heading } from '@/components/Text';
import type { ConditionCatalogEntry } from '@/features/conditions/condition-catalog';
import { usePatientVaultSnapshot } from '@/features/forms/use-patient-vault-snapshot';
import {
  SkinAtlasSheet,
  SkinDangerBanner,
  SkinDescribedCards,
  SkinFindingsInput,
} from '@/features/skin/SkinAtlas';
import { SkinDetailsChips } from '@/features/skin/SkinDetailsChips';
import { SkinHistorySheet } from '@/features/skin/SkinHistorySheet';
import { SkinPackOffer } from '@/features/skin/SkinPackOffer';
import { SkinResultCards, SkinStatusLines } from '@/features/skin/SkinResults';
import { SkinTv } from '@/features/skin/SkinTv';
import {
  activeTriggers,
  atlasCondition,
  conditionDanger,
  describedConditions,
  skinDangerSummary,
} from '@/features/skin/skin-atlas';
import { mergeSkinDetails, patientSkinDetails } from '@/features/skin/skin-details';
import {
  buildSkinCatalog,
  type SkinDocumentLink,
  skinClassDocumentLinks,
} from '@/features/skin/skin-document-links';
import { skinHistory } from '@/features/skin/skin-history';
import { SKIN_CLASSES } from '@/features/skin/skin-model';
import { skinModel } from '@/features/skin/skin-model-client';
import { resolveSkinModel } from '@/features/skin/skin-model-test-hook';
import { subscribeSkinPack } from '@/features/skin/skin-pack';
import {
  SKIN_SCAN_STATUS_LINES,
  skinClassById,
  skinResultViews,
  skinStatusLines,
  visiblePredictions,
} from '@/features/skin/skin-results';
import { createSkinSession, type SkinSessionState } from '@/features/skin/skin-session';
import { useSkinPack } from '@/features/skin/use-skin-pack';
import { pluralRu } from '@/i18n/labels';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { openDocumentOverlay } from '@/state/document-navigation';
import { FEEDBACK_MOMENTS, playFeedback } from '@/state/ui-feedback';

import '@/styles/skin-photo.css';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function SkinHelp(): JSX.Element {
  const count = SKIN_CLASSES.length;
  return (
    <>
      <p class="skin-help__text">
        Модель обучена на открытых фотографиях кожи: телефонные снимки SCIN (Google) и PAD-UFES-20,
        атласы DermNet и Atlas Dermatológico, ISIC 2024 и несколько небольших наборов.
      </p>
      <p class="skin-help__text">
        Она знает {count} {pluralRu(count, 'состояние', 'состояния', 'состояний')}:
      </p>
      <ul class="skin-help__classes">
        <For each={SKIN_CLASSES}>{(entry) => <li class="skin-help__class">{entry.ru}</li>}</For>
      </ul>
      <p class="skin-help__text">
        Результат — порядок визуального сходства снимка с этими состояниями, диагноз модель не
        выставляет. Состояние вне списка будет сопоставлено ближайшему из известных.
      </p>
      <p class="skin-help__text">
        Снимок обрезается до квадрата по центру кадра. Возраст, пол, место, срок и симптомы меняют
        порядок. Фото и история остаются на устройстве.
      </p>
    </>
  );
}

/**
 * «Кожа по фото»: a retro TV for the camera, the model's ranking of visually similar conditions
 * under it, the doctor's details as chips, and a gallery of earlier shots on the device. The model
 * and the gallery are behind `skinModel` and `skinHistory`; the sitting itself is `createSkinSession`.
 */
export function SkinPhotoWorkspace(props: {
  readonly core: MedicalCore | undefined;
  readonly onBack: () => void;
}): JSX.Element {
  const session = createSkinSession({
    model: resolveSkinModel(skinModel),
    history: skinHistory(),
    onError: (cause) => {
      console.error('skin photo', cause instanceof Error ? cause.name : 'error');
    },
  });
  const [state, setState] = createSignal<SkinSessionState>(session.state());
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [atlasOpen, setAtlasOpen] = createSignal(false);
  const [atlasId, setAtlasId] = createSignal<string>();
  const openAtlas = (conditionId: string | undefined): void => {
    setAtlasId(conditionId);
    setAtlasOpen(true);
  };
  const vault = usePatientVaultSnapshot();
  const [patientId, setPatientId] = createSignal('');

  // A re-ranking moves the cards (FLIP) instead of swapping them.
  let flip: ((mutate: () => void) => void) | undefined;
  const listRef = (element: HTMLOListElement): void => {
    flip = createFlipAnimator(element, { selector: '.skin-result', durationMs: 240 });
  };
  const unsubscribe = session.subscribe((next) => {
    const previous = state();
    const apply = (): void => {
      setState(next);
    };
    if (flip && previous.analysis && next.analysis) flip(apply);
    else apply();
    if (previous.phase === 'scanning' && next.phase === 'result') {
      const moment = next.failed ? FEEDBACK_MOMENTS.failed : FEEDBACK_MOMENTS.received;
      playFeedback(moment[0], moment[1]);
    }
  });
  const pack = useSkinPack();
  // A pack installed or removed changes whether the model exists. A photo that was kept without a
  // ranking while the model was missing is ranked as soon as it arrives.
  const refreshModel = async (): Promise<void> => {
    await session.init();
    const current = session.state();
    if (current.modelStatus === 'ready' && current.phase === 'result' && !current.analysis) {
      void session.analyze();
    }
  };
  onMount(() => {
    void session.init();
    onCleanup(subscribeSkinPack(() => void refreshModel()));
  });
  onCleanup(() => {
    unsubscribe();
    session.dispose();
  });

  // The chosen patient fills the age bucket and the sex when the card knows them.
  const selectedPatient = createMemo(() =>
    vault.snapshot()?.profiles.find((profile) => profile.id === patientId()),
  );
  createEffect(
    on([patientId, selectedPatient], ([id, profile]) => {
      session.setPatient(id, patientSkinDetails(profile, todayIso()));
    }),
  );

  // The frozen photo as a URL; the previous one is released with it.
  const photoUrl = createMemo((): string | undefined => {
    const photo = state().photo;
    if (!photo) return undefined;
    const url = URL.createObjectURL(photo);
    onCleanup(() => URL.revokeObjectURL(url));
    return url;
  });

  // The documents of a condition come from the app's own condition catalog, loaded once there is
  // something to link: a ranking on screen, or the gallery open.
  const wantsLinks = (): boolean => state().analysis !== undefined || historyOpen() || atlasOpen();
  // Plain signals, not a resource: this page sits inside a Suspense boundary, and a pending
  // resource would swap the whole page for its skeleton.
  const [catalog, setCatalog] = createSignal<readonly ConditionCatalogEntry[]>();
  let catalogFor: MedicalCore | undefined;
  let catalogRun = 0;
  const loadCatalog = (core: MedicalCore): void => {
    const run = ++catalogRun;
    catalogFor = core;
    void (core.listNavigationDocuments?.() ?? core.listDocuments())
      .then((result) => {
        if (run === catalogRun && result.ok) setCatalog(buildSkinCatalog(result.value));
      })
      .catch(() => {
        // The documents stay unlinked; the search link under each condition still works.
        if (run === catalogRun) catalogFor = undefined;
      });
  };
  createEffect(() => {
    const core = props.core;
    if (core && wantsLinks() && catalogFor !== core) loadCatalog(core);
  });
  onMount(() => {
    const reload = (): void => {
      if (props.core && catalogFor) loadCatalog(props.core);
    };
    window.addEventListener(CONTENT_CHANGED_EVENT, reload);
    onCleanup(() => window.removeEventListener(CONTENT_CHANGED_EVENT, reload));
  });
  // Model classes and description-only conditions alike link through their МКБ-10 codes.
  const linksFor = (conditionId: string): readonly SkinDocumentLink[] => {
    const entries = catalog();
    const codes = atlasCondition(conditionId)?.icd10 ?? skinClassById(conditionId)?.icd10 ?? [];
    return entries ? skinClassDocumentLinks(entries, codes) : [];
  };

  const views = createMemo(() => skinResultViews(state().analysis?.predictions ?? []));
  // The atlas side: the doctor's description, the conditions only it reaches, and the danger.
  const details = createMemo(() =>
    mergeSkinDetails(state().chips, patientSkinDetails(selectedPatient(), todayIso())),
  );
  const triggers = createMemo(() => activeTriggers(details(), state().findings));
  const described = createMemo(() =>
    describedConditions(
      details(),
      state().findings,
      new Set(
        visiblePredictions(state().analysis?.predictions ?? []).map((entry) => entry.classId),
      ),
    ),
  );
  const danger = createMemo(() =>
    skinDangerSummary({
      predictions: visiblePredictions(state().analysis?.predictions ?? []),
      described: described(),
      malignantFlag: state().analysis?.malignantFlag ?? false,
      details: details(),
      findings: state().findings,
    }),
  );
  const dangerFor = (conditionId: string) => {
    const condition = atlasCondition(conditionId);
    return condition ? conditionDanger(condition, triggers()) : undefined;
  };
  const lines = createMemo(() => {
    const analysis = state().analysis;
    return analysis ? skinStatusLines(analysis) : [];
  });
  const headerActions = createMemo((): readonly HeaderAction[] => [
    {
      id: 'atlas',
      label: 'Атлас кожи',
      icon: 'book-open',
      priority: 2,
      onSelect: () => openAtlas(undefined),
      testId: 'skin-atlas-open',
      menuOnly: true,
    },
    {
      id: 'history',
      label: 'История снимков',
      icon: 'history',
      priority: 2,
      onSelect: () => setHistoryOpen(true),
      testId: 'skin-history-open',
      menuOnly: true,
    },
  ]);

  return (
    <section class="skin-photo" aria-label="Кожа по фото">
      <Page
        hero={PAGE_HEROES.skinPhoto}
        navigation={
          <NavBack
            class="skin-photo__back knowledge-back-button"
            aria-label="Назад"
            onClick={props.onBack}
          />
        }
        title={<Heading depth={1}>Кожа по фото</Heading>}
        description="Сходство снимка с состояниями кожи"
        headerActions={headerActions()}
        help={<SkinHelp />}
      />

      <SkinTv
        phase={state().phase}
        photoUrl={photoUrl()}
        compact={state().phase === 'result'}
        scanLines={SKIN_SCAN_STATUS_LINES()}
        onPhoto={(photo) => {
          session.setPhoto(photo);
          playFeedback('success', 'light');
        }}
        onRetake={() => session.retake()}
        onAnalyze={() => void session.analyze()}
      />

      <Show when={state().modelStatus === 'missing' && state().phase !== 'result'}>
        <SkinPackOffer pack={pack} />
      </Show>

      <Show when={state().phase === 'result'}>
        <div class="skin-photo__results" data-testid="skin-outcome">
          <Switch>
            <Match when={state().analysis}>
              <Show when={danger()}>
                {(summary) => <SkinDangerBanner summary={summary()} onOpen={openAtlas} />}
              </Show>
              <SkinStatusLines lines={lines()} />
              <SkinResultCards
                views={views()}
                linksFor={linksFor}
                busy={state().reranking}
                onOpenDocument={(documentId) => openDocumentOverlay(documentId)}
                dangerFor={dangerFor}
                onOpenAtlas={openAtlas}
                listRef={listRef}
              />
              <SkinDescribedCards
                matches={described()}
                details={details()}
                findings={state().findings}
                onOpen={openAtlas}
              />
            </Match>
            <Match when={state().modelStatus !== 'ready'}>
              <p class="skin-note" data-testid="skin-model-missing">
                <AppGlyph name="info" class="skin-note__icon" />
                <span class="skin-note__text">Модель не найдена</span>
                <SkinPackOffer pack={pack} />
              </p>
            </Match>
            <Match when={state().failed}>
              <div class="skin-note" data-testid="skin-failed">
                <AppGlyph name="info" class="skin-note__icon" />
                <span class="skin-note__text">Не удалось разобрать снимок</span>
                <button
                  type="button"
                  class="skin-note__button"
                  onClick={() => void session.analyze()}
                >
                  <AppGlyph name="refresh" class="skin-note__button-icon" />
                  Повторить
                </button>
              </div>
            </Match>
          </Switch>
        </div>
      </Show>

      <PatientPickerRow
        class="skin-photo__patient"
        profiles={vault.snapshot()?.profiles ?? []}
        patientId={patientId()}
        unlocked={vault.unlocked()}
        hint="Подставит возраст и пол"
        onPatientChange={setPatientId}
        onSnapshotChange={vault.adopt}
      />

      <SkinDetailsChips details={state().chips} onChange={(next) => session.setChips(next)} />

      <SkinFindingsInput
        findings={state().findings}
        onChange={(next) => session.setFindings(next)}
      />

      {/* Without a ranking on screen the description still works on its own. */}
      <Show when={!state().analysis && described().length > 0}>
        <div class="skin-photo__described">
          <Show when={danger()}>
            {(summary) => <SkinDangerBanner summary={summary()} onOpen={openAtlas} />}
          </Show>
          <SkinDescribedCards
            matches={described()}
            details={details()}
            findings={state().findings}
            onOpen={openAtlas}
          />
        </div>
      </Show>

      <SkinAtlasSheet
        open={atlasOpen()}
        conditionId={atlasId()}
        details={details()}
        findings={state().findings}
        linksFor={linksFor}
        onOpenDocument={(documentId) => openDocumentOverlay(documentId)}
        onSelect={setAtlasId}
        onClose={() => setAtlasOpen(false)}
      />

      <SkinHistorySheet
        open={historyOpen()}
        store={skinHistory()}
        linksFor={linksFor}
        onOpenDocument={(documentId) => openDocumentOverlay(documentId)}
        onClose={() => setHistoryOpen(false)}
      />
    </section>
  );
}
