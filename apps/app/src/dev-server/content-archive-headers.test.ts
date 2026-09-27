import { type IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { describe, expect, it } from 'vitest';

import { contentArchiveHeaders, isContentArchivePath } from './content-archive-headers';

function served(url: string, sendHeaders: (response: ServerResponse) => void) {
  const request = { url, method: 'GET' } as IncomingMessage;
  const response = new ServerResponse(request);
  response.assignSocket(new Socket());
  let passed = false;
  contentArchiveHeaders(request, response, () => {
    passed = true;
  });
  // What the static server does for a `.gz` file.
  sendHeaders(response);
  return { passed, response };
}

describe('content archive headers', () => {
  it('matches content archives but leaves release-cache assets and other files alone', () => {
    expect(
      isContentArchivePath(
        '/content/definition-reference/minimed.definition.reference.2026.9.28.db.gz?v=1',
      ),
    ).toBe(true);
    expect(isContentArchivePath('/content/terminology.db.gz')).toBe(true);
    expect(isContentArchivePath('/content/releases/definition-reference-2026.9.27/x.db.gz')).toBe(
      false,
    );
    expect(isContentArchivePath('/content/core.db')).toBe(false);
    expect(isContentArchivePath('/assets/app.js.gz')).toBe(false);
  });

  it('serves an archive as opaque gzip, never as a transfer encoding', () => {
    const { passed, response } = served('/content/x/edition.db.gz', (target) => {
      target.setHeader('Content-Encoding', 'gzip');
      target.writeHead(206, {
        'Content-Encoding': 'gzip',
        'Content-Type': '',
        'Content-Range': 'bytes 0-99/38959050',
        'Content-Length': '100',
      });
    });
    expect(passed).toBe(true);
    expect(response.statusCode).toBe(206);
    expect(response.getHeader('content-encoding')).toBeUndefined();
    expect(response.getHeader('content-type')).toBe('application/gzip');
    // Byte ranges stay with the static server.
    expect(response.getHeader('content-range')).toBe('bytes 0-99/38959050');
    expect(response.getHeader('content-length')).toBe('100');
  });

  it('does not touch other responses', () => {
    const { passed, response } = served('/content/core.db', (target) => {
      target.setHeader('Content-Encoding', 'gzip');
      target.writeHead(200, { 'Content-Type': 'text/plain' });
    });
    expect(passed).toBe(true);
    expect(response.getHeader('content-encoding')).toBe('gzip');
    expect(response.getHeader('content-type')).toBe('text/plain');
  });
});
