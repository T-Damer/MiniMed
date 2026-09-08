import { For, type JSX } from 'solid-js';
import { ClinicalGlyph, documentClinicalSignals } from '@/components/ClinicalGlyph';

export function ClinicalTags(props: {
  readonly title: string;
  readonly specialties: readonly string[];
}): JSX.Element {
  return (
    <span class="clinical-tags">
      <For
        each={documentClinicalSignals({
          title: props.title,
          shortTitle: null,
          specialties: props.specialties,
        })}
      >
        {(signal) => (
          <span class={`clinical-tags__tag tone-${signal.tone}`} title={signal.label}>
            <ClinicalGlyph name={signal.icon} class="clinical-tags__icon" />
            <span class="sr-only">{signal.label}</span>
          </span>
        )}
      </For>
    </span>
  );
}
