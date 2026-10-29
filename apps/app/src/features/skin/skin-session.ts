/**
 * One sitting with «Кожа по фото»: a photo, what the doctor said about it, the model's ranking and
 * the gallery entry that keeps them. Plain TypeScript with a subscription, so the page binds it to
 * signals and the unit tests drive it without a browser.
 *
 * - A new photo clears the ranking; «Анализ» runs the model (and keeps the photo in the gallery).
 * - Changing details or the patient after a result re-ranks in place, debounced, on the same entry.
 * - Retaking during a run drops that run's answer; nothing blocks input.
 * - With the model missing nothing is ranked: the photo is still kept and the page says so.
 */
import { createDebouncer } from '@/components/debounced-value';
import type { SkinFindings } from '@/features/skin/skin-atlas';
import { type StoredSkinImages, storedSkinImages } from '@/features/skin/skin-crop';
import { mergeSkinDetails, skinDetailsKey } from '@/features/skin/skin-details';
import { type SkinHistoryStore, skinHistoryResults } from '@/features/skin/skin-history';
import type {
  SkinAnalysis,
  SkinDetails,
  SkinModel,
  SkinModelStatus,
} from '@/features/skin/skin-model';

export type SkinPhase = 'idle' | 'captured' | 'scanning' | 'result';

export interface SkinSessionState {
  readonly phase: SkinPhase;
  readonly photo: Blob | undefined;
  readonly modelStatus: SkinModelStatus | 'checking';
  readonly analysis: SkinAnalysis | undefined;
  /** The model is installed but the last run failed. */
  readonly failed: boolean;
  /** A re-ranking after a change of details is under way; the old ranking stays on screen. */
  readonly reranking: boolean;
  readonly chips: SkinDetails;
  /** The doctor's description; it never re-runs the model, it feeds the atlas and the danger. */
  readonly findings: SkinFindings;
  readonly patientId: string;
  readonly entryId: string | undefined;
}

export interface SkinSessionDeps {
  readonly model: SkinModel;
  readonly history: SkinHistoryStore;
  readonly storedImages?: (photo: Blob) => Promise<StoredSkinImages>;
  readonly now?: () => number;
  readonly newId?: () => string;
  /** The least time the scan animation shows, so a fast model does not flash it. */
  readonly minScanMs?: number;
  readonly rerankDebounceMs?: number;
  readonly onError?: (cause: unknown) => void;
}

export interface SkinSession {
  state(): SkinSessionState;
  subscribe(listener: (state: SkinSessionState) => void): () => void;
  /** Reads the model's status; call once when the page opens. */
  init(): Promise<void>;
  setPhoto(photo: Blob): void;
  retake(): void;
  analyze(): Promise<void>;
  setChips(chips: SkinDetails): void;
  setFindings(findings: SkinFindings): void;
  setPatient(patientId: string, patientDetails: Pick<SkinDetails, 'age' | 'sex'>): void;
  dispose(): void;
}

const INITIAL: SkinSessionState = {
  phase: 'idle',
  photo: undefined,
  modelStatus: 'checking',
  analysis: undefined,
  failed: false,
  reranking: false,
  chips: {},
  findings: {},
  patientId: '',
  entryId: undefined,
};

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export function createSkinSession(deps: SkinSessionDeps): SkinSession {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const storedImages = deps.storedImages ?? storedSkinImages;
  const minScanMs = deps.minScanMs ?? 1100;
  const reportError = deps.onError ?? (() => undefined);
  const listeners = new Set<(state: SkinSessionState) => void>();
  let current = INITIAL;
  let patientDetails: Pick<SkinDetails, 'age' | 'sex'> = {};
  /** Bumped by every new photo, retake and run: an older run's answer is dropped. */
  let generation = 0;
  let rankedKey: string | undefined;

  const set = (patch: Partial<SkinSessionState>): void => {
    current = { ...current, ...patch };
    for (const listener of listeners) listener(current);
  };
  const details = (): SkinDetails => mergeSkinDetails(current.chips, patientDetails);

  const persist = async (
    id: string,
    patch: Parameters<SkinHistoryStore['update']>[1],
  ): Promise<void> => {
    try {
      await deps.history.update(id, patch);
    } catch (cause) {
      reportError(cause);
    }
  };

  /** Keeps the photo (once) and returns the entry id; a failed save leaves the run without one. */
  const ensureEntry = async (
    photo: Blob,
    analysis: SkinAnalysis | undefined,
    run: number,
  ): Promise<string | undefined> => {
    const existing = current.entryId;
    if (existing) {
      await persist(existing, {
        details: details(),
        findings: current.findings,
        ...(analysis ? { results: skinHistoryResults(analysis) } : {}),
        patientId: current.patientId || null,
      });
      return existing;
    }
    try {
      const images = await storedImages(photo);
      if (run !== generation) return undefined;
      const id = newId();
      await deps.history.put({
        id,
        createdAt: now(),
        photo: images.photo,
        thumbnail: images.thumbnail,
        details: details(),
        findings: current.findings,
        ...(analysis ? { results: skinHistoryResults(analysis) } : {}),
        note: '',
        ...(current.patientId ? { patientId: current.patientId } : {}),
      });
      return id;
    } catch (cause) {
      reportError(cause);
      return undefined;
    }
  };

  const runModel = async (photo: Blob, run: number): Promise<SkinAnalysis | 'failed'> => {
    try {
      return await deps.model.analyze(photo, details());
    } catch (cause) {
      if (run === generation) reportError(cause);
      return 'failed';
    }
  };

  const rerank = async (): Promise<void> => {
    const photo = current.photo;
    if (!photo || current.phase !== 'result' || current.modelStatus !== 'ready') return;
    const key = skinDetailsKey(details());
    if (key === rankedKey) return;
    const run = ++generation;
    set({ reranking: true });
    const answer = await runModel(photo, run);
    if (run !== generation) return;
    if (answer === 'failed') {
      set({ reranking: false, failed: true });
      return;
    }
    rankedKey = key;
    set({ reranking: false, failed: false, analysis: answer });
    if (current.entryId)
      await persist(current.entryId, {
        details: details(),
        results: skinHistoryResults(answer),
        patientId: current.patientId || null,
      });
  };

  const rerankSoon = createDebouncer(() => {
    void rerank();
  }, deps.rerankDebounceMs ?? 350);

  // The description is typed (the evolution text): saved debounced, on the same entry.
  let findingsDirty = false;
  const saveFindings = (): void => {
    findingsDirty = false;
    if (current.entryId) void persist(current.entryId, { findings: current.findings });
  };
  const saveFindingsSoon = createDebouncer(saveFindings, deps.rerankDebounceMs ?? 350);

  /** Details of an entry that has no ranking yet are still kept on it. */
  const saveDetailsOnly = (): void => {
    if (current.entryId) {
      void persist(current.entryId, {
        details: details(),
        patientId: current.patientId || null,
      });
    }
  };

  return {
    state: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    init: async () => {
      let status: SkinModelStatus;
      try {
        status = await deps.model.status();
      } catch (cause) {
        reportError(cause);
        status = 'missing';
      }
      set({ modelStatus: status });
    },
    setPhoto: (photo) => {
      generation += 1;
      rankedKey = undefined;
      rerankSoon.cancel();
      set({
        phase: 'captured',
        photo,
        analysis: undefined,
        failed: false,
        reranking: false,
        entryId: undefined,
      });
    },
    retake: () => {
      generation += 1;
      rankedKey = undefined;
      rerankSoon.cancel();
      set({
        phase: 'idle',
        photo: undefined,
        analysis: undefined,
        failed: false,
        reranking: false,
        entryId: undefined,
      });
    },
    analyze: async () => {
      const photo = current.photo;
      if (!photo || current.phase === 'scanning') return;
      rerankSoon.cancel();
      const run = ++generation;
      if (current.modelStatus !== 'ready') {
        // Nothing to rank: keep the photo, say so in place.
        set({ phase: 'result', analysis: undefined, failed: false, reranking: false });
        const id = await ensureEntry(photo, undefined, run);
        if (run === generation && id) set({ entryId: id });
        return;
      }
      set({ phase: 'scanning', failed: false, analysis: undefined });
      const key = skinDetailsKey(details());
      const [answer] = await Promise.all([runModel(photo, run), sleep(minScanMs)]);
      if (run !== generation) return;
      if (answer === 'failed') {
        set({ phase: 'result', failed: true, analysis: undefined });
        return;
      }
      rankedKey = key;
      set({ phase: 'result', analysis: answer, failed: false });
      const id = await ensureEntry(photo, answer, run);
      if (run === generation && id) set({ entryId: id });
    },
    setChips: (chips) => {
      set({ chips });
      if (current.phase === 'result' && current.modelStatus === 'ready') rerankSoon.call();
      else saveDetailsOnly();
    },
    setFindings: (findings) => {
      set({ findings });
      findingsDirty = true;
      saveFindingsSoon.call();
    },
    setPatient: (patientId, derived) => {
      patientDetails = derived;
      set({ patientId });
      if (current.phase === 'result' && current.modelStatus === 'ready') rerankSoon.call();
      else saveDetailsOnly();
    },
    dispose: () => {
      generation += 1;
      rerankSoon.cancel();
      saveFindingsSoon.cancel();
      // A description typed just before leaving is still kept.
      if (findingsDirty) saveFindings();
      listeners.clear();
    },
  };
}
