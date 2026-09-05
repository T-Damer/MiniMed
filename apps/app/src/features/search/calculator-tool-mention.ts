export interface CalculatorToolMentionOption {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly aliases: readonly string[];
}

export interface ParsedCalculatorToolMention {
  readonly query: string;
  readonly token?: string;
  readonly calculatorId?: string;
}

function normalizeIdentity(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function parseCalculatorToolMention(
  value: string,
  calculators: readonly CalculatorToolMentionOption[],
): ParsedCalculatorToolMention {
  const trimmed = value.trim();
  const match = /(?:^|\s)(@(?:калькулятор|calculator):([^\s]+))/iu.exec(trimmed);
  if (!match?.[1] || !match[2]) return { query: trimmed };

  const query = `${trimmed.slice(0, match.index)} ${trimmed.slice(match.index + match[0].length)}`
    .trim()
    .replace(/\s+/gu, ' ');

  const identity = normalizeIdentity(match[2]);
  const calculator = calculators.find((candidate) =>
    [
      candidate.id,
      candidate.slug,
      candidate.title,
      candidate.shortTitle,
      ...candidate.aliases,
    ].some((field) => normalizeIdentity(field) === identity),
  );
  if (!calculator) return { query, token: match[1] };

  return {
    calculatorId: calculator.id,
    query,
    token: match[1],
  };
}

export function calculatorToolTrigger(value: string, caret: number): string | undefined {
  const beforeCaret = value.slice(0, Math.max(0, Math.min(caret, value.length)));
  const match = /(?:^|\s)@([^\s]*)$/u.exec(beforeCaret);
  if (!match) return undefined;
  return (match[1] ?? '').replace(/^(?:калькулятор|calculator):/iu, '');
}

export function replaceCalculatorToolTrigger(
  value: string,
  caret: number,
  slug: string,
): { readonly value: string; readonly caret: number } {
  const position = Math.max(0, Math.min(caret, value.length));
  const beforeCaret = value.slice(0, position);
  const trigger = /(?:^|\s)@[^\s]*$/u.exec(beforeCaret);
  const start = trigger ? beforeCaret.lastIndexOf('@') : position;
  const prefix = !trigger && start > 0 && !/\s$/u.test(beforeCaret) ? ' ' : '';
  const suffix = value.slice(position);
  const trailing = /^\s/u.test(suffix) ? '' : ' ';
  const insertion = `${prefix}@Калькулятор:${slug}${trailing}`;
  const nextValue = `${value.slice(0, start)}${insertion}${suffix}`;
  return { value: nextValue, caret: start + insertion.length };
}
