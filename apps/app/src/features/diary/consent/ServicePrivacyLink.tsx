import { createSignal, type JSX, lazy, Show, Suspense } from 'solid-js';

import '@/features/diary/consent/consent.css';

// The sign-in page loads alone (app/mount-diaries.tsx): the sheet and its text come only when the
// link is pressed.
const ServicePrivacyDialog = lazy(() =>
  import('@/features/diary/consent/ServicePrivacyViews').then((module) => ({
    default: module.ServicePrivacyDialog,
  })),
);

/**
 * The link inside the sign-up checkbox's label: opens the policy without ticking the box. The sheet
 * is mounted only while open.
 */
export function ServicePrivacyLink(props: { readonly children: JSX.Element }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <button
        type="button"
        class="service-privacy__link"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {props.children}
      </button>
      <Show when={open()}>
        <Suspense>
          <ServicePrivacyDialog onClose={() => setOpen(false)} />
        </Suspense>
      </Show>
    </>
  );
}
