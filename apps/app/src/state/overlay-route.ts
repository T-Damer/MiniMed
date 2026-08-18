const OVERLAY_PARAM = 'o';
const LEGACY_DIALOG_PARAM = 'dialog';
const LEGACY_SECTION_PARAM = 'section';

const KNOWN_OVERLAY_DIALOG_TITLES = new Set([
  'Куда вернуться',
  'Карта связей',
  'Не удалось открыть документ',
]);

export interface OverlayLocationState {
  readonly documentId: string;
  readonly section?: string;
}

function utf8ToBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64UrlToUtf8(token: string): string | null {
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (padded.length % 4)) % 4;
    const base64 = padded + '='.repeat(padLength);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function encodeOverlayToken(overlay: OverlayLocationState): string {
  const payload = overlay.section
    ? `${overlay.documentId}\n${overlay.section}`
    : overlay.documentId;
  return utf8ToBase64Url(payload);
}

export function decodeOverlayToken(token: string): OverlayLocationState | null {
  const decoded = base64UrlToUtf8(token.trim());
  if (!decoded) return null;
  const newline = decoded.indexOf('\n');
  if (newline === -1) {
    return decoded ? { documentId: decoded } : null;
  }
  const documentId = decoded.slice(0, newline);
  const section = decoded.slice(newline + 1);
  if (!documentId) return null;
  return section ? { documentId, section } : { documentId };
}

function looksLikeOverlayDialogTitle(value: string): boolean {
  if (KNOWN_OVERLAY_DIALOG_TITLES.has(value)) return true;
  return !value.includes('.') && /[\u0400-\u04FF]/u.test(value);
}

function overlayFromLegacySearch(params: URLSearchParams): OverlayLocationState | null {
  const dialog = params.get(LEGACY_DIALOG_PARAM);
  if (!dialog || looksLikeOverlayDialogTitle(dialog)) return null;
  const section = params.get(LEGACY_SECTION_PARAM) ?? undefined;
  return section ? { documentId: dialog, section } : { documentId: dialog };
}

export function overlayFromLocationSearch(search: string): OverlayLocationState | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const token = params.get(OVERLAY_PARAM);
  if (token) {
    const decoded = decodeOverlayToken(token);
    if (decoded) return decoded;
  }
  return overlayFromLegacySearch(params);
}

export function writeOverlaySearch(url: URL, overlay: OverlayLocationState | null): void {
  url.searchParams.delete(LEGACY_DIALOG_PARAM);
  url.searchParams.delete(LEGACY_SECTION_PARAM);
  if (overlay) {
    url.searchParams.set(OVERLAY_PARAM, encodeOverlayToken(overlay));
  } else {
    url.searchParams.delete(OVERLAY_PARAM);
  }
}

export function stripOverlaySearch(url: URL): void {
  url.searchParams.delete(OVERLAY_PARAM);
  url.searchParams.delete(LEGACY_DIALOG_PARAM);
  url.searchParams.delete(LEGACY_SECTION_PARAM);
}

export function stripOrphanedOverlaySearch(documentOverlayOpen: boolean): void {
  if (documentOverlayOpen) return;
  const url = new URL(window.location.href);
  const hasOverlayParams =
    url.searchParams.has(OVERLAY_PARAM) ||
    url.searchParams.has(LEGACY_DIALOG_PARAM) ||
    url.searchParams.has(LEGACY_SECTION_PARAM);
  if (!hasOverlayParams) return;
  stripOverlaySearch(url);
  window.history.replaceState(window.history.state, '', url);
}
