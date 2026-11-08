import { Capacitor } from '@capacitor/core';
import type { CalculatorInputDefinition } from '@localmed/contracts';

import { validCalculatorValue } from '@/features/calculators/calculator-launch-draft';
import { isPublishedHost } from '@/features/diary/diary-links';

/**
 * A calculator sent as a link (CALCLINK, owner 2026-11-08). The link opens the one calculator,
 * filled in, on a page that loads only that calculator:
 *
 *   https://t-damer.gitverse.site/minimed/?share=tool#/calculators/<id>?<input>=<value>&…
 *
 * `?share=tool` is the shared-tool view (`state/app-profile.ts`): no bottom bar, no first-run tour,
 * no search core, and a profile remembered on the device does not take the link over. The values
 * are the calculator's own inputs only — never the patient's name or card — and each is checked
 * against its input as a launch draft is, so a hand-edited link can only fill what the form allows.
 */

/** Where links point from the native app and the published pages: GitVerse opens reliably in Russia. */
const PUBLIC_APP_PAGE = 'https://t-damer.gitverse.site/minimed/';

export const SHARED_TOOL_PARAMETER = 'share';
export const SHARED_TOOL_VALUE = 'tool';

/** The page a shared link opens: the public copy, or this page itself when run locally. */
export function calculatorShareBase(
  location: Pick<Location, 'hostname' | 'origin' | 'pathname'> = window.location,
  native: boolean = Capacitor.isNativePlatform(),
): string {
  if (native || isPublishedHost(location.hostname)) return PUBLIC_APP_PAGE;
  return new URL('./', `${location.origin}${location.pathname}`).toString();
}

function linkValue(value: string | number | boolean): string | undefined {
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** The calculator's link with the values that fit its inputs, in the inputs' order. */
export function calculatorShareUrl(input: {
  readonly calculatorId: string;
  readonly inputs: readonly CalculatorInputDefinition[];
  readonly values?: Readonly<Record<string, string | number | boolean>>;
  readonly base?: string;
}): string {
  const query = new URLSearchParams();
  for (const definition of input.inputs) {
    const raw = input.values?.[definition.id];
    const value = raw === undefined ? undefined : linkValue(raw);
    if (value !== undefined && validCalculatorValue(definition, value)) {
      query.set(definition.id, value);
    }
  }
  const page = new URL(input.base ?? calculatorShareBase());
  page.search = `?${SHARED_TOOL_PARAMETER}=${SHARED_TOOL_VALUE}`;
  const values = query.toString();
  page.hash = `#/calculators/${encodeURIComponent(input.calculatorId)}${values ? `?${values}` : ''}`;
  return page.toString();
}

/** The part of a calculator address after `?`, as given in the hash (`#/calculators/<id>?a=1`). */
export function calculatorRouteQuery(hash: string): string {
  const index = hash.indexOf('?');
  return index === -1 ? '' : hash.slice(index + 1);
}

/** The values a link carries for this calculator: only its inputs, only values they accept. */
export function calculatorLinkValues(
  query: string,
  inputs: readonly CalculatorInputDefinition[],
): Readonly<Record<string, string>> {
  if (!query) return {};
  const params = new URLSearchParams(query);
  const values: Record<string, string> = {};
  for (const definition of inputs) {
    const value = params.get(definition.id);
    if (value !== null && validCalculatorValue(definition, value)) values[definition.id] = value;
  }
  return values;
}

/** Sends the empty calculator's link: the system share sheet where there is one, else the clipboard. */
export async function shareCalculatorLink(input: {
  readonly calculatorId: string;
  readonly title: string;
  readonly inputs: readonly CalculatorInputDefinition[];
}): Promise<'shared' | 'copied'> {
  const url = calculatorShareUrl({ calculatorId: input.calculatorId, inputs: input.inputs });
  if (navigator.share) {
    await navigator.share({ title: input.title, url });
    return 'shared';
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}
