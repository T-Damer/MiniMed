export interface SenseCase {
  readonly definitionIncludes: string;
  readonly definitionExcludes?: string | undefined;
}

/** The leading sense passes when its text has the wanted words and none of the unwanted. */
export function senseCaseVerdict(fixture: SenseCase, text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes(fixture.definitionIncludes.toLowerCase()) &&
    !(
      fixture.definitionExcludes !== undefined &&
      lower.includes(fixture.definitionExcludes.toLowerCase())
    )
  );
}
