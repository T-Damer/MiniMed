const SETUP_DISMISSED_KEY = 'minimed:package-setup-dismissed:v1';
let dismissedInSession = false;

export function isSetupDismissed(): boolean {
  if (dismissedInSession) return true;
  try {
    return localStorage.getItem(SETUP_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissSetup(): void {
  dismissedInSession = true;
  try {
    localStorage.setItem(SETUP_DISMISSED_KEY, '1');
  } catch {
    /* Private browsing still retains the dismissal for this application session. */
  }
}

let coreStartHeld = false;
let coreStartWaiters: Array<() => void> = [];

/**
 * Keeps the first core download from beginning until the onboarding has introduced the app (the
 * user pressed «Далее» past the greeting). Held at start-up when the onboarding is to open and
 * released once it moves on, ends or is closed, so the download never waits forever.
 */
export function holdCoreStart(): void {
  coreStartHeld = true;
}

export function releaseCoreStart(): void {
  coreStartHeld = false;
  const waiters = coreStartWaiters;
  coreStartWaiters = [];
  for (const wake of waiters) wake();
}

/** Whether the first core download is currently held back for the onboarding. */
export function isCoreStartHeld(): boolean {
  return coreStartHeld;
}

/** Resolves at once unless the start is held; then when it is released. */
export function whenCoreStartReleased(): Promise<void> {
  if (!coreStartHeld) return Promise.resolve();
  return new Promise<void>((resolve) => coreStartWaiters.push(resolve));
}

const CORE_CONSENT_KEY = 'minimed:core-download-consent:v1';
let coreConsentInSession = false;

/**
 * Whether the person (or an automation that sets the same preference up front) has allowed the
 * main database to download. Nothing downloads on a first launch before this is true; once it is,
 * later launches (a reload mid-download, a re-open) continue without asking again.
 */
export function isCoreDownloadConsented(): boolean {
  if (coreConsentInSession) return true;
  try {
    return localStorage.getItem(CORE_CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

export function grantCoreDownloadConsent(): void {
  coreConsentInSession = true;
  try {
    localStorage.setItem(CORE_CONSENT_KEY, '1');
  } catch {
    /* Private browsing keeps the consent for this application session. */
  }
}

/** Subset of the Network Information API; absent in Safari/Firefox. */
export interface NetworkConnectionHint {
  readonly saveData?: boolean;
  readonly type?: string;
}

/**
 * Whether the app may fetch its small remote catalog by itself (the core itself waits for
 * {@link isCoreDownloadConsented}). A connection the platform reports as cellular or data-saving
 * is left alone; an unknown connection (no API) counts as unmetered.
 */
export function coreAutoDownloadAllowed(connection: NetworkConnectionHint | undefined): boolean {
  if (!connection) return true;
  if (connection.saveData === true) return false;
  return connection.type !== 'cellular';
}

export function currentNetworkConnection(): NetworkConnectionHint | undefined {
  return (navigator as Navigator & { readonly connection?: NetworkConnectionHint }).connection;
}

export function downloadPercent(
  loaded: number,
  total: number | null | undefined,
): number | undefined {
  if (!total || !Number.isFinite(total) || total < 0 || !Number.isFinite(loaded)) return undefined;
  return Math.min(100, Math.max(0, (loaded / total) * 100));
}
