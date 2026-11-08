import { ERROR_ACTION_LABELS, type ErrorAction, type ErrorState } from '@localmed/contracts';

/** Handlers a screen can really perform; an action without one draws no button. */
export type ErrorActionHandlers = Partial<Readonly<Record<ErrorAction, () => void>>>;

export interface CalmErrorProps {
  readonly title: string;
  readonly detail?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

/** The props `CalmError` takes for a typed error state: title, text, and its action when wired. */
export function calmErrorProps(state: ErrorState, handlers: ErrorActionHandlers): CalmErrorProps {
  const handler = state.action ? handlers[state.action] : undefined;
  return {
    title: state.title,
    ...(state.text ? { detail: state.text } : {}),
    ...(state.action && handler
      ? { actionLabel: ERROR_ACTION_LABELS[state.action], onAction: handler }
      : {}),
  };
}
