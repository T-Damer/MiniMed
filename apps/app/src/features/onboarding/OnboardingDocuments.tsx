import type { JSX } from 'solid-js';

/**
 * The documents of the app icon as vector sheets, for the core-loading scene: they leave the
 * wallet (the icon, drawn in front of them), the wallet fades, and three sheets float, the middle
 * one higher than the other two. The sheets only ever move by transform and opacity; the motion
 * itself lives in onboarding.css, where reduced motion turns it into the finished picture.
 */
export function OnboardingDocuments(props: { readonly out: boolean }): JSX.Element {
  return (
    <div class="onboarding-docs" aria-hidden="true">
      <span
        class="onboarding-docs__sheet onboarding-docs__sheet--left"
        classList={{ 'onboarding-docs__sheet--out': props.out }}
      >
        {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative sheet inside an aria-hidden group */}
        <svg class="onboarding-docs__art" viewBox="0 0 84 60">
          <rect width="84" height="60" rx="6" fill="#f7f0dd" stroke="#d6c9a6" />
          <g fill="none" stroke="#2f5d46" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12v38" stroke-width="2.4" />
            <path d="M21 17c-5-5-12-5-16-2 4 0 9 1 12 4M21 17c5-5 12-5 16-2-4 0-9 1-12 4" />
            <path d="M21 24c-6 3 6 6 0 9s6 6 0 9" stroke-width="2" />
          </g>
          <g stroke="#8c8672" stroke-width="2.4" stroke-linecap="round">
            <path d="M44 20h30M44 30h30M44 40h20" />
          </g>
        </svg>
      </span>
      <span
        class="onboarding-docs__sheet onboarding-docs__sheet--center"
        classList={{ 'onboarding-docs__sheet--out': props.out }}
      >
        {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative sheet inside an aria-hidden group */}
        <svg class="onboarding-docs__art" viewBox="0 0 84 60">
          <rect width="84" height="60" rx="6" fill="#f7f0dd" stroke="#d6c9a6" />
          <g stroke="#d9cdb0" stroke-width="0.8">
            <path d="M6 18h72M6 30h72M6 42h72M18 8v44M36 8v44M54 8v44M72 8v44" />
          </g>
          <path
            d="M6 32h17l4-11 6 23 6-28 5 16h34"
            fill="none"
            stroke="#2f5d46"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      <span
        class="onboarding-docs__sheet onboarding-docs__sheet--right"
        classList={{ 'onboarding-docs__sheet--out': props.out }}
      >
        {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative sheet inside an aria-hidden group */}
        <svg class="onboarding-docs__art" viewBox="0 0 84 60">
          <path
            d="M2 8a6 6 0 0 1 6-6h22l6 8h40a6 6 0 0 1 6 6v36a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6z"
            fill="#d9b673"
            stroke="#b8924c"
          />
          <g stroke="#f7f0dd" stroke-width="2.4" stroke-linecap="round" opacity="0.85">
            <path d="M14 26h40M14 36h56M14 46h34" />
          </g>
        </svg>
      </span>
    </div>
  );
}
