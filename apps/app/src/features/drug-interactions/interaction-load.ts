import { loadAtcNames } from '@/features/medications/atc-names';
import { type ClassPhrase, deriveClassPhrases } from './class-phrases';
import {
  createInteractionIndex,
  type InteractionIndex,
  parseInteractionIndex,
} from './interaction-index';

/**
 * Loader of the drug-interaction index. The JSON is its own chunk: it is fetched the first time
 * the interaction tool or the search entry asks for it and never belongs to the start-up bundle.
 * Built by `scripts/build-drug-interactions.ts` from the released instruction modules; a generated
 * file, never edited by hand.
 */
let pending: Promise<InteractionIndex> | undefined;

export function loadInteractionIndex(): Promise<InteractionIndex> {
  pending ??= import('./data/interaction-index.json')
    .then((module) => createInteractionIndex(parseInteractionIndex(module.default as unknown)))
    .catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  return pending;
}

let phrasesPending: Promise<readonly ClassPhrase[]> | undefined;

/** The class phrases (НСИ «АТХ» names), for highlighting a class in a quoted sentence. */
export function loadClassPhrases(): Promise<readonly ClassPhrase[]> {
  phrasesPending ??= loadAtcNames()
    .then((catalog) => deriveClassPhrases(catalog.names).phrases)
    .catch((error: unknown) => {
      phrasesPending = undefined;
      throw error;
    });
  return phrasesPending;
}
