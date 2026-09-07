/** Read only small bodies into JS memory. Large/unknown cores stream directly into OPFS. */
export async function readBoundedResponse(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (!response.body) throw new Error('The content response has no readable body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maxBytes - size) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
      size += value.byteLength;
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    reader.releaseLock();
  }
}
