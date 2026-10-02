import { type JSX, Show } from 'solid-js';
import { clinicalEditionDownloadLabel } from '@/features/modules/clinical-edition-text';
import type {
  ClinicalEditionLink,
  ClinicalEditionNotice,
} from '@/features/modules/clinical-editions';

interface ClinicalEditionNoticeProps {
  readonly notice: ClinicalEditionNotice;
  readonly pending: boolean;
  readonly progress: number | null;
  readonly error: string | null;
  readonly onOpen: (target: ClinicalEditionLink) => void;
}

/** One calm line above a clinical recommendation: which edition this is and a link to the other. */
export function ClinicalEditionNoticeLine(props: ClinicalEditionNoticeProps): JSX.Element {
  return (
    <p
      class="clinical-edition-notice"
      classList={{ 'clinical-edition-notice--replaced': props.notice.kind === 'replaced' }}
      role="note"
    >
      <span class="clinical-edition-notice__lead">{props.notice.lead}</span>{' '}
      <button
        type="button"
        class="clinical-edition-notice__link"
        disabled={props.pending}
        onClick={() => props.onOpen(props.notice.action.target)}
      >
        {props.pending ? clinicalEditionDownloadLabel(props.progress) : props.notice.action.label}
      </button>
      <Show when={props.pending && props.progress !== null}>
        <span
          class="clinical-edition-notice__progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((props.progress ?? 0) * 100)}
        >
          <i
            class="clinical-edition-notice__progress-fill"
            style={{ width: `${Math.round((props.progress ?? 0) * 100)}%` }}
          />
        </span>
      </Show>
      <Show when={props.error}>
        {(message) => (
          <span class="clinical-edition-notice__error" role="alert">
            {message()}
          </span>
        )}
      </Show>
    </p>
  );
}
