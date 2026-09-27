import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';

/**
 * Dev/preview-server helper (imported only by vite.config.ts, never by the app bundle).
 *
 * The static server labels `*.gz` files `Content-Encoding: gzip`, so the browser inflates them in
 * transit: a 39 MB `.db.gz` arrives as 176 MB, its size no longer matches the catalog and resumed
 * downloads ask for ranges past the end (416). Content archives are files the app downloads,
 * verifies and inflates itself, so they must travel as opaque `application/gzip`, the way the
 * published Pages mirror already serves them.
 */

const CONTENT_ARCHIVE = /^\/content\/(?!releases\/).+\.gz$/u;

/** `/content/**\/*.gz`, except `/content/releases/…`, which the release-cache plugin serves. */
export function isContentArchivePath(requestUrl: string | undefined): boolean {
  const pathname = (requestUrl ?? '').split('?')[0] ?? '';
  return CONTENT_ARCHIVE.test(pathname);
}

const withArchiveHeaders = (headers: OutgoingHttpHeaders): OutgoingHttpHeaders =>
  Object.fromEntries([
    ...Object.entries(headers).filter(([name]) => {
      const lower = name.toLowerCase();
      return lower !== 'content-encoding' && lower !== 'content-type';
    }),
    ['Content-Type', 'application/gzip'],
  ]);

/**
 * Leaves serving (including byte ranges) to the static server and only rewrites the two headers
 * it sets on content archives.
 */
export function contentArchiveHeaders(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): void {
  if (!isContentArchivePath(request.url)) {
    next();
    return;
  }
  const setHeader = response.setHeader.bind(response);
  response.setHeader = (name, value) => {
    const lower = name.toLowerCase();
    if (lower === 'content-encoding') return response;
    return setHeader(name, lower === 'content-type' ? 'application/gzip' : value);
  };
  const writeHead = response.writeHead.bind(response) as (
    statusCode: number,
    ...rest: unknown[]
  ) => ServerResponse;
  // writeHead(status, headers) or writeHead(status, reason, headers).
  response.writeHead = ((statusCode: number, ...rest: unknown[]) => {
    response.removeHeader('Content-Encoding');
    setHeader('Content-Type', 'application/gzip');
    return writeHead(
      statusCode,
      ...rest.map((value) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? withArchiveHeaders(value as OutgoingHttpHeaders)
          : value,
      ),
    );
  }) as ServerResponse['writeHead'];
  next();
}
