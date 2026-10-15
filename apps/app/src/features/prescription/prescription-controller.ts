/**
 * The state of the prescription tool (RX1): the draft, the patient's facts, the instructions read
 * for each item and the analysis the screen renders. Signals only, no markup; the numbers come from
 * the pure modules next to it. The same controller runs the full tool and the «Рецепт» modal of the
 * drug screen.
 */
import type {
  MedicalCore,
  MedicalDocument,
  PrescriptionDraft,
  PrescriptionPatient,
} from '@localmed/contracts';
import { type Accessor, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';

import { cardDisplayName } from '@/features/drug-interactions/drug-candidates';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { createDraftAutosave } from '@/state/draft-write-ahead';
import {
  appendEvent,
  createMedicationEvent,
  type PatientVaultSnapshot,
} from '@/state/patient-domain';
import { isPatientVaultUnlocked, updatePatientVault } from '@/state/patient-vault';
import { createQuietResource } from '@/state/quiet-resource';
import type { DoseCandidate } from './dose-candidates';
import { type ResolvedInstruction, resolveInstruction } from './dose-document';
import type { DoseIndex } from './dose-index';
import { loadDoseIndex } from './dose-load';
import {
  emptyDraft,
  loadPrescriptionDraft,
  prescriptionDraftCopies,
  prunePrescriptionDraftCopies,
  rememberPrescriptionDraft,
  storePrescriptionDraft,
} from './prescription-draft-store';
import {
  factsOfCard,
  type PatientCardFacts,
  type PrescriptionFacts,
  patientFactsOf,
} from './prescription-facts';
import {
  analyzeItem,
  applyQueryChoices,
  documentIdsToRead,
  type InstructionState,
  type ItemAnalysis,
  newItem,
  type PrescriptionItem,
} from './prescription-model';
import { FORM_107_ID, type PrescribedLine, recipeDate, recipeText } from './prescription-output';
import { ageText } from './prescription-safety';

/**
 * A patient's draft reaches the vault once typing has paused for this long. Every change is sealed
 * into a write-ahead copy at once (and a draft without a patient goes to browser storage at once),
 * so a reload inside this window loses nothing.
 */
export const PRESCRIPTION_AUTOSAVE_DEBOUNCE_MS = 700;

/** One change of a patient's draft; the patient is fixed when it is typed. */
interface DraftEdit {
  readonly patientId: string;
  readonly draft: PrescriptionDraft;
}

export type DocumentRead = 'loading' | 'missing' | MedicalDocument;

export interface PrescriptionSeed {
  /** Cards (`esklp.mnn.` slugs) to start with. */
  readonly cards?: readonly string[];
  readonly ageDays?: number;
  readonly group?: 'adult' | 'child';
  readonly weightKg?: number;
  readonly days?: number;
  readonly pregnant?: boolean;
  readonly lactating?: boolean;
  /** A dosage form word of the query («таблетки», «суспензия»): picks the registry form that starts with it. */
  readonly formWord?: string;
  /** A strength of the query in milligrams per unit: picks the registry row with that strength. */
  readonly strengthMg?: number;
}

export interface PrescriptionControllerOptions {
  readonly core: Accessor<MedicalCore | undefined>;
  readonly patientId: Accessor<string | undefined>;
  /** The open patient vault, or undefined while it is closed. */
  readonly snapshot: Accessor<PatientVaultSnapshot | undefined>;
  readonly seed?: PrescriptionSeed | undefined;
  /** `false`: the draft is not read from or written to storage (the search card). */
  readonly persist?: boolean;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `rx-${Date.now().toString(36)}-${counter}`;
}

export interface PrescriptionController {
  readonly index: Accessor<DoseIndex | undefined>;
  readonly indexFailed: Accessor<boolean>;
  readonly draft: Accessor<PrescriptionDraft>;
  readonly ready: Accessor<boolean>;
  readonly facts: Accessor<PrescriptionFacts>;
  readonly card: Accessor<PatientCardFacts>;
  readonly analyses: Accessor<readonly ItemAnalysis[]>;
  readonly documents: Accessor<ReadonlyMap<string, DocumentRead>>;
  readonly lines: Accessor<readonly PrescribedLine[]>;
  readonly recipe: Accessor<string>;
  readonly status: Accessor<'draft' | 'saved'>;
  readonly error: Accessor<string>;
  addCandidate: (candidate: DoseCandidate) => string;
  addSlug: (slug: string) => string | null;
  removeItem: (id: string) => void;
  updateItem: (id: string, patch: Partial<PrescriptionItem>) => void;
  updatePatient: (patch: Partial<PrescriptionPatient>) => void;
  /**
   * Stores what is being typed into a patient fact at once, without re-reading the screen: the
   * fields hand their value to `updatePatient` only after a short pause, and a reload inside it
   * must not lose the figure.
   */
  rememberPatient: (patch: Partial<PrescriptionPatient>) => void;
  setFormId: (formId: string) => void;
  /** Approves the prescription: marks it saved and records it on the patient's card. */
  save: () => Promise<void>;
  /** Writes the draft now. */
  flush: () => Promise<void>;
  reload: () => void;
}

export function createPrescriptionController(
  options: PrescriptionControllerOptions,
): PrescriptionController {
  const index = createQuietResource(loadDoseIndex);
  const [draft, setDraft] = createSignal<PrescriptionDraft>(emptyDraft(FORM_107_ID));
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal('');
  const [documents, setDocuments] = createSignal<ReadonlyMap<string, DocumentRead>>(new Map());
  let requested = new Set<string>();
  let loadRequest = 0;
  let editedSinceLoad = false;
  // A patient's draft: sealed copy at every change, vault write after the typing pauses, a flush
  // on pagehide / hidden / freeze; leaving the screen flushes too.
  const autosave = createDraftAutosave<DraftEdit>({
    store: prescriptionDraftCopies,
    patientId: () => options.patientId() ?? '',
    target: () => undefined,
    serialize: (edit) => JSON.stringify(edit.draft),
    delayMs: PRESCRIPTION_AUTOSAVE_DEBOUNCE_MS,
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить черновик.');
    },
    save: async (edit) => {
      await storePrescriptionDraft(edit.patientId, edit.draft);
      setError('');
      // Closed vault: the draft is in memory only, so the copy (if any) must stay.
      return { complete: isPatientVaultUnlocked() };
    },
  });
  async function flush(): Promise<void> {
    await autosave.flush();
  }
  onCleanup(() => {
    void autosave.flush();
    autosave.dispose();
  });
  // Copies of patients that were deleted are not kept.
  createEffect(() => {
    const snapshot = options.snapshot();
    if (snapshot && options.persist !== false) {
      prunePrescriptionDraftCopies(new Set(snapshot.profiles.map((item) => item.id)));
    }
  });

  /** Remembers a change at once and schedules the vault write of a patient's draft. */
  const persistDraft = (patientId: string | undefined, next: PrescriptionDraft): void => {
    rememberPrescriptionDraft(patientId, next);
    if (patientId) autosave.edit({ patientId, draft: next });
  };

  const commit = (next: PrescriptionDraft): void => {
    editedSinceLoad = true;
    const stamped = { ...next, updatedAt: new Date().toISOString() };
    setDraft(stamped);
    if (options.persist === false) return;
    persistDraft(options.patientId(), stamped);
  };

  const seedItems = (base: PrescriptionDraft): PrescriptionDraft => {
    const seed = options.seed;
    if (!seed) return base;
    const loaded = index.value();
    const items = [...base.items];
    for (const slug of seed.cards ?? []) {
      if (items.some((item) => item.slug === slug)) continue;
      const card = loaded?.cardBySlug.get(slug);
      if (loaded && card === undefined) continue;
      items.push({
        ...newItem(nextId(), slug, cardDisplayName(slug)),
        ...(seed.days === undefined ? {} : { days: seed.days }),
      });
    }
    return {
      ...base,
      items,
      patient: {
        ...base.patient,
        ...(seed.ageDays === undefined ? {} : { ageDays: seed.ageDays }),
        ...(seed.group === undefined ? {} : { group: seed.group }),
        ...(seed.weightKg === undefined ? {} : { weightKg: seed.weightKg }),
        ...(seed.pregnant ? { pregnant: true } : {}),
        ...(seed.lactating ? { lactating: true } : {}),
      },
    };
  };

  const hydrate = (): void => {
    const request = ++loadRequest;
    editedSinceLoad = false;
    setReady(false);
    const patientId = options.patientId();
    void flush();
    if (options.persist === false) {
      setDraft(seedItems(emptyDraft(FORM_107_ID)));
      setReady(true);
      return;
    }
    loadPrescriptionDraft(patientId)
      .then((stored) => {
        if (request !== loadRequest || editedSinceLoad) return;
        setDraft(seedItems(stored ?? emptyDraft(FORM_107_ID)));
        setError('');
      })
      .catch((cause: unknown) => {
        if (request !== loadRequest) return;
        setDraft(seedItems(emptyDraft(FORM_107_ID)));
        setError(cause instanceof Error ? cause.message : 'Не удалось открыть черновик.');
      })
      .finally(() => {
        if (request === loadRequest) setReady(true);
      });
  };
  // A patient's draft is read once the vault is open: after a reload the vault opens a moment
  // later than the screen, and locking it blanks the draft again.
  createEffect(
    on(
      () =>
        [
          options.patientId(),
          options.patientId() ? options.snapshot() !== undefined : false,
        ] as const,
      hydrate,
    ),
  );

  // Seeds that name cards wait for the index (an unknown card is dropped, not guessed).
  createEffect(
    on(index.value, (loaded) => {
      if (!loaded || !ready() || !options.seed?.cards?.length) return;
      const seeded = seedItems(draft());
      if (seeded.items.length !== draft().items.length) setDraft(chooseFromQuery(seeded, loaded));
      else if (options.seed.formWord || options.seed.strengthMg) {
        setDraft(chooseFromQuery(draft(), loaded));
      }
    }),
  );
  const chooseFromQuery = (base: PrescriptionDraft, loaded: DoseIndex): PrescriptionDraft => {
    const seed = options.seed;
    if (!seed) return base;
    return { ...base, items: base.items.map((item) => applyQueryChoices(item, loaded, seed)) };
  };

  const card = createMemo(() => {
    const snapshot = options.snapshot();
    const patientId = options.patientId();
    const profile = patientId
      ? snapshot?.profiles.find((item) => item.id === patientId)
      : undefined;
    return factsOfCard(profile, snapshot, new Date());
  });
  const facts = createMemo(() => patientFactsOf(draft().patient, card()));

  // The instruction each item reads: asked from the core once, re-read after an install.
  const [epoch, setEpoch] = createSignal(0);
  const forgetDocuments = (): void => {
    requested = new Set();
    setDocuments(new Map());
    setEpoch((value) => value + 1);
  };
  createEffect(on(options.core, forgetDocuments, { defer: true }));
  createEffect(() => {
    epoch();
    const loaded = index.value();
    const core = options.core();
    if (!loaded || !core) return;
    for (const item of draft().items) {
      for (const documentId of documentIdsToRead(item, loaded)) {
        if (requested.has(documentId)) continue;
        requested.add(documentId);
        const generation = requested;
        setDocuments((current) => new Map(current).set(documentId, 'loading'));
        void core.getDocument(documentId).then((result) => {
          if (generation !== requested) return;
          setDocuments((current) =>
            new Map(current).set(documentId, result.ok ? result.value : 'missing'),
          );
        });
      }
    }
  });
  const onContentChanged = (): void => forgetDocuments();
  window.addEventListener(CONTENT_CHANGED_EVENT, onContentChanged);
  onCleanup(() => window.removeEventListener(CONTENT_CHANGED_EVENT, onContentChanged));

  const resolved = createMemo(() => {
    const loaded = index.value();
    const map = new Map<string, ResolvedInstruction>();
    if (!loaded) return map;
    for (const [id, read] of documents()) {
      if (read === 'loading' || read === 'missing') continue;
      map.set(id, resolveInstruction(read, loaded.asset.documents[id]));
    }
    return map;
  });

  const analyses = createMemo<readonly ItemAnalysis[]>(() => {
    const loaded = index.value();
    if (!loaded) return [];
    const patient = facts();
    const read = documents();
    const instructions = resolved();
    const instructionOf = (id: string): InstructionState | undefined => {
      const state = read.get(id);
      if (state === undefined || state === 'loading' || state === 'missing') return state;
      return instructions.get(id);
    };
    return draft().items.map((item) =>
      analyzeItem(item, { index: loaded, patient, instructionOf }),
    );
  });

  const lines = createMemo<readonly PrescribedLine[]>(() =>
    analyses().flatMap((analysis, position) => {
      const item = draft().items[position];
      if (!item || analysis.state !== 'ready' || analysis.rp === '') return [];
      return [
        {
          id: item.id,
          rp: analysis.rp,
          signa: analysis.signa,
          atcCodes: analysis.card?.a ?? [],
        },
      ];
    }),
  );
  const recipe = createMemo(() => {
    const patient = facts();
    const parts: string[] = [];
    if (patient.ageDays !== undefined) parts.push(ageText(patient.ageDays));
    if (patient.weightKg !== undefined)
      parts.push(`${String(patient.weightKg).replace('.', ',')} кг`);
    return recipeText(
      { date: recipeDate(new Date()), patient: parts.length > 0 ? parts.join(', ') : null },
      lines(),
    );
  });

  const addCandidate = (candidate: DoseCandidate): string => {
    const id = nextId();
    commit({
      ...draft(),
      status: 'draft',
      items: [...draft().items, newItem(id, candidate.slug, candidate.label)],
    });
    return id;
  };
  const addSlug = (slug: string): string | null => {
    const loaded = index.value();
    if (loaded && !loaded.cardBySlug.has(slug)) return null;
    const id = nextId();
    commit({
      ...draft(),
      status: 'draft',
      items: [...draft().items, newItem(id, slug, cardDisplayName(slug))],
    });
    return id;
  };

  return {
    index: index.value,
    indexFailed: () => index.error() !== undefined,
    draft,
    ready,
    facts,
    card,
    analyses,
    documents,
    lines,
    recipe,
    status: () => draft().status,
    error,
    addCandidate,
    addSlug,
    removeItem: (id) =>
      commit({
        ...draft(),
        status: 'draft',
        items: draft().items.filter((item) => item.id !== id),
      }),
    updateItem: (id, patch) =>
      commit({
        ...draft(),
        status: 'draft',
        items: draft().items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      }),
    updatePatient: (patch) =>
      commit({ ...draft(), status: 'draft', patient: { ...draft().patient, ...patch } }),
    rememberPatient: (patch) => {
      if (options.persist === false || !ready()) return;
      persistDraft(options.patientId(), {
        ...draft(),
        status: 'draft',
        patient: { ...draft().patient, ...patch },
        updatedAt: new Date().toISOString(),
      });
    },
    setFormId: (formId) => commit({ ...draft(), status: 'draft', formId }),
    save: async () => {
      const patientId = options.patientId();
      const approvedAt = new Date().toISOString();
      const approved: PrescriptionDraft = {
        ...draft(),
        status: 'saved',
        savedAt: approvedAt,
        updatedAt: approvedAt,
      };
      setDraft(approved);
      persistDraft(patientId, approved);
      await flush();
      if (!patientId || !isPatientVaultUnlocked()) return;
      const events = lines().map((line, position) =>
        createMedicationEvent({
          patientId,
          occurredAt: approvedAt,
          medicationKind: 'start',
          title: analysesLabel(analyses()[position], draft().items[position]),
          text: line.signa.trim() === '' ? line.rp : `${line.rp}\n${line.signa}`,
        }),
      );
      try {
        await updatePatientVault((snapshot) =>
          events.reduce((current, event) => appendEvent(current, event), snapshot),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Не удалось записать назначение.');
      }
    },
    flush,
    reload: hydrate,
  };
}

function analysesLabel(
  analysis: ItemAnalysis | undefined,
  item: PrescriptionItem | undefined,
): string {
  const name = item?.label ?? 'Препарат';
  const parts = [name];
  if (analysis?.form) parts.push(analysis.form);
  if (analysis?.strength) parts.push(analysis.strength);
  return parts.join(', ');
}
