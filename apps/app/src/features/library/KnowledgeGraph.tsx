import type { MedicalDocumentSummary } from '@localmed/contracts';
import { createMemo, For, type JSX } from 'solid-js';

import {
  ClinicalGlyph,
  type ClinicalSignal,
  documentClinicalSignals,
} from '../../components/ClinicalGlyph';

interface KnowledgeGraphProps {
  readonly documents: readonly MedicalDocumentSummary[];
  readonly selectedId: string | undefined;
  readonly onSelect: (id: string) => void;
}

interface DomainGroup {
  readonly specialty: string;
  readonly signal: ClinicalSignal;
  readonly documents: readonly MedicalDocumentSummary[];
}

function specialtySignal(
  specialty: string,
  documents: readonly MedicalDocumentSummary[],
): ClinicalSignal {
  const normalized = specialty.toLowerCase();
  if (/(?:пульмон|дыхател|respir)/u.test(normalized)) {
    return { icon: 'lungs', label: specialty, tone: 'blue', strength: 'primary' };
  }
  if (/(?:инфек|infect)/u.test(normalized)) {
    return { icon: 'infection', label: specialty, tone: 'red', strength: 'primary' };
  }
  if (/(?:нефр|уролог|kidney)/u.test(normalized)) {
    return { icon: 'kidney', label: specialty, tone: 'cyan', strength: 'primary' };
  }
  if (/(?:неврол|neuro)/u.test(normalized)) {
    return { icon: 'brain', label: specialty, tone: 'purple', strength: 'primary' };
  }
  if (/(?:гастро|питан|gastro|nutrition)/u.test(normalized)) {
    return { icon: 'stomach', label: specialty, tone: 'amber', strength: 'primary' };
  }
  return (
    documentClinicalSignals(
      documents[0] ??
        ({ title: specialty, shortTitle: null, specialties: [] } as MedicalDocumentSummary),
    )[0] ?? {
      icon: 'overview',
      label: specialty,
      tone: 'neutral',
      strength: 'primary',
    }
  );
}

export function KnowledgeGraph(props: KnowledgeGraphProps): JSX.Element {
  const groups = createMemo<readonly DomainGroup[]>(() => {
    const bySpecialty = new Map<string, MedicalDocumentSummary[]>();
    for (const document of props.documents) {
      const specialties = document.specialties.length ? document.specialties : ['Другие документы'];
      for (const specialty of specialties) {
        const existing = bySpecialty.get(specialty) ?? [];
        existing.push(document);
        bySpecialty.set(specialty, existing);
      }
    }
    return [...bySpecialty.entries()]
      .map(([specialty, documents]) => ({
        specialty,
        signal: specialtySignal(specialty, documents),
        documents: documents.toSorted((left, right) => left.title.localeCompare(right.title, 'ru')),
      }))
      .toSorted((left, right) => left.specialty.localeCompare(right.specialty, 'ru'));
  });

  return (
    <section class="knowledge-graph-card paper-card" aria-labelledby="knowledge-graph-title">
      <header>
        <div>
          <p class="archive-kicker">Карта корпуса</p>
          <h2 id="knowledge-graph-title">Области и документы</h2>
        </div>
        <span>
          {props.documents.length} документов · {groups().length} областей
        </span>
      </header>

      <ul class="knowledge-map" aria-label="Связи медицинских областей и документов">
        <For each={groups()}>
          {(group) => (
            <li class="knowledge-map-group">
              <div class={`knowledge-map-domain tone-${group.signal.tone}`}>
                <span class="clinical-signal primary" title={group.signal.label} aria-hidden="true">
                  <ClinicalGlyph name={group.signal.icon} />
                </span>
                <strong>{group.specialty}</strong>
              </div>
              <div class="knowledge-map-documents">
                <For each={group.documents}>
                  {(document) => (
                    <button
                      class="knowledge-map-document"
                      classList={{ selected: props.selectedId === document.id }}
                      type="button"
                      aria-label={`Открыть документ: ${document.title}`}
                      onClick={() => props.onSelect(document.id)}
                    >
                      <span class="knowledge-map-document-copy">
                        <strong>{document.shortTitle ?? document.title}</strong>
                        <small>{document.sourceType.replaceAll('_', ' ')}</small>
                      </span>
                      <span class="clinical-signals" aria-hidden="true">
                        <For each={documentClinicalSignals(document).slice(0, 3)}>
                          {(signal) => (
                            <span
                              class={`clinical-signal ${signal.strength} tone-${signal.tone}`}
                              title={signal.label}
                            >
                              <ClinicalGlyph name={signal.icon} />
                            </span>
                          )}
                        </For>
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </li>
          )}
        </For>
      </ul>

      <p class="knowledge-graph-caption">
        Нажатие открывает документ сразу. Повторяющиеся документы показываются в каждой связанной
        области.
      </p>
    </section>
  );
}
