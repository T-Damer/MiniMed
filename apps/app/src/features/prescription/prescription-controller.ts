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

import { createDebouncer } from '@/components/debounced-value';
import { cardDisplayName } from '@/features/drug-interactions/drug-candidates';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
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

export const PRESCRIPTION_AUTOSAVE_DEBOUNCE_MS = 700;

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
  let pending:
    | { readonly patientId: string | undefined; readonly draft: PrescriptionDraft }
    | undefined;

  const autosave = createDebouncer(() => void flush(), PRESCRIPTION_AUTOSAVE_DEBOUNCE_MS);
  async function flush(): Promise<void> {
    autosave.cancel();
    const job = pending;
    pending = undefined;
    if (!job) return;
    try {
      await storePrescriptionDraft(job.patientId, job.draft);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить черновик.');
    }
  }
  onCleanup(() => void flush());

  const commit = (next: PrescriptionDraft): void => {
    editedSinceLoad = true;
    const stamped = { ...next, updatedAt: new Date().toISOString() };
    setDraft(stamped);
    if (options.persist === false) return;
    pending = { patientId: options.patientId(), draft: stamped };
    autosave.call();
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
  createEffect(on(() => [options.patientId(), isPatientVaultUnlocked()] as const, hydrate));

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
    if (patient.ageDays !== undefined) parts.push(ageLabel(patient.ageDays));
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
      pending = { patientId, draft: approved };
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

function ageLabel(ageDays: number): string {
  const years = Math.floor(ageDays / 365.25);
  if (years >= 2) return `${years} ${yearsWord(years)}`;
  const months = Math.floor(ageDays / 30.44);
  if (months >= 1) return `${months} мес.`;
  return `${ageDays} дн.`;
}

function yearsWord(years: number): string {
  const tail = years % 100;
  if (tail >= 11 && tail <= 14) return 'лет';
  const last = years % 10;
  return last === 1 ? 'год' : last >= 2 && last <= 4 ? 'года' : 'лет';
}
