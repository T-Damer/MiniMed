import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { ConsentFullText } from '@/features/diary/consent/ConsentDocumentText';
import { consentMoment, consentVersionLabel } from '@/features/diary/consent/consent-status';
import {
  type JoiningAcceptance,
  joiningDocuments,
} from '@/features/diary/consent/joining-documents';
import type { DiaryOperator } from '@/features/diary/diary-model';
import '@/features/diary/consent/consent.css';

/**
 * The joining documents as accepted: each with its wording's version and the moment, and its full
 * text when this version of the app ships that wording. For the doctor's patient page and the
 * patient's «Ещё».
 */
export function ConsentRecord(props: {
  readonly consents: readonly JoiningAcceptance[];
  readonly operator: DiaryOperator;
  readonly connected: boolean;
}): JSX.Element {
  const documents = () => joiningDocuments(props.connected);
  return (
    <ul class="consent-record" data-testid="consent-record">
      <For each={documents()}>
        {(document) => {
          const accepted = () => props.consents.find((item) => item.document === document.id);
          return (
            <li class="consent-record__item">
              <h3 class="consent-record__title">
                <AppGlyph
                  name={accepted() ? 'check' : 'minus'}
                  class={
                    accepted()
                      ? 'consent-record__tick'
                      : 'consent-record__tick consent-record__tick--missing'
                  }
                />
                {document.title}
              </h3>
              <p class="consent-record__when">
                <Show when={accepted()} fallback="Не принят">
                  {(item) =>
                    `Принят ${consentMoment(item().at)} · ${consentVersionLabel(item().version)}`
                  }
                </Show>
              </p>
              <Show when={accepted()?.version === document.version}>
                <ConsentFullText document={document} operator={props.operator} />
              </Show>
            </li>
          );
        }}
      </For>
    </ul>
  );
}
