/**
 * Whether a site lets this page embed it, from the response headers the site itself sends. Only the
 * native transport (and a CORS-open source) can read them; elsewhere the viewer falls back to a
 * load timeout and a standing «Открыть в браузере» control (ADR-0024).
 */
export type FramingVerdict = 'refused' | 'allowed';

function sourceMatchesOrigin(source: string, origin: string): boolean {
  const token = source.trim().toLowerCase();
  if (token === '' || token === "'none'") return false;
  if (token === '*') return true;
  if (token === "'self'") return false;
  let target: URL;
  try {
    target = new URL(origin);
  } catch {
    return false;
  }
  if (token === `${target.protocol}`) return true;
  const pattern = /^(?:(https?):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?(?:\/.*)?$/u.exec(token);
  if (!pattern) return false;
  const [, scheme, wildcard, host, port] = pattern;
  if (scheme && `${scheme}:` !== target.protocol) return false;
  const hostname = target.hostname.toLowerCase();
  const hostMatches = wildcard ? hostname.endsWith(`.${host}`) : hostname === host;
  if (!hostMatches) return false;
  if (
    port &&
    port !== '*' &&
    port !== (target.port || (target.protocol === 'https:' ? '443' : '80'))
  ) {
    return false;
  }
  return true;
}

function frameAncestorsAllow(policyHeader: string, origin: string): boolean {
  for (const policy of policyHeader.split(',')) {
    for (const directive of policy.split(';')) {
      const [name, ...sources] = directive.trim().split(/\s+/u);
      if (name?.toLowerCase() !== 'frame-ancestors') continue;
      if (!sources.some((source) => sourceMatchesOrigin(source, origin))) return false;
    }
  }
  return true;
}

/** `headers` use lower-case names; `appOrigin` is the origin of the page that would embed the site. */
export function framingVerdict(
  headers: Readonly<Record<string, string>>,
  appOrigin: string,
): FramingVerdict {
  const frameOptions = (headers['x-frame-options'] ?? '').toLowerCase();
  if (/\b(deny|sameorigin)\b/u.test(frameOptions)) return 'refused';
  const csp = headers['content-security-policy'] ?? '';
  if (csp !== '' && !frameAncestorsAllow(csp, appOrigin)) return 'refused';
  return 'allowed';
}
