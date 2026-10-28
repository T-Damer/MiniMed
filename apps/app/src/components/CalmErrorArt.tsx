import { createUniqueId, type JSX } from 'solid-js';

/**
 * The picture of a calm error: a soft circle that slowly swells and settles (a breath), and in front
 * of it a small cloud of wool that floats. Hand drawn as plain shapes — no bitmap, no icon font — and
 * painted only with theme tokens (`CalmError.css`), so it follows light and dark. The wool is the
 * same cloud twice (a shaded layer, a lit layer) seen through one filter that roughens the edge and
 * adds a faint grain. Motion is CSS only: the breath scales, the cloud drifts, both stop with
 * animations off.
 */
export function CalmErrorArt(): JSX.Element {
  const id = createUniqueId();
  const wool = `calm-error-wool-${id}`;
  const halo = `calm-error-halo-${id}`;
  const disc = `calm-error-disc-${id}`;
  const fleece = `calm-error-fleece-${id}`;
  return (
    <svg
      class="calm-error__art"
      viewBox="0 0 240 190"
      aria-hidden="true"
      data-testid="calm-error-art"
    >
      <defs>
        <radialGradient id={halo} cx="50%" cy="50%" r="50%">
          <stop offset="0" class="calm-error__stop calm-error__stop--halo-core" />
          <stop offset="1" class="calm-error__stop calm-error__stop--halo-edge" />
        </radialGradient>
        <radialGradient id={disc} cx="40%" cy="34%" r="72%">
          <stop offset="0" class="calm-error__stop calm-error__stop--disc-lit" />
          <stop offset="1" class="calm-error__stop calm-error__stop--disc-shade" />
        </radialGradient>
        <linearGradient id={fleece} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" class="calm-error__stop calm-error__stop--fleece-top" />
          <stop offset="1" class="calm-error__stop calm-error__stop--fleece-bottom" />
        </linearGradient>
        <filter id={wool} x="-12%" y="-18%" width="124%" height="136%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.045"
            numOctaves="2"
            seed="4"
            result="warp"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="warp"
            scale="5"
            xChannelSelector="R"
            yChannelSelector="G"
            result="fuzzy"
          />
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.85"
            numOctaves="2"
            seed="9"
            result="grain"
          />
          <feColorMatrix
            in="grain"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.3 0 0 0 -0.6"
            result="speckle"
          />
          <feFlood class="calm-error__grain" result="ink" />
          <feComposite in="ink" in2="speckle" operator="in" result="dots" />
          <feComposite in="dots" in2="fuzzy" operator="in" result="woolly" />
          <feMerge>
            <feMergeNode in="fuzzy" />
            <feMergeNode in="woolly" />
          </feMerge>
        </filter>
      </defs>

      <circle class="calm-error__halo" cx="120" cy="74" r="86" fill={`url(#${halo})`} />

      <g class="calm-error__breath">
        <circle class="calm-error__ring" cx="120" cy="74" r="62" />
        <circle class="calm-error__disc" cx="120" cy="74" r="50" fill={`url(#${disc})`} />
      </g>

      <g class="calm-error__puff">
        <g filter={`url(#${wool})`}>
          <circle class="calm-error__fleece-shade" cx="30" cy="60" r="9" />
          <circle class="calm-error__fleece-shade" cx="41" cy="55" r="12" />
          <circle class="calm-error__fleece-shade" cx="54" cy="61" r="9" />
          <rect class="calm-error__fleece-shade" x="22" y="58" width="40" height="11" rx="5.5" />
          <circle class="calm-error__fleece-lit" cx="39" cy="52" r="8" />
        </g>
      </g>

      <g transform="translate(0 14)">
        <g class="calm-error__cloud">
          <g filter={`url(#${wool})`}>
            <g class="calm-error__fleece-shade">
              <circle cx="64" cy="140" r="20" />
              <circle cx="94" cy="122" r="27" />
              <circle cx="132" cy="114" r="31" />
              <circle cx="168" cy="128" r="26" />
              <circle cx="190" cy="144" r="18" />
              <rect x="46" y="138" width="162" height="34" rx="17" />
            </g>
            <g fill={`url(#${fleece})`}>
              <circle cx="64" cy="136" r="20" />
              <circle cx="94" cy="118" r="27" />
              <circle cx="132" cy="110" r="31" />
              <circle cx="168" cy="124" r="26" />
              <circle cx="190" cy="140" r="18" />
              <rect x="46" y="134" width="162" height="34" rx="17" />
            </g>
            <g class="calm-error__fleece-lit">
              <circle cx="88" cy="106" r="14" />
              <circle cx="126" cy="94" r="17" />
              <circle cx="162" cy="110" r="13" />
              <circle cx="60" cy="128" r="9" />
            </g>
          </g>
          <path
            class="calm-error__curl"
            d="M84 124c6-9 17-9 22-1M120 112c7-10 20-9 25 0M158 134c5-7 14-7 19-1M58 148c4-6 12-6 16 0"
          />
        </g>
      </g>
    </svg>
  );
}
