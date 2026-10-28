import { ErrorBoundary, type JSX } from 'solid-js';

import { CalmError } from '@/components/CalmError';
import { reloadFromNetwork } from '@/state/chunk-recovery';

/**
 * Failure of a lazily loaded screen, shown where the screen would be. Without it the Suspense
 * spinner stays on forever. Online, the page has usually just been replaced by chunk recovery;
 * «Повторить» is the manual way out (it also drops the cached shell).
 */
function LazyLoadFailed(props: { readonly error: unknown }): JSX.Element {
  console.error('Экран не загрузился.', props.error);
  const offline = !navigator.onLine;
  return (
    <CalmError
      testId="lazy-load-error"
      title="Экран не загрузился"
      detail={
        offline ? 'Нет сети. Повторите, когда подключитесь.' : 'Страница будет перезагружена.'
      }
      onAction={() => {
        void reloadFromNetwork();
      }}
    />
  );
}

export function LazyBoundary(props: { readonly children: JSX.Element }): JSX.Element {
  return (
    <ErrorBoundary fallback={(error) => <LazyLoadFailed error={error} />}>
      {props.children}
    </ErrorBoundary>
  );
}
