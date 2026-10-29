/**
 * The camera of «Кожа по фото»: what the device can do, probed rather than assumed.
 *
 * `getUserMedia` may be missing (an insecure origin, an old WebView), a device may have no camera,
 * the permission may be refused. Every one of those leaves the TV on its static with the upload
 * door open (`SkinTv`). When a stream does start, `MediaStreamTrack.getCapabilities()` tells which
 * controls to show: zoom steps from the real range, torch, a close-focus («macro») switch.
 */

export interface SkinNumericRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export interface SkinCameraControls {
  readonly zoom?: SkinNumericRange;
  readonly torch: boolean;
  readonly focusDistance?: SkinNumericRange;
}

/** Why there is no live picture; the TV treats them alike but may word them differently. */
export type SkinCameraFailure = 'unsupported' | 'denied' | 'absent' | 'busy' | 'unknown';

/** The track capabilities this tool reads; lib.dom does not type the optional ones. */
export interface SkinTrackCapabilities {
  readonly zoom?: { min?: number; max?: number; step?: number };
  readonly torch?: boolean;
  readonly focusDistance?: { min?: number; max?: number; step?: number };
  readonly focusMode?: readonly string[];
}

const ZOOM_PRESETS = [0.5, 1, 2, 3, 5, 10] as const;

function range(
  value: { min?: number; max?: number; step?: number } | undefined,
): SkinNumericRange | undefined {
  if (!value) return undefined;
  const { min, max, step } = value;
  if (
    typeof min !== 'number' ||
    typeof max !== 'number' ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    max <= min
  ) {
    return undefined;
  }
  return { min, max, step: typeof step === 'number' && step > 0 ? step : 0 };
}

/** The controls a device really offers; a capability it does not report is simply not shown. */
export function skinCameraControls(capabilities: SkinTrackCapabilities): SkinCameraControls {
  const zoom = range(capabilities.zoom);
  const focusDistance = capabilities.focusMode?.includes('manual')
    ? range(capabilities.focusDistance)
    : undefined;
  return {
    ...(zoom ? { zoom } : {}),
    torch: capabilities.torch === true,
    ...(focusDistance ? { focusDistance } : {}),
  };
}

function snapToStep(value: number, zoom: SkinNumericRange): number {
  const clamped = Math.min(zoom.max, Math.max(zoom.min, value));
  if (zoom.step <= 0) return clamped;
  const snapped = zoom.min + Math.round((clamped - zoom.min) / zoom.step) * zoom.step;
  return Math.min(zoom.max, Number(snapped.toFixed(4)));
}

/**
 * The zoom chips: 0.5× / 1× / 2× / 3× … inside the range the track reports. A range that offers no
 * preset (1× to 1.4×) gets its two ends; a fixed lens gets no chips at all.
 */
export function zoomChipValues(zoom: SkinNumericRange | undefined): readonly number[] {
  if (!zoom) return [];
  const presets = ZOOM_PRESETS.filter((value) => value >= zoom.min - 1e-6 && value <= zoom.max);
  const snapped = [...new Set(presets.map((value) => snapToStep(value, zoom)))];
  if (snapped.length >= 2) return snapped;
  const ends = [...new Set([snapToStep(zoom.min, zoom), snapToStep(zoom.max, zoom)])];
  return ends.length >= 2 ? ends : [];
}

/** «0.5×», «1×», «2.5×». */
export function zoomChipLabel(value: number): string {
  return `${Number.isInteger(value) ? value : Number(value.toFixed(1))}×`;
}

/** The chip whose value is nearest the current zoom. */
export function activeZoomChip(
  chips: readonly number[],
  current: number | undefined,
): number | undefined {
  if (current === undefined || chips.length === 0) return undefined;
  return chips.reduce((nearest, chip) =>
    Math.abs(chip - current) < Math.abs(nearest - current) ? chip : nearest,
  );
}

export function classifyCameraError(error: unknown): SkinCameraFailure {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return 'denied';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'absent';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return 'busy';
  }
  if (name === 'OverconstrainedError') return 'absent';
  return 'unknown';
}

/** Whether the page can ask for a camera at all. */
export function cameraApiAvailable(
  mediaDevices: Pick<MediaDevices, 'getUserMedia'> | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.mediaDevices,
): boolean {
  return typeof mediaDevices?.getUserMedia === 'function';
}

/**
 * Whether a video input exists. Before the permission is given a browser may list devices without
 * labels, but the kinds are there; a list that cannot be read counts as «unknown», not «absent».
 */
export async function probeCameraPresence(
  mediaDevices: Partial<Pick<MediaDevices, 'enumerateDevices'>> | undefined = typeof navigator ===
  'undefined'
    ? undefined
    : navigator.mediaDevices,
): Promise<'present' | 'absent' | 'unknown'> {
  if (typeof mediaDevices?.enumerateDevices !== 'function') return 'unknown';
  try {
    const devices = await mediaDevices.enumerateDevices();
    return devices.some((device) => device.kind === 'videoinput') ? 'present' : 'absent';
  } catch {
    return 'unknown';
  }
}

export interface SkinCameraSession {
  readonly stream: MediaStream;
  readonly controls: SkinCameraControls;
  /** The zoom the track reports now, when it has zoom. */
  currentZoom(): number | undefined;
  setZoom(value: number): Promise<void>;
  setTorch(on: boolean): Promise<void>;
  /** Close focus: manual focus at the nearest distance the lens reports. */
  setMacro(on: boolean): Promise<void>;
  stop(): void;
}

export type SkinCameraStart =
  | { readonly kind: 'live'; readonly session: SkinCameraSession }
  | { readonly kind: 'failed'; readonly reason: SkinCameraFailure };

type AdvancedConstraint = Record<string, unknown>;

async function applyAdvanced(track: MediaStreamTrack, advanced: AdvancedConstraint): Promise<void> {
  // `advanced` is outside lib.dom's constraint typing for zoom, torch and focus distance.
  await track.applyConstraints({ advanced: [advanced] } as MediaTrackConstraints);
}

/** Starts the back camera. Never throws: a failure is a value the TV shows as static. */
export async function startSkinCamera(
  mediaDevices:
    | (Pick<MediaDevices, 'getUserMedia'> & Partial<Pick<MediaDevices, 'enumerateDevices'>>)
    | undefined = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices,
): Promise<SkinCameraStart> {
  if (!mediaDevices || !cameraApiAvailable(mediaDevices)) {
    return { kind: 'failed', reason: 'unsupported' };
  }
  // A device list without a camera spares the person a permission prompt that cannot succeed.
  if ((await probeCameraPresence(mediaDevices)) === 'absent') {
    return { kind: 'failed', reason: 'absent' };
  }
  let stream: MediaStream;
  try {
    stream = await mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1920 },
      },
      audio: false,
    });
  } catch (cause) {
    return { kind: 'failed', reason: classifyCameraError(cause) };
  }
  const track = stream.getVideoTracks()[0];
  if (!track) {
    for (const each of stream.getTracks()) each.stop();
    return { kind: 'failed', reason: 'absent' };
  }
  const capabilities: SkinTrackCapabilities =
    typeof track.getCapabilities === 'function'
      ? (track.getCapabilities() as unknown as SkinTrackCapabilities)
      : {};
  const controls = skinCameraControls(capabilities);
  const macroDistance = controls.focusDistance?.min;
  return {
    kind: 'live',
    session: {
      stream,
      controls,
      currentZoom: () => {
        const zoom = (track.getSettings() as { zoom?: number }).zoom;
        return typeof zoom === 'number' ? zoom : undefined;
      },
      setZoom: (value) => applyAdvanced(track, { zoom: value }),
      setTorch: (on) => applyAdvanced(track, { torch: on }),
      setMacro: (on) =>
        applyAdvanced(
          track,
          on && macroDistance !== undefined
            ? { focusMode: 'manual', focusDistance: macroDistance }
            : { focusMode: 'continuous' },
        ),
      stop: () => {
        for (const each of stream.getTracks()) each.stop();
      },
    },
  };
}
