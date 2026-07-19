export function parseJsonObject(value: string): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('Expected a JSON object.');
  }
  return parsed as Readonly<Record<string, unknown>>;
}

export function parseJsonStringArray(value: string): readonly string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new TypeError('Expected an array of strings.');
  }
  return parsed;
}
